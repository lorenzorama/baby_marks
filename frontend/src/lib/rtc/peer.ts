/** Thin wrappers over the browser's WebRTC API. Verified by the manual
 *  two-device protocol in the plan, not by unit tests: these are almost
 *  entirely calls into APIs jsdom does not implement. */

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export function createPeer(
  onSignal: (data: unknown) => void,
  onTrack?: (stream: MediaStream) => void,
): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (event) => {
    if (event.candidate) onSignal({ candidate: event.candidate.toJSON() });
  };
  if (onTrack) {
    pc.ontrack = (event) => onTrack(event.streams[0]);
  }
  return pc;
}

/** Apply an incoming offer/answer/candidate. Answers the offer via `reply`. */
export async function applySignal(
  pc: RTCPeerConnection,
  data: unknown,
  reply: (data: unknown) => void,
): Promise<void> {
  const message = data as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
  if (message.sdp) {
    await pc.setRemoteDescription(message.sdp);
    if (message.sdp.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      reply({ sdp: answer });
    }
    return;
  }
  if (message.candidate) {
    try {
      await pc.addIceCandidate(message.candidate);
    } catch {
      // A candidate that arrives before the remote description is safe to drop.
    }
  }
}

export async function offerTo(
  pc: RTCPeerConnection,
  send: (data: unknown) => void,
): Promise<void> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send({ sdp: offer });
}
