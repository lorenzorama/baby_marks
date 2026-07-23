"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

// Row height is a hard 44px in JS (used for scrollTop <-> index math), so the
// row/spacer elements below use px arbitrary values (`h-[44px]`, `py-[88px]`)
// instead of the `h-11` rem-based class the brief mentions — this app sets
// `html { font-size: 17px }` globally, which would make `h-11` render at
// ~46.75px and desync the scroll-snap index calculation from ROW_H.
const ROW_H = 44; // also: (220 - ROW_H) / 2 = 88px spacer, centers the middle row in the 220px wheel

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function withTime(day: Date, hour: number, minute: number) {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function toDateInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const CHIP = "rounded-full px-4 py-2.5 text-sm font-semibold";
const CHIP_ON = `${CHIP} bg-primary text-white`;
const CHIP_OFF = `${CHIP} bg-surface-2 text-ink-soft`;
const INPUT = "w-full rounded-2xl border border-line bg-surface-2 px-4 py-3.5 text-base text-ink outline-none focus:border-primary";
const PRIMARY_BTN = "w-full rounded-2xl bg-primary py-3.5 text-base font-bold text-white disabled:opacity-50";
const WHEEL_COL = "h-[220px] w-20 overflow-y-auto snap-y snap-mandatory py-[88px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden";

export default function TimeWheelPicker({
  open, title, value, allowClear, onDone, onClear, onClose,
}: {
  open: boolean;
  title: string;
  value: Date;
  allowClear?: boolean;
  onDone: (d: Date) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("picker");
  const [current, setCurrent] = useState(value);
  const hourRef = useRef<HTMLDivElement>(null);
  const minuteRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync from the incoming value (and snap the wheels to it) every time
  // the picker opens, or if the caller swaps `value` while it's open.
  useEffect(() => {
    if (!open) return;
    setCurrent(value);
    if (hourRef.current) hourRef.current.scrollTop = value.getHours() * ROW_H;
    if (minuteRef.current) minuteRef.current.scrollTop = value.getMinutes() * ROW_H;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value.getTime()]);

  useEffect(() => {
    if (open) return;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
  }, [open]);

  if (!open) return null;

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  function setDay(d: Date) {
    setCurrent((prev) => withTime(d, prev.getHours(), prev.getMinutes()));
  }

  function handleScroll(ref: React.RefObject<HTMLDivElement | null>, kind: "hour" | "minute") {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const max = kind === "hour" ? 23 : 59;
      const idx = Math.min(max, Math.max(0, Math.round(el.scrollTop / ROW_H)));
      setCurrent((prev) =>
        kind === "hour" ? withTime(prev, idx, prev.getMinutes()) : withTime(prev, prev.getHours(), idx));
    }, 120);
  }

  function setRelativeToNow(offsetMin: number) {
    const d = new Date(Date.now() - offsetMin * 60000);
    setCurrent(d);
    if (hourRef.current) hourRef.current.scrollTop = d.getHours() * ROW_H;
    if (minuteRef.current) minuteRef.current.scrollTop = d.getMinutes() * ROW_H;
  }

  const quickChips: { label: string; offset: number }[] = [
    { label: t("now"), offset: 0 },
    { label: "−5 min", offset: 5 },
    { label: "−15 min", offset: 15 },
    { label: "−30 min", offset: 30 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
      <div
        className="w-full rounded-t-3xl border-t border-line bg-surface p-5 pb-[calc(2rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line" />
        <h2 className="mb-4 text-xl font-bold">{title}</h2>

        <div className="mb-4 flex items-center gap-2">
          <button type="button" className={sameDay(current, now) ? CHIP_ON : CHIP_OFF} onClick={() => setDay(now)}>
            {t("today")}
          </button>
          <button type="button" className={sameDay(current, yesterday) ? CHIP_ON : CHIP_OFF} onClick={() => setDay(yesterday)}>
            {t("yesterday")}
          </button>
          <input
            type="date"
            value={toDateInput(current)}
            onChange={(e) => {
              if (!e.target.value) return;
              const [y, m, d] = e.target.value.split("-").map(Number);
              setDay(new Date(y, m - 1, d));
            }}
            className={`${INPUT} min-w-0 flex-1`}
          />
        </div>

        <div className="relative mb-4 flex justify-center gap-4">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[44px] -translate-y-1/2 rounded-xl bg-primary/10" />
          <div ref={hourRef} onScroll={() => handleScroll(hourRef, "hour")} className={WHEEL_COL}>
            {HOURS.map((h) => (
              <div
                key={h}
                className={`flex h-[44px] snap-center items-center justify-center text-xl font-semibold tabular-nums ${h === current.getHours() ? "text-ink" : "text-ink-soft"}`}
              >
                {String(h).padStart(2, "0")}
              </div>
            ))}
          </div>
          <div ref={minuteRef} onScroll={() => handleScroll(minuteRef, "minute")} className={WHEEL_COL}>
            {MINUTES.map((m) => (
              <div
                key={m}
                className={`flex h-[44px] snap-center items-center justify-center text-xl font-semibold tabular-nums ${m === current.getMinutes() ? "text-ink" : "text-ink-soft"}`}
              >
                {String(m).padStart(2, "0")}
              </div>
            ))}
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {quickChips.map((c) => (
            <button key={c.label} type="button" className={CHIP_OFF} onClick={() => setRelativeToNow(c.offset)}>
              {c.label}
            </button>
          ))}
        </div>

        {allowClear && (
          <button
            type="button"
            className="mb-3 w-full rounded-2xl bg-sleep-tint py-3 font-semibold text-sleep"
            onClick={() => { onClear?.(); onClose(); }}
          >
            {t("noEnd")}
          </button>
        )}

        <button type="button" className={PRIMARY_BTN} onClick={() => { onDone(current); onClose(); }}>
          {t("done")}
        </button>
      </div>
    </div>
  );
}
