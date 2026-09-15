"use client";

/* Admin › Videos — the review queue. Verify/reject submissions, record view
   counts (each save snapshots the count for the earning window), and mark
   platform-deleted videos as removed (records a strike). */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchAdminVideos, reviewVideo, type AdminVideo } from "@/lib/api";
import { formatDate, formatEuros, formatViews, PLATFORM_ICONS } from "@/lib/format";
import { Badge, Button, EmptyState, Spinner } from "@/components/ui";

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Rejected" },
  { key: "removed", label: "Removed" },
  { key: "", label: "All" },
];

function VideoRow({ video }: { video: AdminVideo }) {
  const queryClient = useQueryClient();
  const [views, setViews] = useState(String(video.views));

  const review = useMutation({
    mutationFn: (body: { status?: string; views?: number; review_note?: string }) =>
      reviewVideo(video.id, body),
    onSuccess: (result, body) => {
      queryClient.invalidateQueries({ queryKey: ["admin-videos"] });
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
      queryClient.invalidateQueries({ queryKey: ["creator-metrics"] });
      if (result.strike) {
        toast.warning(
          result.strike.creator_status === "terminated"
            ? `${result.strike.strikes} strikes — partnership terminated`
            : `Strike recorded (${result.strike.strikes}/2) for ${video.creator.name}`
        );
      } else if (body.status) {
        toast.success(`Video ${body.status}`);
      } else {
        toast.success("Views saved");
      }
    },
    onError: () => toast.error("Update failed"),
  });

  const markRemoved = () => {
    if (
      !window.confirm(
        `Mark as removed? This records a strike for ${video.creator.name} — two strikes end the partnership.`
      )
    )
      return;
    review.mutate({ status: "removed" });
  };

  const reject = () => {
    const note = window.prompt("Reason shown to the creator (optional):", video.review_note || "");
    if (note === null) return;
    review.mutate({ status: "rejected", review_note: note.slice(0, 255) });
  };

  const parsedViews = Number(views.replace(/[.\s]/g, ""));
  const viewsChanged = Number.isFinite(parsedViews) && parsedViews >= 0 && parsedViews !== video.views;

  return (
    <div className="dashed-card flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-[16px] font-medium leading-6 text-ink hover:opacity-75"
          >
            <i className={`ph ${PLATFORM_ICONS[video.platform] ?? "ph-play"} text-[20px]`} />
            <span className="truncate">{video.title || video.url}</span>
            <i className="ph ph-arrow-up-right text-[14px] text-slate-400" />
          </a>
          <div className="mt-1 text-[13px] leading-5 text-slate-500">
            {video.creator.name} · {video.creator.email} · submitted {formatDate(video.created_at)}
            {video.story_id ? ` · script #${video.story_id}` : " · no script linked"}
          </div>
        </div>
        <Badge
          tone={
            video.status === "verified"
              ? "positive"
              : video.status === "pending"
                ? "neutral"
                : "warn"
          }
        >
          {video.status}
        </Badge>
      </div>

      {/* Ownership evidence from the platform. Only shown when there is
          something to say — "unconfirmed" is the normal case for any platform
          we cannot ask, and dressing it up as a warning would cry wolf on
          almost every row. */}
      {video.ownership_state === "foreign" && (
        <div className="flex items-start gap-3 rounded-[8px] bg-gold/15 p-4">
          <i className="ph ph-warning shrink-0 text-[18px] text-[#8a6400]" />
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium leading-5 text-[#8a6400]">
              This may not be their video
            </span>
            {video.ownership_note && (
              <span className="text-[13px] leading-5 text-slate-500">{video.ownership_note}</span>
            )}
          </div>
        </div>
      )}
      {video.ownership_state === "owned" && (
        <div className="flex items-center gap-2 text-[13px] leading-5 text-green-600">
          <i className="ph ph-seal-check text-[16px]" />
          Posted by their own account
        </div>
      )}

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-slate-400">
            Views
          </span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={views}
              onChange={(e) => setViews(e.target.value)}
              className="h-9 w-32 rounded-[6px] bg-bone-100 px-3 text-[14px] leading-5 text-ink outline-none"
            />
            <Button
              kind="secondary"
              size="s"
              disabled={!viewsChanged || review.isPending}
              onClick={() => review.mutate({ views: parsedViews })}
            >
              Save Views
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-slate-400">
            Views that count
          </span>
          <span className="text-[15px] font-medium leading-5 text-ink">
            {formatViews(video.eligible_views)}
            <span className="ml-2 text-[12px] font-normal text-slate-400">
              earns until {formatDate(video.earning_until)}
            </span>
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-slate-400">
            Payout
          </span>
          <span
            className={`font-serif text-[20px] leading-6 ${
              video.payout_cents > 0 ? "text-green-600" : "text-slate-400"
            }`}
          >
            {formatEuros(video.payout_cents)}
          </span>
        </div>
      </div>

      {video.review_note && (
        <p className="text-[13px] leading-5 text-slate-500">Note: {video.review_note}</p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-bone-200 pt-4">
        {video.status !== "verified" && (
          <Button
            size="s"
            onClick={() => review.mutate({ status: "verified" })}
            disabled={review.isPending}
          >
            Verify
          </Button>
        )}
        {video.status !== "rejected" && (
          <Button kind="secondary" size="s" onClick={reject} disabled={review.isPending}>
            Reject
          </Button>
        )}
        {video.status !== "removed" && (
          <Button kind="secondary" size="s" onClick={markRemoved} disabled={review.isPending}>
            Mark Removed
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AdminVideosPage() {
  const [tab, setTab] = useState("pending");
  const { data, isLoading } = useQuery({
    queryKey: ["admin-videos", tab],
    queryFn: () => fetchAdminVideos(tab || undefined),
  });

  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="display-md text-ink">Video Review</h1>
        <p className="max-w-[560px] text-[16px] leading-6 text-slate-500">
          Verify submissions, record view counts for TikTok and Instagram, and flag
          videos deleted from the platforms.
        </p>
      </div>

      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`cursor-pointer rounded-full px-4 py-2 text-[13px] font-medium leading-4 ${
              tab === t.key ? "bg-ink text-white" : "text-slate-500 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Spinner label="Loading videos…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon="ph-video-camera-slash"
          title={tab === "pending" ? "Review queue is clear" : "No videos here"}
          body={tab === "pending" ? "New submissions appear here for verification." : undefined}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((video) => (
            <VideoRow key={video.id} video={video} />
          ))}
        </div>
      )}
    </div>
  );
}
