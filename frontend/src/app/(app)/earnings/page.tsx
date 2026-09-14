"use client";

/* Earnings — one balance, two streams, kept visually separate.

   This page is a dashboard, not an explainer. After the daily chart it splits
   into the two ways a creator earns: "Earnings from Views" (per-video pay) and
   "Earnings from Trades" (a share of the fees referred clients pay). Each
   carries its own headline number and its own stats; anything spanning both —
   balance, all-time total, payouts — stays outside them.

   The pay rules and the simulator live behind the "How pay is calculated"
   button. They are read once and then never again, so they do not earn
   permanent space next to numbers a creator checks weekly. */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchEarnings, fetchMyReferrals, type PayoutFormula } from "@/lib/api";
import { formatDate, formatEuros, formatViews } from "@/lib/format";
import { Badge, Button, Eyebrow, StatCard } from "@/components/ui";
import { EarningsChartCard } from "@/components/earnings-chart";
import { Modal } from "@/components/modal";
import { ReferralCode } from "@/components/referral-code";

function payoutFor(views: number, f: PayoutFormula): number {
  if (views < f.min_views) return 0;
  const thousands = Math.floor(views / 1000);
  const tier1Max = f.tier1_up_to_views / 1000;
  const tier1 = Math.min(thousands - 1, tier1Max - 1) * f.tier1_cents_per_1k;
  const tier2 = Math.max(thousands - tier1Max, 0) * f.tier2_cents_per_1k;
  return Math.min(f.base_cents + tier1 + tier2, f.cap_cents);
}

function StreamHeader({
  icon,
  eyebrow,
  title,
  amount,
  amountLabel,
}: {
  icon: string;
  eyebrow: string;
  title: string;
  amount: string;
  amountLabel: string;
}) {
  return (
    <div className="flex flex-col gap-6 border-t-2 border-ink pt-6">
      <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <h2 className="display-sm max-w-[560px] text-ink">{title}</h2>
        <div className="flex flex-col gap-1 sm:text-right">
          <div className="display-md text-ink">{amount}</div>
          <div className="text-[14px] leading-5 text-slate-500">{amountLabel}</div>
        </div>
      </div>
    </div>
  );
}

export default function EarningsPage() {
  const { data } = useQuery({ queryKey: ["earnings"], queryFn: fetchEarnings });
  const { data: referrals } = useQuery({ queryKey: ["my-referrals"], queryFn: fetchMyReferrals });
  const [simViews, setSimViews] = useState(25000);
  const [explainerOpen, setExplainerOpen] = useState(false);

  const simPayout = useMemo(
    () => (data ? payoutFor(simViews, data.formula) : 0),
    [data, simViews]
  );

  const commissionPct = referrals?.commission_pct ?? data?.formula.commission_pct;
  const pct = commissionPct !== undefined ? `${commissionPct}%` : "a share";

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-6">
          <Eyebrow icon="ph-currency-eur">Earnings</Eyebrow>
          <h1 className="display-md max-w-[720px] text-ink">
            Two ways to earn.
            <br />
            No surprises.
          </h1>
        </div>
        <Button kind="secondary" size="m" icon="ph-calculator" onClick={() => setExplainerOpen(true)}>
          How pay is calculated
        </Button>
      </div>

      <EarningsChartCard />

      {/* Across both streams — the numbers a creator actually gets paid on */}
      <div className="flex flex-col gap-10 sm:flex-row">
        <StatCard value={data ? formatEuros(data.balance_cents) : "—"} description="Current balance" />
        <StatCard value={data ? formatEuros(data.earned_cents) : "—"} description="Earned all-time" />
        <StatCard value={data ? formatEuros(data.paid_cents) : "—"} description="Paid out to date" />
      </div>

      {/* ---------------- Stream 1: views ---------------- */}
      <section className="flex flex-col gap-8">
        <StreamHeader
          icon="ph-play-circle"
          eyebrow="Earnings from Views"
          title="Every video pays on the views it earns."
          amount={data ? formatEuros(data.views_earned_cents) : "—"}
          amountLabel="From video views, all-time"
        />
        <div className="flex flex-col gap-10 sm:flex-row">
          <StatCard
            value={data ? formatViews(data.total_views) : "—"}
            description="Views that count toward pay"
          />
          <StatCard value={data ? String(data.verified_videos) : "—"} description="Verified videos" />
          <StatCard
            value={data ? String(data.pending_videos) : "—"}
            description="Videos awaiting review"
          />
        </div>
      </section>

      {/* ---------------- Stream 2: trades ---------------- */}
      <section className="flex flex-col gap-8">
        <StreamHeader
          icon="ph-handshake"
          eyebrow="Earnings from Trades"
          title={`Your clients trade. You keep ${pct} of the fees.`}
          amount={data ? formatEuros(data.commission_earned_cents) : "—"}
          amountLabel="From client trades, all-time"
        />

        <div className="flex flex-col gap-8 rounded-[8px] bg-ink p-8 lg:p-10">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.2fr_1fr]">
            <div className="flex flex-col gap-6">
              <Eyebrow icon="ph-ticket" onDark>
                Your referral code
              </Eyebrow>
              <div className="flex flex-wrap items-center gap-4">
                <ReferralCode code={referrals?.code ?? data?.referral.code} size="l" onDark />
                {referrals?.signup_url && (
                  <a
                    href={referrals.signup_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-[14px] font-medium leading-5 text-white/70 hover:text-white"
                  >
                    Where clients sign up <i className="ph ph-arrow-up-right" />
                  </a>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-8 sm:flex-row lg:flex-col lg:gap-6">
              <StatCard
                onDark
                value={referrals ? String(referrals.active_clients) : "—"}
                description={
                  referrals && referrals.clients.length !== referrals.active_clients
                    ? `Active clients (${referrals.clients.length} all-time)`
                    : "Active clients"
                }
              />
              <StatCard
                onDark
                value={referrals ? formatEuros(referrals.fees_cents) : "—"}
                description="Fees your clients have paid"
              />
              <StatCard
                onDark
                value={referrals ? formatEuros(referrals.commission_cents) : "—"}
                description="Your share of those fees"
              />
            </div>
          </div>

          {referrals && referrals.clients.length > 0 && (
            <div className="overflow-x-auto border-t border-ink-500 pt-6">
              <table className="w-full min-w-[560px] text-left">
                <thead>
                  <tr className="border-b border-white/20">
                    <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-300">Client</th>
                    <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-300">Joined</th>
                    <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-300">Fees paid</th>
                    <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-300">Your share</th>
                    <th className="py-3 text-[13px] font-medium leading-5 text-slate-300">Last fee</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.clients.map((c) => (
                    <tr key={c.id} className="border-b border-white/10">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2 text-[15px] leading-5 text-white">
                          {c.label}
                          {c.status === "churned" && <Badge tone="neutral">left</Badge>}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-[14px] leading-5 text-slate-300">
                        {formatDate(c.attributed_at)}
                      </td>
                      <td className="py-3 pr-4 text-right text-[14px] leading-5 text-slate-300">
                        {formatEuros(c.fees_cents)}
                      </td>
                      <td className="py-3 pr-4 text-right font-serif text-[18px] leading-6 text-white">
                        {formatEuros(c.commission_cents)}
                      </td>
                      <td className="py-3 text-[13px] leading-5 text-slate-400">
                        {c.last_fee_at ? formatDate(c.last_fee_at) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {referrals && referrals.clients.length === 0 && (
            <p className="border-t border-ink-500 pt-6 text-[14px] leading-5 text-slate-400">
              No clients yet. Share your code — the first person who signs up with it appears here.
            </p>
          )}
        </div>
      </section>

      {/* Payout history — one balance, so one history across both streams */}
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

      {/* The rules + simulator: read once, then out of the way */}
      <Modal open={explainerOpen} onClose={() => setExplainerOpen(false)} title="How pay is calculated">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <h3 className="display-xs text-ink">Every video</h3>
            <div className="flex flex-col gap-4">
              {/* prose derives from the live formula so config changes can't make it lie */}
              {(data
                ? [
                    { icon: "ph-flag", text: `A video starts earning once it passes ${formatViews(data.formula.min_views)} views.` },
                    { icon: "ph-timer", text: `Views count for the first ${data.formula.window_days} days after posting — then the video's earnings lock in.` },
                    { icon: "ph-currency-eur", text: `Base pay: ${formatEuros(data.formula.base_cents)} at ${formatViews(data.formula.min_views)} views — guaranteed.` },
                    { icon: "ph-trend-up", text: `Growth: + ${formatEuros(data.formula.tier1_cents_per_1k)} for every extra 1.000 views, up to ${formatViews(data.formula.tier1_up_to_views)} views.` },
                    { icon: "ph-rocket-launch", text: `Scale: + ${formatEuros(data.formula.tier2_cents_per_1k)} per 1.000 views beyond ${formatViews(data.formula.tier1_up_to_views)}.` },
                    { icon: "ph-shield-check", text: `Cap: ${formatEuros(data.formula.cap_cents)} per video.` },
                    { icon: "ph-handshake", text: `Plus ${pct} of every fee your referred clients pay when they trade — no window, no cap.` },
                  ]
                : []
              ).map((row) => (
                <div key={row.text} className="flex items-center gap-4 text-[15px] leading-6 text-ink">
                  <i className={`ph ${row.icon} shrink-0 text-[20px]`} />
                  <span>{row.text}</span>
                </div>
              ))}
            </div>
            <p className="text-[14px] leading-5 text-slate-500">
              Views are verified before payout — automatically for YouTube, by the Stalvian team
              for TikTok and Instagram. Keep your videos live: deleting a posted video is a
              strike, and two strikes end the partnership.
            </p>
          </div>

          <div className="flex flex-col gap-6 self-start rounded-[8px] bg-cream p-6">
            <h3 className="display-xs text-ink">What would my video earn?</h3>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[15px] leading-6 text-slate-500">Views</span>
                <span className="font-serif text-[28px] leading-9 text-ink">{formatViews(simViews)}</span>
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
              <span className="text-[15px] leading-6 text-slate-500">You earn</span>
              <span className="font-serif text-[40px] leading-[48px] text-green-600">
                {data ? formatEuros(simPayout) : "—"}
              </span>
            </div>
            {data && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] leading-5 text-slate-500">
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
      </Modal>
    </div>
  );
}
