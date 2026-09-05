"use client";

/* Sparkline — tiny inline trend line for leaderboard rows. Pure SVG, no axes. */

export function Sparkline({
  values,
  width = 96,
  height = 28,
  stroke = "var(--color-green-600)",
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const pad = 2;
  const flat = max <= 0;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 2) + 1;
      const y = flat
        ? height - pad
        : pad + (1 - v / max) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={flat ? "var(--color-bone-200)" : stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
