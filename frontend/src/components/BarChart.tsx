"use client";

export default function BarChart({
  data, color = "bg-growth",
}: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-36 items-end gap-1.5">
      {data.map((d, i) => (
        <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[11px] font-semibold tabular-nums text-ink-soft">
            {d.value > 0 ? Math.round(d.value * 10) / 10 : ""}
          </span>
          <div className={`w-full rounded-t-md ${color}`}
            style={{ height: `${(d.value / max) * 75}%`, minHeight: d.value > 0 ? 2 : 0 }} />
          <span className="text-[11px] text-ink-soft">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
