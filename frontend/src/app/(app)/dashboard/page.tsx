"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchEarnings, fetchFeed, fetchMe } from "@/lib/api";
import { formatEuros, timeAgo } from "@/lib/format";
import { Badge, Button, Eyebrow, StatCard } from "@/components/ui";
import { EarningsChartCard } from "@/components/earnings-chart";
import { ReferralCode } from "@/components/referral-code";

export default function DashboardPage() {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const { data: earnings } = useQuery({ queryKey: ["earnings"], queryFn: fetchEarnings });
  const { data: breaking } = useQuery({ queryKey: ["feed", "breaking"], queryFn: () => fetchFeed("breaking") });
  const { data: movers } = useQuery({ queryKey: ["feed", "movers"], queryFn: () => fetchFeed("movers") });

  const firstName = me?.name?.split(" ")[0] || "there";

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-6">
        <Eyebrow icon="ph-hand-waving">Dashboard</Eyebrow>
        <h1 className="display-md text-ink">
          Hi {firstName}.
          <br />
          Here is where you stand.
        </h1>
      </div>

      {/* The chart leads: how earnings are trending is the question this page
          exists to answer, and the totals below read as its summary. */}
      <EarningsChartCard />

      <div className="flex flex-col gap-10 sm:flex-row">
        <StatCard
          value={earnings ? formatEuros(earnings.earned_cents) : "—"}
          description="Total earned"
        />
        {/* This month's earnings not yet settled — balances pay out monthly, so
            what a creator is waiting on is the month in progress. */}
        <StatCard
          value={earnings ? formatEuros(earnings.pending_cents) : "—"}
          description="Pending to pay"
        />
        <StatCard
          value={earnings ? String(earnings.verified_videos) : "—"}
          description="Videos verified"
        />
        <StatCard
          value={earnings ? String(earnings.referral.clients) : "—"}
          description="Referrals signed up"
        />
      </div>

      {/* Referral code — always one click away */}
      <div className="dashed-card flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between lg:p-8">
        <div className="flex flex-col gap-2">
          <div className="text-[18px] font-medium leading-6 text-ink">Your referral code</div>
          <p className="max-w-[520px] text-[15px] leading-5 text-slate-500">
            Clients who enter it when they join Stalvian pay you{" "}
            {earnings ? `${earnings.formula.commission_pct}%` : "a share"} of their fees.
            {earnings && earnings.referral.clients > 0 && (
              <>
                {" "}
                <span className="text-ink">
                  {earnings.referral.active_clients} active client
                  {earnings.referral.active_clients === 1 ? "" : "s"} ·{" "}
                  {formatEuros(earnings.commission_earned_cents)} earned from fees.
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <ReferralCode code={me?.referral_code ?? earnings?.referral.code} />
          <Link href="/earnings" className="text-[14px] leading-5 text-blue">
            How it works
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Latest breaking */}
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div className="text-[18px] font-medium leading-6 text-ink">Breaking News</div>
            <Link href="/daily-scripts?type=breaking" className="text-[14px] leading-5 text-blue">
              View all
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {(breaking?.items || []).slice(0, 3).map((story) => (
              <Link
                key={story.id}
                href="/daily-scripts?type=breaking"
                className="dashed-card flex flex-col gap-2 p-5 hover:bg-bone-100"
              >
                <span className="text-[12px] leading-4 text-slate-400">
                  {timeAgo(story.published_at)}
                </span>
                <span className="text-[15px] font-medium leading-5 text-ink">{story.title}</span>
              </Link>
            ))}
            {breaking && !breaking.items?.length && (
              <p className="text-[15px] leading-5 text-slate-500">No stories yet — check back soon.</p>
            )}
          </div>
        </div>

        {/* Latest movers */}
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div className="text-[18px] font-medium leading-6 text-ink">Movers</div>
            <Link href="/daily-scripts?type=movers" className="text-[14px] leading-5 text-blue">
              View all
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {(movers?.items || []).slice(0, 3).map((story) => (
              <Link
                key={story.id}
                href="/daily-scripts?type=movers"
                className="dashed-card flex flex-col gap-2 p-5 hover:bg-bone-100"
              >
                <div className="flex items-center gap-2">
                  {story.ticker && <Badge tone="ink">${story.ticker}</Badge>}
                  <span className="text-[12px] leading-4 text-slate-400">
                    {timeAgo(story.published_at)}
                  </span>
                </div>
                <span className="text-[15px] font-medium leading-5 text-ink">
                  {story.title || story.headline}
                </span>
              </Link>
            ))}
            {movers && !movers.items?.length && (
              <p className="text-[15px] leading-5 text-slate-500">No stories yet — check back soon.</p>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-col gap-5">
          <div className="text-[18px] font-medium leading-6 text-ink">Make a video today</div>
          <div className="flex flex-col gap-3">
            <Link href="/album-stories">
              <Button kind="secondary" className="w-full justify-between" icon="ph-vinyl-record">
                Generate an Album Story <i className="ph ph-arrow-right" />
              </Button>
            </Link>
            <Link href="/my-videos">
              <Button kind="secondary" className="w-full justify-between" icon="ph-link">
                Submit a Video Link <i className="ph ph-arrow-right" />
              </Button>
            </Link>
            <Link href="/earnings">
              <Button kind="secondary" className="w-full justify-between" icon="ph-currency-eur">
                See How Pay Works <i className="ph ph-arrow-right" />
              </Button>
            </Link>
          </div>
          {earnings && earnings.pending_videos > 0 && (
            <p className="text-[14px] leading-5 text-slate-500">
              {earnings.pending_videos} video{earnings.pending_videos > 1 ? "s" : ""} awaiting
              view verification.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
