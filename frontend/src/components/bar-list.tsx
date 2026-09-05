"use client";

/* BarList — horizontal ink bars for ranked breakdowns (platforms, albums,
   creator leaderboards). Values formatted by the caller via `format`. */

import { formatViews } from "@/lib/format";

export interface BarRow {
  label: string;
  value: number;
  icon?: string;
  sub?: string;
  tone?: "ink" | "green";
}

export function BarList({
  rows,
  labelWidth = "w-28",
  format = formatViews,
}: {
  rows: BarRow[];
  labelWidth?: string;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="flex items-center gap-3">
          <span
            className={`flex ${labelWidth} shrink-0 items-center gap-2 truncate text-[13px] font-medium leading-5 text-ink`}
          >
            {r.icon && <i className={`ph ${r.icon} text-[16px]`} />}
            <span className="truncate">{r.label}</span>
          </span>
          <div className="h-[8px] flex-1 overflow-hidden rounded-full bg-bone-100">
            <div
              className={`h-full rounded-full ${r.tone === "green" ? "bg-green-600" : "bg-ink"}`}
              style={{ width: `${Math.max((r.value / max) * 100, 2)}%` }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-[13px] leading-5 text-slate-500">
            {format(r.value)}
          </span>
          {r.sub !== undefined && (
            <span className="w-20 shrink-0 text-right text-[12px] leading-4 text-slate-400">
              {r.sub}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
