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
import { Dropdown } from "@/components/ui";
import {
  DateRangePicker,
  lastNDays,
  rangeLabel,
  toISODate,
  type DateRange,
} from "@/components/date-range";

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

export function EarningsChartCard({ defaultDays = 30 }: { defaultDays?: number }) {
  const [range, setRange] = useState<DateRange>(() => lastNDays(defaultDays));
  const [stream, setStream] = useState<Stream>("all");
  // ISO strings, not Date objects: the query key has to be value-comparable,
  // and they are exactly what the request sends.
  const from = toISODate(range.start);
  const to = toISODate(range.end);
  const { data: daily } = useQuery({
    queryKey: ["earnings-daily", from, to],
    queryFn: () => fetchDailyEarnings({ start: from, end: to }),
    placeholderData: (prev) => prev, // keep bars while a new range loads
  });

  const active = STREAMS.find((s) => s.value === stream)!;

  return (
    <div className="dashed-card flex flex-col gap-6 p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="display-xs text-ink">Earnings per day</h2>
          <p className="text-[14px] leading-5 text-slate-500">
            {daily ? (
              <>
                <span className="font-medium text-ink">{formatEuros(active.total(daily))}</span>{" "}
                {stream === "views" ? "from views" : stream === "trades" ? "from trades" : "earned"}{" "}
                · {rangeLabel(range)}
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
          <Dropdown
            value={stream}
            onChange={setStream}
            options={STREAMS.map((s) => ({ value: s.value, label: s.label }))}
            icon="ph-funnel"
          />
          <DateRangePicker value={range} onChange={setRange} />
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
