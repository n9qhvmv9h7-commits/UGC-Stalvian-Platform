"use client";

/* ThreadCard — one X thread, shown the way the Marketing Panel shows it.

   The panel previews a thread as a stack of one tweet at a time: the X card,
   dots underneath, an Actions menu and "Tweet n/N". Creators and the panel
   team are looking at the same post, so this page is laid out the same way —
   in this project's design system, inside the dashed editorial card the rest
   of the app uses.

   The picture is the creator's own: the panel keeps its imagery (it is inline
   base64 its forwarding layer strips) and creators shoot or pick their own.
   Click the media area, or use Actions, and it is stored against that tweet
   for this creator. */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  deleteTweetImage,
  fetchTweetImage,
  uploadTweetImage,
  type StoryPayload,
  type Tweet,
} from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Badge, Button } from "@/components/ui";
import { ViralityMeter } from "@/components/script-card";
import { TweetPreview, compactAge } from "@/components/tweet-preview";

/* X's limit. Counted in code points, which matches X for plain text; links
   and some emoji count differently there, so this is a guide, not a gate. */
export const TWEET_MAX_CHARS = 280;

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text);
  toast.success(`${what} copied`);
}

/* The whole thread as one paste, tweets separated so the creator can split
   them back into replies. */
export function fullThreadText(tweets: Tweet[]): string {
  return tweets.map((t) => t.text).join("\n\n---\n\n");
}

/* Deep link that opens X's composer with this tweet filled in. The rest of a
   thread is posted as replies, which the intent URL cannot pre-fill. */
function postIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

function MenuItem({
  icon,
  onClick,
  children,
}: {
  icon: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-[14px] leading-5 text-slate-500 hover:bg-bone-100 hover:text-ink"
    >
      <i className={`ph ${icon} text-[16px]`} />
      {children}
    </button>
  );
}

/* Same pill and popover as the feed's Dropdown, so the two controls that sit
   side by side on this page read as one family. */
function ActionsMenu({ children }: { children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Escape closes it, like the feed's Dropdown — the overlay below catches
  // clicks, but a keyboard user should not be trapped in an open menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 cursor-pointer items-center gap-2 rounded-full bg-bone-100 px-4 text-[13px] font-medium leading-4 text-ink hover:bg-bone-200"
      >
        <i className="ph ph-sliders-horizontal text-[16px] text-slate-500" />
        Actions
        <i className="ph ph-caret-down text-[14px] text-slate-500" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-2 min-w-[230px] overflow-hidden rounded-[8px] border border-bone-200 bg-white py-1 shadow-[0_12px_32px_-12px_rgba(1,5,16,0.3)]">
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}

export function ThreadCard({ story }: { story: StoryPayload }) {
  const tweets = [...(story.tweets ?? [])].sort((a, b) => a.order - b.order);
  const sources = [...new Set((story.sources ?? []).map((s) => s.trim()).filter(Boolean))];

  const [index, setIndex] = useState(0);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  /* Which tweets carry a picture. Seeded from the feed so the card knows
     without asking for any bytes, then kept current by this card's own
     uploads — the feed row is a page-load-old snapshot. */
  const [imageOrders, setImageOrders] = useState<number[]>(story.image_tweets ?? []);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const active = tweets[Math.min(index, tweets.length - 1)];
  const order = active?.order ?? 1;
  const hasImage = imageOrders.includes(order);

  // Only the tweet on screen fetches its picture, so a feed of threads never
  // pulls every image at once.
  const { data: image } = useQuery({
    queryKey: ["tweet-image", story.id, order],
    queryFn: () => fetchTweetImage(story.id, order),
    enabled: hasImage,
    staleTime: Infinity,
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadTweetImage(story.id, order, file),
    onSuccess: (result) => {
      queryClient.setQueryData(["tweet-image", story.id, order], result);
      setImageOrders((prev) => (prev.includes(order) ? prev : [...prev, order]));
      toast.success(`Picture added to tweet ${order}`);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Could not upload that picture");
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteTweetImage(story.id, order),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["tweet-image", story.id, order] });
      setImageOrders((prev) => prev.filter((o) => o !== order));
      toast.success(`Picture removed from tweet ${order}`);
    },
    onError: () => toast.error("Could not remove that picture"),
  });

  const pickFile = () => fileRef.current?.click();
  const length = active ? [...active.text].length : 0;
  const over = length > TWEET_MAX_CHARS;

  return (
    <div className="dashed-card flex flex-col gap-5 bg-white p-6 lg:p-8">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />

      {/* Header — badges + timestamp left, virality meter right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {story.ticker && <Badge tone="ink">${story.ticker}</Badge>}
          <Badge>
            {tweets.length} tweet{tweets.length === 1 ? "" : "s"}
          </Badge>
          {story.language && <Badge>{story.language.toUpperCase()}</Badge>}
        </div>
        {typeof story.virality_score === "number" && (
          <ViralityMeter score={story.virality_score} />
        )}
      </div>

      <h3 className="display-xs max-w-[720px] text-ink">{story.title || story.headline}</h3>

      {tweets.length === 0 && (
        <p className="text-[15px] leading-5 text-slate-500">
          This thread has no text yet — check back shortly.
        </p>
      )}

      {active && (
        <div className="flex w-full max-w-[598px] flex-col gap-3">
          {/* The card and its arrows share one positioning context, so the
              arrows sit on the card's own edges however wide it renders. */}
          <div className="relative">
          <TweetPreview
            age={compactAge(story.published_at || story.created_at)}
            text={active.text}
            media={
              <div
                onClick={() => !upload.isPending && pickFile()}
                className="flex aspect-[16/9] cursor-pointer items-center justify-center bg-black/60"
              >
                {upload.isPending ? (
                  <span className="text-[13px] text-slate-400">Uploading…</span>
                ) : image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image.data_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[13px] text-slate-400">Click to upload an image</span>
                )}
              </div>
            }
          />

          {/* Step through the thread from the card itself. Each side appears
              only when there is somewhere to go, so the arrows also say where
              in the thread you are. */}
          {index > 0 && (
            <button
              type="button"
              onClick={() => setIndex(index - 1)}
              aria-label="Previous tweet"
              className="absolute left-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-ink/70 text-white hover:bg-ink"
            >
              <i className="ph ph-caret-left text-[18px]" />
            </button>
          )}
          {index < tweets.length - 1 && (
            <button
              type="button"
              onClick={() => setIndex(index + 1)}
              aria-label="Next tweet"
              className="absolute right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-ink/70 text-white hover:bg-ink"
            >
              <i className="ph ph-caret-right text-[18px]" />
            </button>
          )}
          </div>

          {/* Dots — one per tweet, the panel's thread pager */}
          {tweets.length > 1 && (
            <div className="flex items-center justify-center gap-1.5">
              {tweets.map((tweet, i) => (
                <button
                  key={tweet.order}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Tweet ${i + 1}`}
                  className={`h-2 w-2 cursor-pointer rounded-full transition-all ${
                    i === index ? "scale-125 bg-ink" : "bg-slate-200 hover:bg-slate-300"
                  }`}
                />
              ))}
            </div>
          )}

          {/* Controls — Actions, position, character count */}
          <div className="flex flex-wrap items-center gap-3">
            <ActionsMenu>
              {(close) => (
                <>
                  <MenuItem
                    icon="ph-image"
                    onClick={() => {
                      close();
                      pickFile();
                    }}
                  >
                    {hasImage ? "Replace picture" : "Upload a picture"}
                  </MenuItem>
                  {hasImage && (
                    <MenuItem
                      icon="ph-trash"
                      onClick={() => {
                        close();
                        remove.mutate();
                      }}
                    >
                      Remove picture
                    </MenuItem>
                  )}
                  <div className="my-1 border-t border-bone-200" />
                  <MenuItem
                    icon="ph-copy"
                    onClick={() => {
                      close();
                      copy(active.text, `Tweet ${order}`);
                    }}
                  >
                    Copy this tweet
                  </MenuItem>
                  <MenuItem
                    icon="ph-copy-simple"
                    onClick={() => {
                      close();
                      copy(fullThreadText(tweets), "Thread");
                    }}
                  >
                    Copy the whole thread
                  </MenuItem>
                  <MenuItem
                    icon="ph-x-logo"
                    onClick={() => {
                      close();
                      window.open(postIntentUrl(active.text), "_blank", "noopener,noreferrer");
                    }}
                  >
                    Post this tweet on X
                  </MenuItem>
                  {sources.length > 0 && (
                    <>
                      <div className="my-1 border-t border-bone-200" />
                      <MenuItem
                        icon="ph-file-text"
                        onClick={() => {
                          close();
                          setSourcesOpen((v) => !v);
                        }}
                      >
                        {sourcesOpen ? "Hide sources" : `Check sources (${sources.length})`}
                      </MenuItem>
                    </>
                  )}
                </>
              )}
            </ActionsMenu>

            <span className="text-[13px] leading-5 text-slate-500">
              Tweet {index + 1}/{tweets.length}
            </span>

            <span
              className={`ml-auto text-[12px] leading-4 ${
                over ? "font-medium text-red-600" : "text-slate-400"
              }`}
            >
              {length}/{TWEET_MAX_CHARS}
              {over && " · over the limit"}
            </span>
          </div>
        </div>
      )}

      {/* Every claim traces back to a disclosure. A creator about to post it
          should be able to see the filing first. */}
      {sources.length > 0 && sourcesOpen && (
        <ul className="flex flex-col gap-2 rounded-[8px] bg-bone-100 p-4">
          {sources.map((src, i) => (
            <li key={`${src}-${i}`} className="text-[14px] leading-5">
              {/^https?:\/\//.test(src) ? (
                <a
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-start gap-2 text-blue hover:underline"
                >
                  <i className="ph ph-arrow-square-out mt-0.5 shrink-0 text-[16px]" />
                  <span className="break-all">{src}</span>
                </a>
              ) : (
                <span className="text-slate-500">{src}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-bone-200 pt-4">
        <span className="text-[12px] leading-4 text-slate-400">
          Generated {formatDate(story.created_at || story.published_at)}
        </span>
        {/* Posting is only half of it — the link has to come back here for the
            views to be counted and paid. */}
        <Link href={`/my-posts?story=${story.id}`} className="ml-auto">
          <Button kind="secondary" size="s" icon="ph-paper-plane-tilt">
            Submit Your Post
          </Button>
        </Link>
      </div>
    </div>
  );
}
