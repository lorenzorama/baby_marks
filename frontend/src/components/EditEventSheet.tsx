"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Sheet from "@/components/Sheet";
import { toast } from "@/components/Toast";
import { useDeleteEvent, useUpdateEvent } from "@/hooks/useEvents";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import type { ApiEvent, Caregiver } from "@/lib/types";

export default function EditEventSheet({
  event, onClose,
}: { event: ApiEvent | null; onClose: () => void }) {
  const t = useTranslations("edit");
  const tc = useTranslations("caregiver");
  const td = useTranslations("diaper");
  const ts = useTranslations("side");
  const update = useUpdateEvent();
  const del = useDeleteEvent();

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [caregiver, setCaregiver] = useState<Caregiver>("maman");
  const [details, setDetails] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!event) return;
    setStart(toLocalInput(new Date(event.startedAt)));
    setEnd(event.endedAt ? toLocalInput(new Date(event.endedAt)) : "");
    setNote(event.note ?? "");
    setCaregiver(event.caregiver);
    setDetails(event.details);
  }, [event]);

  if (!event) return null;

  const input = "w-full rounded-2xl border border-line bg-surface-2 px-4 py-3.5 text-base text-ink outline-none focus:border-primary";
  const label = "mb-1 block text-sm font-medium text-ink-soft";

  function save() {
    if (!event) return;
    const s = fromLocalInput(start);
    const e = end ? fromLocalInput(end) : null;
    if (Number.isNaN(s.getTime()) || (e !== null && Number.isNaN(e.getTime()))) {
      toast(t("invalidDate"));
      return;
    }
    update.mutate({
      id: event.id,
      startedAt: s.toISOString(),
      endedAt: e ? e.toISOString() : null,
      details,
      note: note.trim() ? note.trim() : null,
      caregiver,
    });
    onClose();
  }

  function remove() {
    if (!event) return;
    if (window.confirm(t("confirmDelete"))) {
      del.mutate(event.id);
      onClose();
    }
  }

  const setDet = (key: string, value: unknown) =>
    setDetails((d) => ({ ...d, [key]: value }));

  return (
    <Sheet open onClose={onClose} title={t("title")}>
      <div className="space-y-3">
        <div>
          <label className={label}>{t("start")}</label>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>{t("end")}</label>
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
          {!end && <p className="mt-1 text-xs font-medium text-sleep">{t("running")}</p>}
        </div>

        {event.type === "feed" && details.method === "bottle" && (
          <input type="number" inputMode="numeric" value={String(details.amountMl ?? "")}
            onChange={(e) => setDet("amountMl", Number(e.target.value) || undefined)}
            className={input} />
        )}
        {event.type === "feed" && details.method === "breast" && (
          <div className="grid grid-cols-2 gap-2">
            {(["left", "right"] as const).map((s) => (
              <button key={s} onClick={() => setDet("side", s)}
                className={details.side === s ? "rounded-2xl bg-primary py-3 font-semibold text-white" : "rounded-2xl bg-surface-2 py-3 font-semibold text-ink-soft"}>
                {ts(s)}
              </button>
            ))}
          </div>
        )}
        {event.type === "diaper" && (
          <div className="grid grid-cols-3 gap-2">
            {(["wet", "dirty", "both"] as const).map((k) => (
              <button key={k} onClick={() => setDet("kind", k)}
                className={details.kind === k ? "rounded-2xl bg-primary py-3 font-semibold text-white" : "rounded-2xl bg-surface-2 py-3 font-semibold text-ink-soft"}>
                {td(k)}
              </button>
            ))}
          </div>
        )}
        {event.type === "pump" && (
          <div className="grid grid-cols-2 gap-2">
            <input type="number" inputMode="numeric" placeholder="G ml" value={String(details.leftMl ?? "")}
              onChange={(e) => setDet("leftMl", Number(e.target.value) || undefined)} className={input} />
            <input type="number" inputMode="numeric" placeholder="D ml" value={String(details.rightMl ?? "")}
              onChange={(e) => setDet("rightMl", Number(e.target.value) || undefined)} className={input} />
          </div>
        )}
        {event.type === "medicine" && (
          <input value={String(details.name ?? "")} onChange={(e) => setDet("name", e.target.value)} className={input} />
        )}

        <div>
          <label className={label}>{t("note")}</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>{t("caregiver")}</label>
          <div className="grid grid-cols-2 gap-2">
            {(["maman", "papa"] as const).map((c) => (
              <button key={c} onClick={() => setCaregiver(c)}
                className={caregiver === c ? "rounded-2xl bg-primary py-3 font-semibold text-white" : "rounded-2xl bg-surface-2 py-3 font-semibold text-ink-soft"}>
                {tc(c)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={remove} className="flex-1 rounded-2xl bg-danger/15 py-3.5 font-bold text-danger">
            {t("delete")}
          </button>
          <button onClick={save} className="flex-[2] rounded-2xl bg-primary py-3.5 font-bold text-white">
            {t("save")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
