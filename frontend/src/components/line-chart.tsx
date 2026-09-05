"use client";

/* PortfolioChart — album vs S&P 500, index values (100 = series start).
   Stalvian marks: brand-green portfolio line, signal-blue benchmark, dashed
   recessive gridlines, crosshair + tooltip on hover. Pure SVG. */

import { useMemo, useRef, useState } from "react";

export interface SeriesPoint {
  date: string;
  portfolio: number | null;
  spy: number | null;
}

const W = 640;
const H = 220;
const PAD_L = 40;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 22;

function tick(date: string): string {
  return new Date(date).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export function PortfolioChart({ points }: { points: SeriesPoint[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    const usable = points.filter((p) => p.portfolio != null || p.spy != null);
    if (usable.length < 2) return null;
    const values = usable.flatMap((p) =>
      [p.portfolio, p.spy].filter((v): v is number => v != null)
    );
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const x = (i: number) => PAD_L + (i / (usable.length - 1)) * (W - PAD_L - PAD_R);
    const y = (v: number) => PAD_T + (1 - (v - min) / span) * (H - PAD_T - PAD_B);
    const path = (pick: (p: SeriesPoint) => number | null) => {
      let d = "";
      usable.forEach((p, i) => {
        const v = pick(p);
        if (v == null) return;
        d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      });
      return d;
    };
    return {
      usable,
      x,
      y,
      min,
      max,
      portfolioPath: path((p) => p.portfolio),
      spyPath: path((p) => p.spy),
    };
  }, [points]);

  if (!model) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-[8px] bg-bone-100 text-[13px] leading-4 text-slate-400">
        Not enough chart data yet
      </div>
    );
  }

  const { usable, x, y, min, max } = model;
  const hovered = hover != null ? usable[hover] : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD_L) / (W - PAD_L - PAD_R)) * (usable.length - 1));
    setHover(Math.max(0, Math.min(usable.length - 1, i)));
  };

  const gridValues = [max, (max + min) / 2, min];

  return (
    <div className="relative">
      {/* Legend */}
      <div className="mb-2 flex items-center gap-4 text-[12px] leading-4 text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-4 rounded-full bg-green-600" /> Album
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-4 rounded-full bg-signal-blue" /> S&amp;P 500
        </span>
        <span className="ml-auto text-slate-400">100 = start</span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {gridValues.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--color-bone-200)"
              strokeDasharray="3 4"
            />
            <text
              x={PAD_L - 6}
              y={y(v) + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--color-slate-400)"
            >
              {Math.round(v)}
            </text>
          </g>
        ))}

        <path d={model.spyPath} fill="none" stroke="var(--color-signal-blue)" strokeWidth="1.5" opacity="0.85" />
        <path d={model.portfolioPath} fill="none" stroke="var(--color-green-600)" strokeWidth="2" />

        {/* x labels: first / middle / last */}
        {[0, Math.floor((usable.length - 1) / 2), usable.length - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === usable.length - 1 ? "end" : "middle"}
            fontSize="10"
            fill="var(--color-slate-400)"
          >
            {tick(usable[i].date)}
          </text>
        ))}

        {hovered && hover != null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="var(--color-slate-300)"
              strokeDasharray="2 3"
            />
            {hovered.portfolio != null && (
              <circle cx={x(hover)} cy={y(hovered.portfolio)} r="3.5" fill="var(--color-green-600)" stroke="white" strokeWidth="1.5" />
            )}
            {hovered.spy != null && (
              <circle cx={x(hover)} cy={y(hovered.spy)} r="3" fill="var(--color-signal-blue)" stroke="white" strokeWidth="1.5" />
            )}
          </g>
        )}
      </svg>

      {hovered && hover != null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-ink px-3 py-1.5 text-[12px] leading-4 text-white"
          style={{
            left: `${Math.min(Math.max((x(hover) / W) * 100, 12), 88)}%`,
            top: 18,
          }}
        >
          <span className="text-white/60">
            {new Date(hovered.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </span>
          {hovered.portfolio != null && (
            <span className="ml-2 font-medium">{Math.round(hovered.portfolio)}</span>
          )}
          {hovered.spy != null && (
            <span className="ml-2 text-white/70">S&amp;P {Math.round(hovered.spy)}</span>
          )}
        </div>
      )}
    </div>
  );
}
