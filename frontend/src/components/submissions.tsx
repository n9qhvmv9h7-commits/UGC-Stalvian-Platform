"use client";

/* Submissions — paste published links; we track views and pay.

   One page serves both surfaces. A video creator pastes TikTok, Instagram or
   YouTube links; an X creator pastes the first tweet of a thread. The rows,
   the rules and the pay are identical — only the words differ, and they come
   from COPY so neither surface reads like a re-skinned version of the other. */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteVideo, fetchFormula, fetchMe, fetchMyVideos, getToken, submitVideo } from "@/lib/api";
import { formatDate, formatEuros, formatViews, PLATFORM_ICONS } from "@/lib/format";
import { Badge, Button, EmptyState, Eyebrow, Field } from "@/components/ui";
import { useSocialConnections } from "@/components/connect-accounts";

export type SubmissionKind = "video" | "post";

const COPY = {
  video: {
    eyebrow: "My Videos",
    icon: "ph-link",
    headline: ["Posted a video?", "Drop the link here."],
    blurb:
      "We track views for every link you submit. YouTube views verify automatically; TikTok and Instagram views are verified by the Stalvian team before payout.",
    noun: "video",
    plural: "videos",
    fieldLabel: "Video link",
    placeholder: "https://www.tiktok.com/@you/video/…",
    addLabel: "Add Video",
    emptyIcon: "ph-video-camera-slash",
    emptyTitle: "No videos yet",
    emptyBody:
      "Publish your first Stalvian video and paste the link above — earnings start at 1.000 views.",
    addedVerified: "Video added — views verified automatically",
    addedPending: "Video added — views will be verified by the Stalvian team",
    keepLive: "Deleting a posted video is a strike — two strikes end the partnership.",
  },
  post: {
    eyebrow: "My Posts",
    icon: "ph-x-logo",
    headline: ["Posted a thread?", "Drop the link here."],
    blurb:
      "Paste the link to the first tweet of every thread you post. The Stalvian team verifies its views before payout — the same pay as a video, per 1.000 views.",
    noun: "post",
    plural: "posts",
    fieldLabel: "Link to the first tweet",
    placeholder: "https://x.com/you/status/…",
    addLabel: "Add Post",
    emptyIcon: "ph-x-logo",
    emptyTitle: "No posts yet",
    emptyBody:
      "Post your first Stalvian thread and paste the link to its first tweet above — earnings start at 1.000 views.",
    addedVerified: "Post added — views verified automatically",
    addedPending: "Post added — views will be verified by the Stalvian team",
    keepLive: "Deleting a published thread is a strike — two strikes end the partnership.",
  },
} as const;

/* Range start: day + month only — the end date carries the year. */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function SubmissionsPage({ kind }: { kind: SubmissionKind }) {
  return (
    <Suspense fallback={null}>
      <SubmissionsInner kind={kind} />
    </Suspense>
  );
}

function SubmissionsInner({ kind }: { kind: SubmissionKind }) {
  const copy = COPY[kind];
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  // arrived via "Submit Your Video/Post" on a script -> attribute it to that story
  const storyId = Number(searchParams.get("story")) || null;
  const [url, setUrl] = useState("");
  const { data } = useQuery({ queryKey: ["videos"], queryFn: fetchMyVideos });
  const { data: formula } = useQuery({ queryKey: ["formula"], queryFn: fetchFormula });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe, enabled: !!getToken() });
  const windowDays = formula?.window_days ?? 10;
  const { data: social } = useSocialConnections();

  /* Which platform the pasted link belongs to, judged the same way the server
     judges it — hostname, not substring, so "evil.example/tiktok.com" cannot
     masquerade. Used only to decide whether to prompt for a connection; the
     server still enforces. */
  const pastedPlatform = (() => {
    try {
      const host = new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, "");
      if (host.endsWith("tiktok.com")) return "tiktok";
      if (host.endsWith("instagram.com")) return "instagram";
      if (host.endsWith("youtube.com") || host === "youtu.be") return "youtube";
      if (host.endsWith("x.com") || host.endsWith("twitter.com") || host === "t.co") return "x";
    } catch {
      /* not a URL yet — the creator is still typing */
    }
    return null;
  })();

  // Per-platform and evaluated against what was actually pasted: a creator who
  // has connected nothing can still submit a YouTube link, because YouTube
  // needs no connection. A blanket "connect something first" wall would block
  // a submission we intend to allow.
  const blockedBy = pastedPlatform
    ? social?.platforms.find((p) => p.platform === pastedPlatform && !p.can_submit)
    : undefined;

  const submit = useMutation({
    mutationFn: () => submitVideo({ url, story_id: storyId }),
    onSuccess: (video) => {
      setUrl("");
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["earnings"] });
      toast.success(video.status === "verified" ? copy.addedVerified : copy.addedPending);
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
      toast.success(`${copy.noun[0].toUpperCase()}${copy.noun.slice(1)} removed`);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : `Could not remove the ${copy.noun}`);
    },
  });

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-6">
        <Eyebrow icon={copy.icon}>{copy.eyebrow}</Eyebrow>
        <h1 className="display-md max-w-[720px] text-ink">
          {copy.headline[0]}
          <br />
          {copy.headline[1]}
        </h1>
        <p className="max-w-[560px] text-[18px] leading-6 text-slate-500">{copy.blurb}</p>
      </div>

      {/* The two program rules — always visible */}
      <div className="dashed-card flex flex-col gap-4 p-6">
        <div className="flex items-start gap-4 text-[15px] leading-6 text-ink">
          <i className="ph ph-timer shrink-0 text-[22px]" />
          <span>
            <span className="font-medium">Views count for {windowDays} days.</span>{" "}
            A {copy.noun} earns from the views it gets in its first {windowDays} days after
            posting — submit the link the day you post. After day {windowDays}, its
            earnings are locked in.
          </span>
        </div>
        <div className="flex items-start gap-4 text-[15px] leading-6 text-ink">
          <i className="ph ph-warning shrink-0 text-[22px]" />
          <span>
            <span className="font-medium">Keep your {copy.plural} live.</span>{" "}
            {copy.keepLive}
          </span>
        </div>
        {me && me.strikes > 0 && (
          <div className="flex items-center gap-3 border-t border-bone-200 pt-4">
            <Badge tone="warn">
              {me.strikes} strike{me.strikes > 1 ? "s" : ""}
            </Badge>
            <span className="text-[14px] leading-5 text-slate-500">
              One more strike ends the partnership — keep every posted {copy.noun} live.
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
          label={copy.fieldLabel}
          icon="ph-link"
          placeholder={copy.placeholder}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1"
        />
        {blockedBy ? (
          <Link href="/settings">
            <Button type="button" icon="ph-link-simple">
              Connect {blockedBy.label}
            </Button>
          </Link>
        ) : (
          <Button type="submit" disabled={submit.isPending || !url.trim()}>
            {submit.isPending ? "Adding…" : copy.addLabel}
          </Button>
        )}
      </form>
      {blockedBy && (
        <p className="-mt-8 flex items-start gap-2 text-[14px] leading-5 text-slate-500">
          <i className="ph ph-info mt-0.5 shrink-0 text-[16px]" />
          Connect your {blockedBy.label} account to submit this link — it&apos;s how we
          confirm the video is yours and read its views.
        </p>
      )}
      {storyId && (
        <p className="-mt-8 text-[14px] leading-5 text-slate-500">
          <i className="ph ph-link-simple mr-1 text-[14px]" />
          This {copy.noun} will be linked to {kind === "post" ? "thread" : "script"} #{storyId}.
        </p>
      )}

      {data && !data.items?.length && (
        <EmptyState icon={copy.emptyIcon} title={copy.emptyTitle} body={copy.emptyBody} />
      )}

      {data && !!data.items?.length && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-ink">
                <th className="py-4 pr-4 text-[14px] font-medium leading-5 text-slate-500">
                  {kind === "post" ? "Post" : "Video"}
                </th>
                <th className="py-4 pr-4 text-[14px] font-medium leading-5 text-slate-500">Status</th>
                <th className="py-4 pr-4 text-[14px] font-medium leading-5 text-slate-500">Views that count</th>
                <th className="py-4 pr-4 text-[14px] font-medium leading-5 text-slate-500">Earning window</th>
                <th className="py-4 pr-4 text-[14px] font-medium leading-5 text-slate-500">Earnings</th>
                <th className="py-4" />
              </tr>
            </thead>
            <tbody>
              {(data.items ?? []).map((video) => (
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
                          if (window.confirm(`Remove this ${copy.noun}? This can't be undone.`)) {
                            remove.mutate(video.id);
                          }
                        }}
                        disabled={remove.isPending}
                        className="cursor-pointer text-slate-400 hover:text-ink disabled:opacity-40"
                        aria-label={`Remove ${copy.noun}`}
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
