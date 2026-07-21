"use client";

export default function LineChart({
  points,
}: { points: { label: string; value: number }[] }) {
  if (points.length < 2) return null;
  const W = 320, H = 140, PAD = 24;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (points.length - 1);
  const y = (v: number) => H - PAD - ((v - min) * (H - 2 * PAD)) / span;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <path d={path} style={{ stroke: "var(--growth-accent)" }} strokeWidth={2.5} fill="none" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r={4} style={{ fill: "var(--growth-accent)" }} />
          <text x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} style={{ fill: "var(--ink-soft)" }}>{p.label}</text>
        </g>
      ))}
      <text x={PAD - 4} y={y(max) + 3} textAnchor="end" fontSize={10} style={{ fill: "var(--ink-soft)" }}>{max}</text>
      <text x={PAD - 4} y={y(min) + 3} textAnchor="end" fontSize={10} style={{ fill: "var(--ink-soft)" }}>{min}</text>
    </svg>
  );
}
