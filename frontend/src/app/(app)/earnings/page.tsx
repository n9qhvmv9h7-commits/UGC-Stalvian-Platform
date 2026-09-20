"use client";

/* Earnings — one balance, two streams, kept visually separate.

   This page is a dashboard, not an explainer. After the daily chart it splits
   into the two ways a creator earns: "Earnings from Views" (per-video, or
   per-post for an X account) and
   "Earnings from Trades" (a share of the fees referred clients pay). Each
   carries its own headline number and its own stats; anything spanning both —
   balance, all-time total, payouts — stays outside them.

   The pay rules and the simulator live behind the "How pay is calculated"
   button. They are read once and then never again, so they do not earn
   permanent space next to numbers a creator checks weekly. */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchEarnings, fetchMe, fetchMyReferrals, fetchMyVideos, type PayoutFormula } from "@/lib/api";
import { surfaceOf } from "@/lib/surface";
import { PLATFORM_ICONS, formatDate, formatEuros, formatViews } from "@/lib/format";
import { Badge, Eyebrow, StatCard } from "@/components/ui";
import { EarningsChartCard } from "@/components/earnings-chart";
import { Modal } from "@/components/modal";

/* Mirror of payout._curve + the launch multiplier, so the simulator says
   what the backend will pay today. */
function payoutFor(views: number, f: PayoutFormula): number {
  if (views < f.min_views) return 0;
  const thousands = Math.floor(views / 1000);
  const tier1Max = f.tier1_up_to_views / 1000;
  const tier1 = Math.max(Math.min(thousands - 1, tier1Max - 1), 0) * f.tier1_cents_per_1k;
  const tier2 = Math.max(thousands - tier1Max, 0) * f.tier2_cents_per_1k;
  const base = Math.min(f.base_cents + tier1 + tier2, f.cap_cents);
  return f.launch_active ? Math.min(Math.round(base * f.launch_multiplier), f.cap_cents) : base;
}

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

/* One row: the section's name on the left and its total on the right. The big
   serif taglines that used to sit here were prose on a page of numbers, and
   every stat card drew its own rule underneath — together they made a wall of
   lines with nothing to anchor. The dashed card around the section now carries
   the separation, so this needs no rule of its own. */
/* Styled like the chart's own controls, so every actionable pill on this page
   looks the same. */
function ExplainButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 cursor-pointer items-center gap-2 rounded-full bg-bone-100 px-4 text-[13px] font-medium leading-4 text-ink hover:bg-bone-200"
    >
      <i className="ph ph-calculator text-[16px] text-slate-500" />
      How pay is calculated
    </button>
  );
}

type Rule = { icon: string; term: string; body: string };

function RuleList({ rules, columns = 1 }: { rules: Rule[]; columns?: 1 | 2 }) {
  return (
    <div className={`grid grid-cols-1 gap-5 ${columns === 2 ? "sm:grid-cols-2" : ""}`}>
      {rules.map((row) => (
        <div key={row.term} className="flex gap-4">
          <i className={`ph ${row.icon} mt-0.5 shrink-0 text-[20px] text-slate-400`} />
          <div className="flex flex-col gap-1">
            <div className="text-[15px] font-medium leading-6 text-ink">{row.term}</div>
            <p className="text-[14px] leading-5 text-slate-500">{row.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function StreamHeader({
  icon,
  eyebrow,
  onExplain,
}: {
  icon: string;
  eyebrow: string;
  onExplain: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
      <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
      <ExplainButton onClick={onExplain} />
    </div>
  );
}

/* A borderless figure. StatCard's top rule is right for the page's headline
   numbers; inside a section it just adds another line. */
function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-serif text-[30px] leading-9 text-ink">{value}</div>
      <div className="text-[14px] leading-5 text-slate-500">{label}</div>
    </div>
  );
}

export default function EarningsPage() {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  /* Both surfaces earn the same two ways, from the same formula — only the
     word for the thing that earns changes. An X creator submits posts and is
     paid per view on them exactly as a video creator is. */
  const tweets = surfaceOf(me).type === "tweets";
  const noun = tweets ? "post" : "video";
  const nounPlural = tweets ? "posts" : "videos";
  const { data } = useQuery({ queryKey: ["earnings"], queryFn: fetchEarnings });
  const { data: referrals } = useQuery({ queryKey: ["my-referrals"], queryFn: fetchMyReferrals });
  const { data: videos } = useQuery({ queryKey: ["videos"], queryFn: fetchMyVideos });
  const [simViews, setSimViews] = useState(tweets ? 5000 : 25000);
  /* Which stream's rules are open. Each section explains only itself — a
     creator asking "why did this video pay that?" should not have to read
     the referral rules to find out. */
  const [explainer, setExplainer] = useState<"views" | "trades" | null>(null);

  const simPayout = useMemo(
    () => (data ? payoutFor(simViews, data.formula) : 0),
    [data, simViews]
  );

  const commissionPct = referrals?.commission_pct ?? data?.formula.commission_pct;
  const pct = commissionPct !== undefined ? `${commissionPct}%` : "a share";

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-6">
        <Eyebrow icon="ph-currency-eur">Earnings</Eyebrow>
        <h1 className="display-md max-w-[720px] text-ink">
          Two ways to earn.
          <br />
          No surprises.
        </h1>
      </div>

      <EarningsChartCard />

      {/* Across both streams — the numbers a creator actually gets paid on */}
      <div className="flex flex-col gap-10 sm:flex-row">
        <StatCard value={data ? formatEuros(data.balance_cents) : "—"} description="Current balance" />
        <StatCard value={data ? formatEuros(data.earned_cents) : "—"} description="Earned all-time" />
        <StatCard value={data ? formatEuros(data.paid_cents) : "—"} description="Paid out to date" />
      </div>

      {/* ---------------- Stream 1: views ---------------- */}
      <section className="dashed-card flex flex-col gap-6 p-6 lg:p-8">
        <StreamHeader
          icon={tweets ? "ph-x-logo" : "ph-play-circle"}
          eyebrow="Earnings from Views"
          onExplain={() => setExplainer("views")}
        />
        {/* Boxed: a tinted panel separates the three figures from the video
            table below without drawing another rule across the page. */}
        <div className="grid grid-cols-2 gap-6 rounded-[8px] bg-bone-100 p-6 sm:grid-cols-4">
          <Stat
            value={data ? formatEuros(data.views_earned_cents) : "—"}
            label="Earned from views, all-time"
          />
          <Stat value={data ? formatViews(data.total_views) : "—"} label="Views counting toward pay" />
          <Stat
            value={data ? String(data.verified_videos) : "—"}
            label={`Verified ${nounPlural}`}
          />
          <Stat value={data ? String(data.pending_videos) : "—"} label="Awaiting review" />
        </div>

        {/* Per-video breakdown — the section total, itemized. `eligible_views`
            (not raw views) is what the money is computed from, so that is the
            column shown: anything else would not add up to the payout beside it. */}
        {videos && !!videos.items?.length && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead>
                <tr className="border-b border-ink">
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">
                    {tweets ? "Post" : "Video"}
                  </th>
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Posted</th>
                  <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">
                    Views counting
                  </th>
                  <th className="py-3 text-right text-[13px] font-medium leading-5 text-slate-500">
                    Earned
                  </th>
                </tr>
              </thead>
              <tbody>
                {(videos.items ?? []).map((v) => (
                  <tr key={v.id} className="border-b border-bone-200">
                    <td className="max-w-[320px] py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <i
                          className={`ph ${PLATFORM_ICONS[v.platform] || "ph-video"} shrink-0 text-[18px] text-slate-400`}
                        />
                        <a
                          href={v.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate text-[15px] leading-5 text-ink hover:underline"
                        >
                          {v.title || v.url}
                        </a>
                        {v.status !== "verified" && (
                          <Badge tone={v.status === "pending" ? "warn" : "neutral"}>{v.status}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4 text-[14px] leading-5 text-slate-500">
                      {formatDate(v.created_at)}
                    </td>
                    <td className="py-3 pr-4 text-right text-[14px] leading-5 text-slate-500">
                      {formatViews(v.eligible_views)}
                    </td>
                    <td className="py-3 text-right font-serif text-[18px] leading-6 text-ink">
                      {formatEuros(v.payout_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {videos && !videos.items?.length && (
          <p className="text-[14px] leading-5 text-slate-500">
            No {nounPlural} yet — submit your first link in My{" "}
            {tweets ? "Posts" : "Videos"}.
          </p>
        )}
      </section>

      {/* ---------------- Stream 2: trades ---------------- */}
      <section className="dashed-card flex flex-col gap-6 p-6 lg:p-8">
        <StreamHeader
          icon="ph-handshake"
          eyebrow="Earnings from Trades"
          onExplain={() => setExplainer("trades")}
        />

        {/* Same shape as the Views section: boxed figures, then the itemized
            list that adds up to them — clients here instead of videos. */}
        <div className="grid grid-cols-2 gap-6 rounded-[8px] bg-bone-100 p-6 sm:grid-cols-3">
          <Stat
            value={referrals ? String(referrals.active_clients) : "—"}
            label={
              referrals && referrals.clients.length !== referrals.active_clients
                ? `Active clients (${referrals.clients.length} all-time)`
                : "Active clients"
            }
          />
          <Stat
            value={referrals ? formatEuros(referrals.fees_cents) : "—"}
            label="Fees your clients have paid"
          />
          <Stat
            value={referrals ? formatEuros(referrals.commission_cents) : "—"}
            label="Your share of those fees"
          />
        </div>

        {referrals && referrals.clients.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead>
                <tr className="border-b border-ink">
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Client</th>
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Joined</th>
                  <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">
                    Fees paid
                  </th>
                  <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">
                    Your share
                  </th>
                  <th className="py-3 text-[13px] font-medium leading-5 text-slate-500">
                    Earning until
                  </th>
                </tr>
              </thead>
              <tbody>
                {referrals.clients.map((c) => (
                  <tr key={c.id} className="border-b border-bone-200">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <i className="ph ph-user-circle shrink-0 text-[18px] text-slate-400" />
                        <span className="text-[15px] leading-5 text-ink">{c.label}</span>
                        {c.status === "churned" && <Badge tone="neutral">left</Badge>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4 text-[14px] leading-5 text-slate-500">
                      {formatDate(c.attributed_at)}
                    </td>
                    <td className="py-3 pr-4 text-right text-[14px] leading-5 text-slate-500">
                      {formatEuros(c.fees_cents)}
                    </td>
                    <td className="py-3 pr-4 text-right font-serif text-[18px] leading-6 text-ink">
                      {formatEuros(c.commission_cents)}
                    </td>
                    <td className="whitespace-nowrap py-3 text-[13px] leading-5">
                      {c.earning_until ? (
                        <span className={c.window_open ? "text-slate-400" : "text-slate-300 line-through"}>
                          {formatDate(c.earning_until)}
                        </span>
                      ) : (
                        <span className="text-slate-300">no trades yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {referrals && referrals.clients.length === 0 && (
          <p className="text-[14px] leading-5 text-slate-500">
            No clients yet — share your code and the first person who signs up with it appears
            here.
          </p>
        )}
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

      {/* Two separate explainers, one per stream. Every figure comes from the
          live formula endpoint, so a config change can never leave this text
          saying something the backend no longer does. */}
      <Modal
        open={explainer === "views"}
        onClose={() => setExplainer(null)}
        title={`How ${noun} pay is calculated`}
      >
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.3fr_1fr]">
          <div className="flex flex-col gap-5">
            <RuleList
              rules={
                data
                  ? [
                      {
                        icon: "ph-flag",
                        term: `Nothing pays below ${formatViews(data.formula.min_views)} views`,
                        body: `A ${noun} earns €0,00 until it crosses ${formatViews(data.formula.min_views)} views. There is no partial pay under the threshold — the moment it crosses, the full base kicks in.`,
                      },
                      {
                        icon: "ph-currency-eur",
                        term: `Base: ${formatEuros(data.formula.base_cents)}`,
                        body: `Paid in full the moment the ${noun} passes ${formatViews(data.formula.min_views)} views, whatever happens afterwards.`,
                      },
                      {
                        icon: "ph-trend-up",
                        term: `Growth: +${formatEuros(data.formula.tier1_cents_per_1k)} per 1.000 views`,
                        body: `Every additional 1.000 views above the threshold adds ${formatEuros(data.formula.tier1_cents_per_1k)}, up to ${formatViews(data.formula.tier1_up_to_views)} views. Partial thousands do not count — the counter moves in whole 1.000s.`,
                      },
                      {
                        icon: "ph-rocket-launch",
                        term: `Scale: +${formatEuros(data.formula.tier2_cents_per_1k)} per 1.000 views`,
                        body: `Past ${formatViews(data.formula.tier1_up_to_views)} views the rate halves, but it never stops — a ${noun} that keeps running keeps adding.`,
                      },
                      {
                        icon: "ph-shield-check",
                        term: `Cap: ${formatEuros(data.formula.cap_cents)} per ${noun}`,
                        body: `One ${noun} cannot earn more than this, no matter how far it travels. The cap is per ${noun}, not per month — ten capped ${nounPlural} pay ten times the cap.`,
                      },
                      ...(data.formula.first_posts > 0
                        ? [
                            {
                              icon: "ph-gift",
                              term: `Your first ${data.formula.first_posts} posts earn ${formatEuros(data.formula.first_post_bonus_cents)} extra`,
                              body: `Each of your first ${data.formula.first_posts} verified posts adds ${formatEuros(data.formula.first_post_bonus_cents)} on top of its view pay, whatever its reach — even under ${formatViews(data.formula.min_views)} views. Once, per account.`,
                            },
                          ]
                        : []),
                      ...(data.formula.launch_active && data.formula.launch_until
                        ? [
                            {
                              icon: "ph-rocket",
                              term: `Launch bonus: ×${data.formula.launch_multiplier.toLocaleString("de-DE")} until ${formatLongDate(data.formula.launch_until)}`,
                              body: `Every post submitted on or before ${formatLongDate(data.formula.launch_until)} has its view pay multiplied by ${data.formula.launch_multiplier.toLocaleString("de-DE")}, for the life of that post. The cap still applies.`,
                            },
                          ]
                        : []),
                      {
                        icon: "ph-timer",
                        term: `Only the first ${data.formula.window_days} days count`,
                        body: `Views are counted from the day you submit the link. On day ${data.formula.window_days} the number freezes and that ${noun}'s pay is final — later views are real reach, but they do not add money.`,
                      },
                      {
                        icon: "ph-paper-plane-tilt",
                        term: `Submit within ${data.formula.submit_within_days} days of posting`,
                        body: `Because the clock starts at submission, a link posted long ago would otherwise cash in its whole history at once. Links older than ${data.formula.submit_within_days} days are rejected.`,
                      },
                      {
                        icon: "ph-seal-check",
                        term: "Views have to be verified",
                        body: tweets
                          ? "X publishes no view count we can read, so the Stalvian team checks every post by hand — it sits as “pending” until then, and pending posts pay nothing yet."
                          : "YouTube is checked automatically against the platform. TikTok and Instagram have no public numbers, so the Stalvian team verifies those by hand — the video sits as “pending” until then, and pending videos pay nothing yet.",
                      },
                      {
                        icon: "ph-warning",
                        term: `Keep your ${nounPlural} up`,
                        body: `Deleting a ${noun} after posting is a strike, and it stops earning the moment it comes down. Two strikes end the partnership.`,
                      },
                    ]
                  : []
              }
            />
          </div>

          <div className="flex flex-col gap-6 self-start rounded-[8px] bg-cream p-6">
            <h3 className="display-xs text-ink">What would my {noun} earn?</h3>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[15px] leading-6 text-slate-500">Views</span>
                <span className="font-serif text-[28px] leading-9 text-ink">{formatViews(simViews)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={data?.formula.kind === "x" ? 100000 : 500000}
                step={data?.formula.kind === "x" ? 500 : 1000}
                value={simViews}
                onChange={(e) => setSimViews(Number(e.target.value))}
                className="w-full accent-black"
              />
            </div>
            <div className="flex items-baseline justify-between border-t border-ink pt-5">
              <span className="text-[15px] leading-6 text-slate-500">
                You earn{data?.formula.launch_active ? " (launch bonus in)" : ""}
              </span>
              <span className="font-serif text-[40px] leading-[48px] text-green-600">
                {data ? formatEuros(simPayout) : "—"}
              </span>
            </div>
            {data && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] leading-5 text-slate-500">
                {data.formula.examples
                  .filter((e) =>
                    (data.formula.kind === "x" ? [500, 2000, 10000, 50000] : [1000, 10000, 50000, 100000]).includes(e.views)
                  )
                  .map((e) => (
                    <span key={e.views}>
                      {formatViews(e.views)} → {formatEuros(payoutFor(e.views, data.formula))}
                    </span>
                  ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={explainer === "trades"}
        onClose={() => setExplainer(null)}
        title="How trade pay is calculated"
      >
        <RuleList
          columns={2}
          rules={[
            {
              icon: "ph-ticket",
              term: "A client is someone who used your code",
              body: "They enter it while opening their Stalvian account. That one step ties them to you permanently — there is nothing to renew and no link to keep alive.",
            },
            {
              icon: "ph-percent",
              term: `You keep ${pct} of their fees`,
              body: `Every fee a client pays inside their year pays you ${pct} of it. Your share is worked out and stored at the moment the fee happens, so a later change to the rate never rewrites what you already earned.`,
            },
            {
              icon: "ph-hourglass",
              term: `One year from their first trade`,
              body: `The clock starts when a client first trades, not when they sign up — someone who opens an account and trades months later still earns you a full year. After ${referrals ? Math.round(referrals.commission_days / 365) : 1} year their fees stop paying you.`,
            },
            {
              icon: "ph-infinity",
              term: "No cap inside that year",
              body: `Unlike ${noun} pay there is no ceiling: a client who trades heavily for twelve months pays you on every one of those fees.`,
            },
            {
              icon: "ph-user-minus",
              term: "If a client leaves, you keep what they paid",
              body: "They are marked “left” and stop generating new fees, but everything they already paid you stays in your balance. The same is true when their year runs out.",
            },
            {
              icon: "ph-eye-slash",
              term: "You never see who they are",
              body: "Clients appear under a masked label such as m***@gmail.com. You can see what they paid and what you earned, never their identity.",
            },
            {
              icon: "ph-wallet",
              term: "Paid from the same balance",
              body: `Your share of client fees lands in the same balance as your ${noun} pay, and the Stalvian team pays it out monthly.`,
            },
          ]}
        />
      </Modal>
    </div>
  );
}
