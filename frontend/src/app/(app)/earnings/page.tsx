"use client";

/* Earnings — the formula, verbatim and visual, plus balance and history. */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDailyEarnings, fetchEarnings } from "@/lib/api";
import { formatDate, formatEuros, formatViews } from "@/lib/format";
import { Eyebrow, StatCard } from "@/components/ui";
import { DailyBarChart } from "@/components/bar-chart";

const HORIZONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
];

function payoutFor(views: number, f: { min_views: number; base_cents: number; tier1_cents_per_1k: number; tier1_up_to_views: number; tier2_cents_per_1k: number; cap_cents: number }): number {
  if (views < f.min_views) return 0;
  const thousands = Math.floor(views / 1000);
  const tier1Max = f.tier1_up_to_views / 1000;
  const tier1 = Math.min(thousands - 1, tier1Max - 1) * f.tier1_cents_per_1k;
  const tier2 = Math.max(thousands - tier1Max, 0) * f.tier2_cents_per_1k;
  return Math.min(f.base_cents + tier1 + tier2, f.cap_cents);
}

export default function EarningsPage() {
  const { data } = useQuery({ queryKey: ["earnings"], queryFn: fetchEarnings });
  const [simViews, setSimViews] = useState(25000);
  const [horizon, setHorizon] = useState(30);
  const { data: daily } = useQuery({
    queryKey: ["earnings-daily", horizon],
    queryFn: () => fetchDailyEarnings(horizon),
    placeholderData: (prev) => prev, // keep bars while a new horizon loads
  });

  const simPayout = useMemo(
    () => (data ? payoutFor(simViews, data.formula) : 0),
    [data, simViews]
  );

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-6">
        <Eyebrow icon="ph-currency-eur">Earnings</Eyebrow>
        <h1 className="display-md max-w-[720px] text-ink">
          Simple pay.
          <br />
          No surprises.
        </h1>
      </div>

      {/* Daily earnings chart */}
      <div className="dashed-card flex flex-col gap-6 p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="display-xs text-ink">Earnings per day</h2>
            <p className="text-[14px] leading-5 text-slate-500">
              {daily ? (
                <>
                  <span className="font-medium text-ink">{formatEuros(daily.total_cents)}</span>{" "}
                  earned in the last {HORIZONS.find((h) => h.days === horizon)?.label}
                </>
              ) : (
                "Loading…"
              )}
            </p>
          </div>
          <div className="flex gap-1 rounded-full bg-bone-100 p-1">
            {HORIZONS.map((h) => (
              <button
                key={h.days}
                onClick={() => setHorizon(h.days)}
                className={`cursor-pointer rounded-full px-4 py-1.5 text-[13px] font-medium leading-4 ${
                  horizon === h.days ? "bg-ink text-white" : "text-slate-500 hover:text-ink"
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
        {daily && <DailyBarChart data={daily.days.map((d) => ({ date: d.date, value_cents: d.earned_cents }))} />}
        {daily && daily.total_cents === 0 && (
          <p className="text-[14px] leading-5 text-slate-500">
            No earnings in this period yet — they appear day by day as your verified videos
            gain views.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-10 sm:flex-row">
        <StatCard value={data ? formatEuros(data.balance_cents) : "—"} description="Current balance" />
        <StatCard value={data ? formatEuros(data.earned_cents) : "—"} description="Earned all-time" />
        <StatCard value={data ? formatEuros(data.paid_cents) : "—"} description="Paid out to date" />
        <StatCard value={data ? formatViews(data.total_views) : "—"} description="Verified views" />
      </div>

      {/* The formula, in words */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="dashed-card flex flex-col gap-6 p-8">
          <h2 className="display-sm text-ink">How every video earns</h2>
          <div className="flex flex-col gap-4">
            {/* prose derives from the live formula so config changes can't make it lie */}
            {(data
              ? [
                  { icon: "ph-flag", text: `A video starts earning once it passes ${formatViews(data.formula.min_views)} views.` },
                  { icon: "ph-timer", text: `Views count for the first ${data.formula.window_days} days after posting — then the video's earnings lock in.` },
                  { icon: "ph-currency-eur", text: `Base pay: ${formatEuros(data.formula.base_cents)} at ${formatViews(data.formula.min_views)} views — guaranteed.` },
                  { icon: "ph-trend-up", text: `Growth: + ${formatEuros(data.formula.tier1_cents_per_1k)} for every extra 1.000 views, up to ${formatViews(data.formula.tier1_up_to_views)} views.` },
                  { icon: "ph-rocket-launch", text: `Scale: + ${formatEuros(data.formula.tier2_cents_per_1k)} per 1.000 views beyond ${formatViews(data.formula.tier1_up_to_views)}.` },
                  { icon: "ph-shield-check", text: `Cap: ${formatEuros(data.formula.cap_cents)} per video. Balances are paid out monthly.` },
                ]
              : []
            ).map((row) => (
              <div key={row.text} className="flex items-center gap-4 text-[16px] leading-6 text-ink">
                <i className={`ph ${row.icon} shrink-0 text-[22px]`} />
                <span>{row.text}</span>
              </div>
            ))}
          </div>
          <p className="text-[14px] leading-5 text-slate-500">
            Views are verified before payout — automatically for YouTube, by the Stalvian
            team for TikTok and Instagram. Keep your videos live: deleting a posted video
            is a strike, and two strikes end the partnership.
          </p>
        </div>

        {/* Simulator */}
        <div className="flex flex-col gap-6 rounded-[8px] bg-cream p-8">
          <h2 className="display-sm text-ink">What would my video earn?</h2>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[16px] leading-6 text-slate-500">Views</span>
              <span className="font-serif text-[32px] leading-10 text-ink">{formatViews(simViews)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={500000}
              step={1000}
              value={simViews}
              onChange={(e) => setSimViews(Number(e.target.value))}
              className="w-full accent-black"
            />
          </div>
          <div className="flex items-baseline justify-between border-t border-ink pt-5">
            <span className="text-[16px] leading-6 text-slate-500">You earn</span>
            <span className="font-serif text-[52px] leading-[64px] text-green-600">
              {data ? formatEuros(simPayout) : "—"}
            </span>
          </div>
          {data && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[14px] leading-5 text-slate-500">
              {data.formula.examples
                .filter((e) => [1000, 10000, 50000, 100000].includes(e.views))
                .map((e) => (
                  <span key={e.views}>
                    {formatViews(e.views)} → {formatEuros(e.payout_cents)}
                  </span>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Payout history */}
      <div className="flex flex-col gap-5">
        <h2 className="display-sm text-ink">Payout history</h2>
        {data && data.payouts.length === 0 && (
          <p className="text-[16px] leading-6 text-slate-500">
            No payouts yet — they appear here once the Stalvian team sends your first one.
          </p>
        )}
        {data && data.payouts.length > 0 && (
          <table className="w-full max-w-[720px] text-left">
            <thead>
              <tr className="border-b border-ink">
                <th className="py-3 pr-4 text-[14px] font-medium leading-5 text-slate-500">Date</th>
                <th className="py-3 pr-4 text-[14px] font-medium leading-5 text-slate-500">Amount</th>
                <th className="py-3 text-[14px] font-medium leading-5 text-slate-500">Note</th>
              </tr>
            </thead>
            <tbody>
              {data.payouts.map((p) => (
                <tr key={p.id} className="border-b border-bone-200">
                  <td className="py-3 pr-4 text-[15px] leading-5 text-ink">{formatDate(p.created_at)}</td>
                  <td className="py-3 pr-4 font-serif text-[20px] leading-7 text-ink">{formatEuros(p.amount_cents)}</td>
                  <td className="py-3 text-[14px] leading-5 text-slate-500">{p.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
