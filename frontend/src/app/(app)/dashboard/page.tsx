"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchBreaking, fetchEarnings, fetchMe, fetchMovers, fetchMyVideos } from "@/lib/api";
import { formatEuros, formatViews, timeAgo } from "@/lib/format";
import { Badge, Button, Eyebrow, StatCard } from "@/components/ui";

export default function DashboardPage() {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const { data: earnings } = useQuery({ queryKey: ["earnings"], queryFn: fetchEarnings });
  const { data: videos } = useQuery({ queryKey: ["videos"], queryFn: fetchMyVideos });
  const { data: breaking } = useQuery({ queryKey: ["breaking", 1], queryFn: () => fetchBreaking(1) });
  const { data: movers } = useQuery({ queryKey: ["movers", 1], queryFn: () => fetchMovers(1) });

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

      <div className="flex flex-col gap-10 sm:flex-row">
        <StatCard
          value={earnings ? formatEuros(earnings.balance_cents) : "—"}
          description="Current balance, paid out monthly"
        />
        <StatCard
          value={earnings ? formatEuros(earnings.earned_cents) : "—"}
          description="Earned all-time across your videos"
        />
        <StatCard
          value={earnings ? formatViews(earnings.total_views) : "—"}
          description="Verified views across your videos"
        />
        <StatCard
          value={videos ? String(videos.items.length) : "—"}
          description="Videos submitted for tracking"
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Latest breaking */}
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div className="text-[18px] font-medium leading-6 text-ink">Breaking News</div>
            <Link href="/breaking-news" className="text-[14px] leading-5 text-blue">
              View all
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {(breaking?.items || []).slice(0, 3).map((story) => (
              <Link
                key={story.id}
                href="/breaking-news"
                className="dashed-card flex flex-col gap-2 p-5 hover:bg-bone-100"
              >
                <span className="text-[12px] leading-4 text-slate-400">
                  {timeAgo(story.published_at)}
                </span>
                <span className="text-[15px] font-medium leading-5 text-ink">{story.title}</span>
              </Link>
            ))}
            {breaking && breaking.items.length === 0 && (
              <p className="text-[15px] leading-5 text-slate-500">No stories yet — check back soon.</p>
            )}
          </div>
        </div>

        {/* Latest movers */}
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div className="text-[18px] font-medium leading-6 text-ink">Movers</div>
            <Link href="/movers" className="text-[14px] leading-5 text-blue">
              View all
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {(movers?.items || []).slice(0, 3).map((story) => (
              <Link
                key={story.id}
                href="/movers"
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
            {movers && movers.items.length === 0 && (
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
