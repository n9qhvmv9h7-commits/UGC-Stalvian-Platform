"use client";

/* My Videos — paste published video links; we track views and pay. */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteVideo, fetchFormula, fetchMe, fetchMyVideos, getToken, submitVideo } from "@/lib/api";
import { formatDate, formatEuros, formatViews } from "@/lib/format";
import { Badge, Button, EmptyState, Eyebrow, Field } from "@/components/ui";

const PLATFORM_ICONS: Record<string, string> = {
  tiktok: "ph-tiktok-logo",
  instagram: "ph-instagram-logo",
  youtube: "ph-youtube-logo",
};

/* Range start: day + month only — the end date carries the year. */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function MyVideosPage() {
  return (
    <Suspense fallback={null}>
      <MyVideosInner />
    </Suspense>
  );
}

function MyVideosInner() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  // arrived via "Submit Your Video" on a script -> attribute the video to it
  const storyId = Number(searchParams.get("story")) || null;
  const [url, setUrl] = useState("");
  const { data } = useQuery({ queryKey: ["videos"], queryFn: fetchMyVideos });
  const { data: formula } = useQuery({ queryKey: ["formula"], queryFn: fetchFormula });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe, enabled: !!getToken() });
  const windowDays = formula?.window_days ?? 10;

  const submit = useMutation({
    mutationFn: () => submitVideo({ url, story_id: storyId }),
    onSuccess: (video) => {
      setUrl("");
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["earnings"] });
      toast.success(
        video.status === "verified"
          ? "Video added — views verified automatically"
          : "Video added — views will be verified by the Stalvian team"
      );
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Could not add that link");
    },
  });

  const remove = useMutation({
    mutationFn: deleteVideo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      toast.success("Video removed");
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Could not remove the video");
    },
  });

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-6">
        <Eyebrow icon="ph-link">My Videos</Eyebrow>
        <h1 className="display-md max-w-[720px] text-ink">
          Posted a video?
          <br />
          Drop the link here.
        </h1>
        <p className="max-w-[560px] text-[18px] leading-6 text-slate-500">
          We track views for every link you submit. YouTube views verify automatically;
          TikTok and Instagram views are verified by the Stalvian team before payout.
        </p>
      </div>

      {/* The two program rules — always visible */}
      <div className="dashed-card flex flex-col gap-4 p-6">
        <div className="flex items-start gap-4 text-[15px] leading-6 text-ink">
          <i className="ph ph-timer shrink-0 text-[22px]" />
          <span>
            <span className="font-medium">Views count for {windowDays} days.</span>{" "}
            A video earns from the views it gets in its first {windowDays} days after
            posting — submit the link the day you post. After day {windowDays}, its
            earnings are locked in.
          </span>
        </div>
        <div className="flex items-start gap-4 text-[15px] leading-6 text-ink">
          <i className="ph ph-warning shrink-0 text-[22px]" />
          <span>
            <span className="font-medium">Keep your videos live.</span> Deleting a
            posted video is a strike — two strikes end the partnership.
          </span>
        </div>
        {me && me.strikes > 0 && (
          <div className="flex items-center gap-3 border-t border-bone-200 pt-4">
            <Badge tone="warn">
              {me.strikes} strike{me.strikes > 1 ? "s" : ""}
            </Badge>
            <span className="text-[14px] leading-5 text-slate-500">
              One more strike ends the partnership — keep every posted video live.
            </span>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) submit.mutate();
        }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end"
      >
        <Field
          label="Video link"
          icon="ph-link"
          placeholder="https://www.tiktok.com/@you/video/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={submit.isPending || !url.trim()}>
          {submit.isPending ? "Adding…" : "Add Video"}
        </Button>
      </form>
      {storyId && (
        <p className="-mt-8 text-[14px] leading-5 text-slate-500">
          <i className="ph ph-link-simple mr-1 text-[14px]" />
          This video will be linked to script #{storyId}.
        </p>
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          icon="ph-video-camera-slash"
          title="No videos yet"
          body="Publish your first Stalvian video and paste the link above — earnings start at 1.000 views."
        />
      )}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-ink">
                <th className="py-4 pr-4 text-[14px] font-medium leading-5 text-slate-500">Video</th>
                <th className="py-4 pr-4 text-[14px] font-medium leading-5 text-slate-500">Status</th>
                <th className="py-4 pr-4 text-[14px] font-medium leading-5 text-slate-500">Views that count</th>
                <th className="py-4 pr-4 text-[14px] font-medium leading-5 text-slate-500">Earning window</th>
                <th className="py-4 pr-4 text-[14px] font-medium leading-5 text-slate-500">Earnings</th>
                <th className="py-4" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((video) => (
                <tr key={video.id} className="border-b border-bone-200">
                  <td className="max-w-[320px] py-4 pr-4">
                    <a
                      href={video.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 text-[15px] leading-5 text-ink hover:opacity-75"
                    >
                      <i className={`ph ${PLATFORM_ICONS[video.platform] || "ph-play"} text-[22px]`} />
                      <span className="truncate">{video.title || video.url}</span>
                    </a>
                  </td>
                  <td className="py-4 pr-4">
                    {video.status === "verified" && <Badge tone="positive">Verified</Badge>}
                    {video.status === "pending" && <Badge>Pending review</Badge>}
                    {video.status === "rejected" && (
                      <Badge tone="ink">Rejected{video.review_note ? ` — ${video.review_note}` : ""}</Badge>
                    )}
                    {video.status === "removed" && <Badge tone="warn">Removed — strike</Badge>}
                  </td>
                  <td className="py-4 pr-4">
                    <div className="text-[15px] leading-5 text-ink">
                      {formatViews(video.eligible_views)}
                    </div>
                    {!video.window_open && video.views > video.eligible_views && (
                      <div className="text-[12px] leading-4 text-slate-400">
                        of {formatViews(video.views)} total
                      </div>
                    )}
                  </td>
                  <td className="py-4 pr-4 text-[14px] leading-5">
                    {video.window_open ? (
                      <span className="text-green-600">
                        {shortDate(video.created_at)} – {formatDate(video.earning_until)} · open
                      </span>
                    ) : (
                      <span className="text-slate-400">
                        <i className="ph ph-lock-simple mr-1 text-[13px]" />
                        {shortDate(video.created_at)} – {formatDate(video.earning_until)}
                      </span>
                    )}
                  </td>
                  <td className="py-4 pr-4">
                    <span className={`font-serif text-[20px] leading-7 ${video.payout_cents > 0 ? "text-green-600" : "text-slate-400"}`}>
                      {formatEuros(video.payout_cents)}
                    </span>
                  </td>
                  <td className="py-4 text-right">
                    {video.payout_cents === 0 && (
                      <button
                        onClick={() => {
                          if (window.confirm("Remove this video? This can't be undone.")) {
                            remove.mutate(video.id);
                          }
                        }}
                        disabled={remove.isPending}
                        className="cursor-pointer text-slate-400 hover:text-ink disabled:opacity-40"
                        aria-label="Remove video"
                      >
                        <i className="ph ph-trash text-[18px]" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
