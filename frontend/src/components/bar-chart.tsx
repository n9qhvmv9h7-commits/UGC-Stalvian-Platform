"use client";

/* DailyBarChart — single-series bar chart in the Stalvian system.
   Ink bars anchored to an ink baseline, recessive dashed gridlines, gold
   hover state with a per-bar tooltip. Pure HTML/CSS, no chart library. */

import { useState } from "react";
import { formatEuros } from "@/lib/format";

export interface BarDatum {
  date: string;
  value_cents: number;
}

/* Smallest "nice" ceiling ≥ max so the top gridline label reads cleanly. */
function niceCeil(value: number, minCeiling: number): number {
  if (value <= 0) return minCeiling;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * pow >= value) return Math.round(m * pow);
  }
  return Math.round(10 * pow);
}

function tickLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function DailyBarChart({
  data,
  height = 220,
  formatValue = formatEuros,
  minCeiling = 500,
}: {
  data: BarDatum[];
  height?: number;
  // value_cents is the generic value; euros are just the default rendering
  formatValue?: (v: number) => string;
  minCeiling?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceCeil(Math.max(0, ...data.map((d) => d.value_cents)), minCeiling);
  const gapPx = data.length > 120 ? 1 : 2;
  const hovered = hover !== null ? data[hover] : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3">
        {/* y-axis labels */}
        <div
          className="flex w-[56px] shrink-0 flex-col justify-between text-right text-[12px] leading-4 text-slate-400"
          style={{ height }}
        >
          <span>{formatValue(max)}</span>
          <span>{formatValue(max / 2)}</span>
          <span>{formatValue(0)}</span>
        </div>

        <div className="relative flex-1" style={{ height }}>
          {/* recessive gridlines + ink baseline */}
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-bone-200" />
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-bone-200" />
          <div className="absolute inset-x-0 bottom-0 border-b border-ink" />

          {/* bars — each column is a full-height hit target */}
          <div className="absolute inset-0 flex items-end" style={{ gap: gapPx }}>
            {data.map((d, i) => {
              const pct = max > 0 ? (d.value_cents / max) * 100 : 0;
              return (
                <div
                  key={d.date}
                  className="flex h-full min-w-0 flex-1 items-end"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  {d.value_cents > 0 && (
                    <div
                      className={`w-full rounded-t-[3px] transition-colors duration-75 ${
                        hover === i ? "bg-gold" : "bg-ink"
                      }`}
                      style={{ height: `${Math.max(pct, 1.5)}%` }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* tooltip */}
          {hovered && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[4px] bg-ink px-3 py-1.5"
              style={{
                left: `${Math.min(Math.max(((hover! + 0.5) / data.length) * 100, 8), 92)}%`,
                top: `${100 - (max > 0 ? (hovered.value_cents / max) * 100 : 0)}%`,
                marginTop: -8,
              }}
            >
              <span className="text-[12px] leading-4 text-white/60">
                {tickLabel(hovered.date)} ·{" "}
              </span>
              <span className="text-[12px] font-medium leading-4 text-white">
                {formatValue(hovered.value_cents)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* x-axis: first / middle / last date */}
      {data.length > 0 && (
        <div className="flex justify-between pl-[68px] text-[12px] leading-4 text-slate-400">
          <span>{tickLabel(data[0].date)}</span>
          {data.length > 2 && <span>{tickLabel(data[Math.floor(data.length / 2)].date)}</span>}
          <span>{tickLabel(data[data.length - 1].date)}</span>
        </div>
      )}
    </div>
  );
}
