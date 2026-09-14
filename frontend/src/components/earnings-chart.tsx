"use client";

/* The daily earnings chart, shared by the Dashboard and the Earnings page.

   It owns its own filters and its own query rather than taking them as props:
   both pages want the identical control, and React Query keys the fetch on the
   horizon, so navigating between them reuses the cached response instead of
   refetching. One component also means the two pages can never drift apart on
   what "earnings per day" means. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDailyEarnings, type DailyEarnings } from "@/lib/api";
import { formatEuros } from "@/lib/format";
import { DailyBarChart } from "@/components/bar-chart";

const HORIZONS = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
];

/* Which payout stream the chart is showing. The API returns all three numbers
   per day, so switching re-reads the loaded response — it never refetches. */
export type Stream = "all" | "views" | "trades";

const STREAMS: {
  value: Stream;
  label: string;
  day: (d: DailyEarnings["days"][number]) => number;
  total: (t: DailyEarnings) => number;
}[] = [
  { value: "all", label: "Both", day: (d) => d.earned_cents, total: (t) => t.total_cents },
  { value: "views", label: "Views", day: (d) => d.views_cents, total: (t) => t.views_cents },
  { value: "trades", label: "Trades", day: (d) => d.commission_cents, total: (t) => t.commission_cents },
];

/* The segmented pill control used for both chart filters. */
export function Pills<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex gap-1 rounded-full bg-bone-100 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`cursor-pointer rounded-full px-4 py-1.5 text-[13px] font-medium leading-4 ${
            value === o.value ? "bg-ink text-white" : "text-slate-500 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EarningsChartCard({ defaultHorizon = 30 }: { defaultHorizon?: number }) {
  const [horizon, setHorizon] = useState(defaultHorizon);
  const [stream, setStream] = useState<Stream>("all");
  const { data: daily } = useQuery({
    queryKey: ["earnings-daily", horizon],
    queryFn: () => fetchDailyEarnings(horizon),
    placeholderData: (prev) => prev, // keep bars while a new horizon loads
  });

  const active = STREAMS.find((s) => s.value === stream)!;
  const horizonLabel = HORIZONS.find((h) => h.value === horizon)?.label;

  return (
    <div className="dashed-card flex flex-col gap-6 p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="display-xs text-ink">Earnings per day</h2>
          <p className="text-[14px] leading-5 text-slate-500">
            {daily ? (
              <>
                <span className="font-medium text-ink">{formatEuros(active.total(daily))}</span>{" "}
                {stream === "views" ? "from views" : stream === "trades" ? "from trades" : "earned"} in
                the last {horizonLabel}
                {stream === "all" && daily.total_cents > 0 && (
                  <span className="text-slate-400">
                    {" "}· {formatEuros(daily.views_cents)} views ·{" "}
                    {formatEuros(daily.commission_cents)} trades
                  </span>
                )}
              </>
            ) : (
              "Loading…"
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pills value={stream} onChange={setStream} options={STREAMS} />
          <Pills value={horizon} onChange={setHorizon} options={HORIZONS} />
        </div>
      </div>
      {daily && (
        <DailyBarChart
          data={daily.days.map((d) => ({ date: d.date, value_cents: active.day(d) }))}
        />
      )}
      {daily && active.total(daily) === 0 && (
        <p className="text-[14px] leading-5 text-slate-500">Nothing in this period yet.</p>
      )}
    </div>
  );
}
