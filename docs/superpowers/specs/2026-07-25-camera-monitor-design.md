# Baby Marks — « Veille bébé » (caméra de surveillance) Design Spec

**Date:** 2026-07-25
**Status:** Approved by user
**Decisions:** portée = wifi maison uniquement ; appairage = bouton « utiliser cet appareil comme caméra » (pas de validation croisée, pas de code) ; audio = son du bébé vers le spectateur uniquement ; options v1 = écran noir côté caméra, bascule avant/arrière + plein écran, capture photo souvenir. Alerte sonore « elle pleure » explicitement écartée.

## Goal

Transformer un vieux téléphone en moniteur vidéo pour la chambre de Theana : il diffuse image + son, et n'importe quel autre appareil déjà connecté à l'app (tablette, téléphone) peut le regarder en direct depuis le même wifi, avec possibilité de figer une photo souvenir.

## Architecture

Flux **peer-to-peer WebRTC** : la vidéo/audio va directement du téléphone-caméra à l'appareil spectateur sur le réseau local. Le backend ne sert que de canal de signalisation (mise en relation) — il ne voit, ne relaie et ne stocke aucun média.

```
téléphone-caméra ──WebSocket /rtc (signalisation)──▶ backend FastAPI ◀──WebSocket /rtc── tablette
        └──────────────── flux vidéo+audio WebRTC direct (LAN) ─────────────────┘
```

- Nouveau endpoint WebSocket **`/rtc`** sur le backend, monté à la racine (comme `/mcp`), donc exposé par Traefik : ajouter `Path(\`/rtc\`)` à la règle du routeur `${COMPOSE_PROJECT_NAME}-mcp` du service backend dans `docker-compose.prod.yml` (le nom du routeur reste inchangé pour ne pas casser l'existant ; ajouter un commentaire expliquant qu'il porte désormais MCP + RTC).
- Authentification : le **même cookie `bm_auth`** que le reste de l'app (le cookie est envoyé sur la même origine, y compris en `wss://`). Handshake refusé → fermeture code 1008. Aucune nouvelle notion d'identité ni de compte.
- Serveurs ICE : `stun:stun.l.google.com:19302` déclaré en secours, mais la connexion **doit aboutir sans lui** sur un même LAN (candidats host). Une indisponibilité du STUN ne doit pas empêcher la diffusion locale.
- URL côté client : dérivée de `window.location` (`wss://<host>/rtc`) ; surchargeable par `NEXT_PUBLIC_RTC_URL` (le dev pointe le backend direct, `ws://localhost:8000/rtc`).

## Protocole de signalisation

Messages JSON, une ligne par message. Le serveur ne comprend **pas** le contenu SDP/ICE : il le transporte tel quel entre deux pairs.

Client → serveur :
- `{"type":"hello","role":"camera"|"viewer","name":"<nom d'appareil>"}` — `name` ≤ 40 caractères, ignoré pour un viewer.
- `{"type":"watch"}` — un viewer demande à regarder la caméra courante.
- `{"type":"signal","to":"<peerId>","data":{...}}` — SDP offer/answer ou candidat ICE, opaque.
- `{"type":"takeover"}` — cet appareil devient la caméra à la place de l'actuelle.
- `{"type":"stop"}` — la caméra arrête de diffuser (ou le viewer arrête de regarder).
- `{"type":"ping"}` toutes les 25 s (survie aux timeouts d'inactivité de Traefik).

Serveur → client :
- `{"type":"welcome","peerId":"<uuid>","camera":{"id","name","since"}|null}`
- `{"type":"camera_changed","camera":{...}|null}` — diffusé à tous.
- `{"type":"viewer_joined","peerId":"<uuid>"}` / `{"type":"viewer_left","peerId":"<uuid>"}` — à la caméra seule.
- `{"type":"signal","from":"<peerId>","data":{...}}`
- `{"type":"error","code":"camera_busy"|"no_camera"|"too_many_viewers"|"bad_message"}`
- `{"type":"pong"}`

Négociation : **la caméra est l'offreur**. À la réception de `viewer_joined`, elle crée une `RTCPeerConnection` par spectateur, y ajoute ses pistes, produit une offre et l'envoie via `signal` ; le spectateur répond ; les candidats ICE transitent dans les deux sens. Une `RTCPeerConnection` par couple caméra↔spectateur.

## Backend

- **`backend/app/camera/hub.py`** — classe `CameraHub` **sans dépendance ASGI** (état + décisions pures, testable sans serveur ni DB) : caméra courante, spectateurs, routage d'un message vers son destinataire, application des limites. Retourne des actions à exécuter, ne parle jamais au réseau elle-même.
- **`backend/app/camera/ws.py`** — l'endpoint WebSocket : authentification, décodage/validation JSON, boucle de réception, appels au hub, envoi effectif. Instance unique du hub au niveau du module (état en mémoire, perdu au redémarrage — acceptable et voulu : aucune persistance du direct).
- Limites (toutes appliquées dans le hub, toutes testées) : **1 seule caméra active** (un second `hello` role=camera reçoit `error camera_busy` ; il faut un `takeover` explicite, déclenché par une confirmation dans l'UI) ; **4 spectateurs maximum** ; **message ≤ 64 Kio** (au-delà : `error bad_message`, message ignoré, connexion conservée) ; `type` inconnu → `bad_message`. Toute déconnexion nettoie l'état (caméra qui tombe → `camera_changed: null` à tous).
- **Aucune table** pour le direct. Aucun enregistrement du flux, jamais.

## Photos souvenir

Capture faite **côté spectateur** (canvas depuis la balise vidéo), redimensionnée à 1280 px max sur le grand côté et compressée en JPEG qualité 0.8 (~150–250 Ko) avant envoi.

- Migration `backend/migrations/0003_photos.sql` : `photos(id bigserial pk, taken_at timestamptz not null default now(), width int not null, height int not null, content_type text not null default 'image/jpeg', bytes bytea not null)`.
- **Stockage en base (bytea), pas de volume de fichiers** : les photos sont ainsi couvertes par le `pg_dump` déjà pris avant chaque déploiement — aucune nouvelle mécanique de sauvegarde à maintenir.
- Endpoints sous `/api` (donc jamais exposés publiquement — ils passent par le rewrite du frontend, comme le reste de l'API) :
  - `POST /api/photos` — corps binaire `image/jpeg`, **max 2 Mio** (au-delà : 413). Rejette tout `Content-Type` autre que `image/jpeg` (415). Réponse 201 `{id, takenAt, width, height}` (dimensions lues dans l'en-tête JPEG côté serveur, pas fournies par le client).
  - `GET /api/photos?limit=50` (0 < limit ≤ 200) — métadonnées seulement, jamais les octets, du plus récent au plus ancien.
  - `GET /api/photos/{id}` — le JPEG, `Cache-Control: private, max-age=31536000, immutable` ; 404 si absent.
  - `DELETE /api/photos/{id}` — 204, 404 si absent.
- **Rétention : 200 photos maximum** — à chaque insertion, les plus anciennes au-delà de 200 sont supprimées dans la même transaction (empêche une croissance silencieuse de la base et des backups).
- Galerie sur la page Caméra : vignettes du plus récent au plus ancien, appui long / bouton pour supprimer.

## Frontend

Nouvelle route **`frontend/src/app/camera/page.tsx`**, cinquième entrée dans `BottomNav` (mode mobile) et dans les liens de `TopBar` (mode web). Vérifier la tenue de la barre à 390 px avec 5 onglets.

- **`frontend/src/lib/rtc/signaling.ts`** — client de signalisation pur : machine à états + (dé)sérialisation, avec une fabrique de WebSocket injectable → **testable en vitest sans navigateur**. Reconnexion automatique avec back-off (1 s, 2 s, 4 s, plafond 15 s).
- **`frontend/src/lib/rtc/peer.ts`** — câblage `RTCPeerConnection` (fine couche, vérifiée manuellement).
- **`frontend/src/hooks/useCameraRole.tsx`** / **`useViewerRole.tsx`** — orchestration.
- **Mode caméra** : `getUserMedia({video:{facingMode}, audio:true})` ; nom d'appareil éditable, mémorisé dans `localStorage.bm_device_name` (défaut : « Caméra ») ; **écran noir** avec un point rouge discret après 10 s sans interaction (un tap rétablit l'aperçu), Wake Lock (`navigator.wakeLock`) repris après chaque retour au premier plan, avec message d'avertissement si l'API est absente ; bascule avant/arrière ; bouton « Arrêter la diffusion ». Bandeau permanent rappelant que l'app doit rester au premier plan.
- **Mode spectateur** : `<video autoPlay playsInline muted>` (les navigateurs interdisent le son sans geste utilisateur) + bouton **« Activer le son »** ; plein écran ; bouton capture photo ; états explicites : aucune caméra active / connexion en cours / en direct / connexion perdue (avec bouton Réessayer).
- Nouvelles clés i18n `camera.*` **miroir fr/en**, comme partout ailleurs.
- Aucune nouvelle dépendance npm (WebRTC est natif).

## Sécurité et vie privée

- `/rtc` est joignable publiquement (via Traefik) mais **inutilisable sans le cookie `bm_auth`** — même barrière que l'app.
- Le média ne transite jamais par le serveur, n'est jamais enregistré ; seules les photos explicitement capturées sont stockées.
- **Le serveur MCP n'est pas touché** : aucun outil caméra ni photo n'est exposé à claude.ai (les outils restent les 5 outils journal en lecture seule).
- Les endpoints photos restent sous `/api` (surface interne), jamais dans la règle Traefik du backend.

## Tests et vérification

- **Backend, sans DB** : hub — refus d'une 2ᵉ caméra (`camera_busy`), `takeover` qui bascule et notifie, routage d'un `signal` vers le seul destinataire visé, plafond de 4 spectateurs, message > 64 Kio rejeté sans fermer la connexion, `type` inconnu, nettoyage complet à la déconnexion de la caméra.
- **Backend, DB-gated (`BM_TEST_DATABASE_URL`)** : WebSocket sans cookie → fermeture 1008 ; aller-retour caméra↔spectateur de bout en bout ; API photos — 201 + relecture des octets identiques, 413 au-delà de 2 Mio, 415 sur mauvais type, 404 sur id inconnu, purge au-delà de 200, 401 sans cookie sur les quatre routes.
- **Frontend** : vitest sur `signaling.ts` (fausse WebSocket) — hello/welcome, réception d'un `signal`, back-off de reconnexion ; `tsc --noEmit` ; suite existante verte.
- **Vérification manuelle à deux appareils** (protocole fourni à la fin, à jouer sur le wifi maison) : téléphone en caméra → tablette voit « Caméra : Chambre » → Regarder → image et son OK → activer le son → plein écran → capture photo → la photo apparaît dans la galerie → arrêt de la diffusion → la tablette affiche « aucune caméra active ».
- **La CI doit rester verte** (elle bloque désormais tout déploiement) : `uv run pytest` complet et `npx vitest run`.

## Hors périmètre (v1)

Accès depuis l'extérieur du wifi (serveur TURN/relais — architecture prête, à ajouter ensuite), audio bidirectionnel (« parler au bébé »), détection de pleurs, plusieurs caméras simultanées, enregistrement vidéo, notifications push, application native.

## Limites assumées (à documenter dans le README)

- Le téléphone-caméra doit rester **branché et l'app au premier plan, écran allumé** : verrouiller ou changer d'app coupe la diffusion (limitation des navigateurs mobiles, aucun contournement en web).
- Fonctionne **sur le même réseau wifi** uniquement.
- L'état du direct est en mémoire : un redémarrage du backend (donc chaque déploiement) coupe les sessions en cours ; les clients se reconnectent automatiquement, la caméra doit être relancée d'un tap.
