"use client";

/* Admin › Overview — how the program is going, at a glance.
   Views = real growth (all recorded increases). € = eligible (window-clamped),
   reconciling exactly with creator earnings pages. */

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAdminOverview } from "@/lib/api";
import { formatEuros, formatViews, PLATFORM_ICONS } from "@/lib/format";
import { EmptyState, Spinner, StatCard } from "@/components/ui";
import { DailyBarChart } from "@/components/bar-chart";
import { BarList } from "@/components/bar-list";
import { Sparkline } from "@/components/sparkline";

const HORIZONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  verified: "Verified",
  rejected: "Rejected",
  removed: "Removed",
};

export default function AdminOverviewPage() {
  const [days, setDays] = useState(30);
  const [videosDesc, setVideosDesc] = useState(true);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-overview", days],
    queryFn: () => fetchAdminOverview(days),
    placeholderData: (prev) => prev,
  });

  if (isLoading && !data) return <Spinner label="Loading dashboard…" />;
  if (!data) return <EmptyState icon="ph-chart-bar" title="No data yet" />;

  const { kpis, daily, platforms, statuses, top_creators, top_videos } = data;
  const horizonLabel = HORIZONS.find((h) => h.days === days)?.label;
  const sortedVideos = videosDesc ? top_videos : [...top_videos].reverse();

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="display-md text-ink">Overview</h1>
          <p className="text-[15px] leading-5 text-slate-500">
            Program performance over the last {horizonLabel}.
          </p>
        </div>
        <div className="flex gap-1 rounded-full bg-bone-100 p-1">
          {HORIZONS.map((h) => (
            <button
              key={h.days}
              onClick={() => setDays(h.days)}
              className={`cursor-pointer rounded-full px-4 py-1.5 text-[13px] font-medium leading-4 ${
                days === h.days ? "bg-ink text-white" : "text-slate-500 hover:text-ink"
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="flex flex-col gap-8 sm:flex-row">
        <StatCard value={formatViews(kpis.views_gained)} description={`Views · ${horizonLabel}`} />
        <StatCard value={formatEuros(kpis.earned_cents)} description={`Earned · ${horizonLabel}`} />
        <StatCard value={formatEuros(kpis.outstanding_cents)} description="Outstanding balance" />
        <StatCard value={formatEuros(kpis.paid_cents)} description="Paid out to date" />
      </div>
      <div className="flex flex-col gap-8 sm:flex-row">
        <StatCard value={String(kpis.active_creators)} description="Active creators" />
        <StatCard value={String(kpis.pending_review)} description="Videos pending review" />
        <StatCard value={formatEuros(kpis.total_earned_cents)} description="Earned all-time" />
        <div className="flex-1" />
      </div>

      {/* Charts */}
      <div className="dashed-card flex flex-col gap-6 p-6 lg:p-8">
        <div className="flex flex-col gap-1">
          <h2 className="display-xs text-ink">Views per day</h2>
          <p className="text-[14px] leading-5 text-slate-500">
            All recorded view growth on verified videos — reach, not pay.
          </p>
        </div>
        {kpis.views_gained > 0 ? (
          <DailyBarChart
            data={daily.map((d) => ({ date: d.date, value_cents: d.views }))}
            formatValue={formatViews}
            minCeiling={1000}
          />
        ) : (
          <p className="text-[14px] leading-5 text-slate-400">
            No view growth recorded in this period yet.
          </p>
        )}
      </div>

      <div className="dashed-card flex flex-col gap-6 p-6 lg:p-8">
        <div className="flex flex-col gap-1">
          <h2 className="display-xs text-ink">Eligible earnings per day</h2>
          <p className="text-[14px] leading-5 text-slate-500">
            Payout produced by view growth inside each video&apos;s 10-day earning window —
            matches creator earnings pages to the cent.
          </p>
        </div>
        {kpis.earned_cents > 0 ? (
          <DailyBarChart
            data={daily.map((d) => ({ date: d.date, value_cents: d.earned_cents }))}
          />
        ) : (
          <p className="text-[14px] leading-5 text-slate-400">
            No eligible earnings in this period yet.
          </p>
        )}
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="dashed-card flex flex-col gap-5 p-6">
          <h2 className="display-xs text-ink">Views by platform</h2>
          {platforms.length > 0 ? (
            <BarList
              rows={platforms.map((p) => ({
                label: p.platform,
                icon: PLATFORM_ICONS[p.platform] ?? "ph-play",
                value: p.views,
                sub: `${p.videos} video${p.videos === 1 ? "" : "s"}`,
              }))}
            />
          ) : (
            <p className="text-[14px] leading-5 text-slate-400">No verified videos yet.</p>
          )}
        </div>
        <div className="dashed-card flex flex-col gap-5 p-6">
          <h2 className="display-xs text-ink">Videos by status</h2>
          {statuses.length > 0 ? (
            <BarList
              rows={statuses.map((s) => ({
                label: STATUS_LABELS[s.status] ?? s.status,
                value: s.count,
              }))}
            />
          ) : (
            <p className="text-[14px] leading-5 text-slate-400">No videos submitted yet.</p>
          )}
        </div>
      </div>

      {/* Top videos */}
      <div className="dashed-card flex flex-col gap-5 p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="display-xs text-ink">Top videos · {horizonLabel}</h2>
            <p className="text-[13px] leading-5 text-slate-500">
              Ranked by views gained in the period — open the link to see the video.
            </p>
          </div>
          <button
            onClick={() => setVideosDesc(!videosDesc)}
            className="flex cursor-pointer items-center gap-1.5 rounded-full bg-bone-100 px-4 py-1.5 text-[13px] font-medium leading-4 text-slate-500 hover:text-ink"
          >
            <i className={`ph ${videosDesc ? "ph-sort-descending" : "ph-sort-ascending"} text-[16px]`} />
            {videosDesc ? "Most views first" : "Least views first"}
          </button>
        </div>
        {sortedVideos.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-ink">
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">#</th>
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Video</th>
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Creator</th>
                  <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">
                    Views · {horizonLabel}
                  </th>
                  <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">
                    Total views
                  </th>
                  <th className="py-3 text-right text-[13px] font-medium leading-5 text-slate-500">
                    Payout
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedVideos.map((v, i) => (
                  <tr key={v.id} className="border-b border-bone-200">
                    <td className="py-3 pr-4 text-[14px] leading-5 text-slate-400">
                      {videosDesc ? i + 1 : sortedVideos.length - i}
                    </td>
                    <td className="max-w-[320px] py-3 pr-4">
                      <a
                        href={v.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-[14px] leading-5 text-blue hover:opacity-75"
                      >
                        <i className={`ph ${PLATFORM_ICONS[v.platform] ?? "ph-play"} text-[18px] text-ink`} />
                        <span className="truncate">{v.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                        <i className="ph ph-arrow-up-right shrink-0 text-[13px] text-slate-400" />
                      </a>
                    </td>
                    <td className="py-3 pr-4 text-[13px] leading-5 text-slate-500">
                      {v.creator_name}
                    </td>
                    <td className="py-3 pr-4 text-right text-[14px] font-medium leading-5 text-ink">
                      {formatViews(v.views_gained)}
                    </td>
                    <td className="py-3 pr-4 text-right text-[14px] leading-5 text-slate-500">
                      {formatViews(v.total_views)}
                    </td>
                    <td className="py-3 text-right font-serif text-[17px] leading-6 text-green-600">
                      {formatEuros(v.payout_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[14px] leading-5 text-slate-400">
            No verified videos with view growth in this period yet.
          </p>
        )}
      </div>

      {/* Leaderboard preview */}
      <div className="dashed-card flex flex-col gap-5 p-6 lg:p-8">
        <div className="flex items-center justify-between">
          <h2 className="display-xs text-ink">Top creators · {horizonLabel}</h2>
          <Link
            href="/admin/creators"
            className="text-[14px] font-medium leading-5 text-blue hover:opacity-75"
          >
            All creators →
          </Link>
        </div>
        {top_creators.length > 0 ? (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ink">
                <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">#</th>
                <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Creator</th>
                <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Trend · 14d</th>
                <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">
                  Views · {horizonLabel}
                </th>
                <th className="py-3 text-right text-[13px] font-medium leading-5 text-slate-500">
                  Earned all-time
                </th>
              </tr>
            </thead>
            <tbody>
              {top_creators.map((c, i) => (
                <tr key={c.id} className="border-b border-bone-200">
                  <td className="py-3 pr-4 text-[14px] leading-5 text-slate-400">{i + 1}</td>
                  <td className="py-3 pr-4">
                    <div className="text-[15px] font-medium leading-5 text-ink">{c.name}</div>
                    {c.handle && (
                      <div className="text-[12px] leading-4 text-slate-400">@{c.handle}</div>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <Sparkline values={c.spark} />
                  </td>
                  <td className="py-3 pr-4 text-right text-[15px] leading-5 text-ink">
                    {formatViews(c.views_gained)}
                  </td>
                  <td className="py-3 text-right font-serif text-[18px] leading-6 text-green-600">
                    {formatEuros(c.earned_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[14px] leading-5 text-slate-400">
            No creator activity in this period yet.
          </p>
        )}
      </div>
    </div>
  );
}
