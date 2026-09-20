"use client";

/* ThreadCard — one X thread, shown the way the Marketing Panel shows it.

   The panel previews a thread as a stack of one tweet at a time: the X card,
   dots underneath, an Actions menu and "Tweet n/N". Under each tweet sits the
   card the panel draws for it — a price chart, three logos, the buyers'
   faces — and the server tells this component which (`story.media`), so the
   card never has to know what kind of post it is looking at.

   Pictures are the creator's own: the panel keeps its imagery to itself and
   creators shoot or pick theirs. Every picture slot on a card is one upload,
   stored against that tweet for this creator, and the finished card exports
   as a PNG at the panel's design size so it can be posted as-is. */

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toPng } from "html-to-image";
import {
  deleteTweetImage,
  fetchMe,
  fetchTweetImages,
  uploadTweetImage,
  type StoryPayload,
  type Tweet,
  type TweetImage,
  type TweetMedia,
} from "@/lib/api";
import { TweetPreview, compactAge } from "@/components/tweet-preview";
import {
  CompanyChartCard,
  DESIGN_H,
  DESIGN_W,
  DualImage,
  InsiderFacesCard,
  LIST_W,
  PHOTO_W,
  PictureSlot,
  PositionsTableCard,
  RankedListCard,
  ScaledMedia,
  SplitMedia,
  SQ_H,
  SQ_W,
  SquareChartCard,
  ThreeLogoCard,
  WIDE_W,
} from "@/components/tweet-media";

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

/** "17/09/2026, 07:11" — the panel's stamp under each tweet, to the minute. */
function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* Deep link that opens X's composer with this tweet filled in. The rest of a
   thread is posted as replies, which the intent URL cannot pre-fill. */
function postIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

function MenuItem({
  icon,
  onClick,
  disabled,
  children,
}: {
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-[14px] leading-5 text-slate-500 hover:bg-bone-100 hover:text-ink disabled:cursor-default disabled:opacity-50"
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
          <div className="absolute left-0 top-full z-20 mt-2 min-w-[240px] overflow-hidden rounded-[8px] border border-bone-200 bg-white py-1 shadow-[0_12px_32px_-12px_rgba(1,5,16,0.3)]">
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}

/* Every card is drawn at its native size and exported at it. */
function nativeSize(kind: TweetMedia["kind"]): { w: number; h: number } {
  switch (kind) {
    case "list_buys":
    case "list_sells":
      return { w: LIST_W, h: LIST_W };
    case "square_chart":
    case "square_plain":
      return { w: SQ_W, h: SQ_H };
    case "chart_wide":
      return { w: WIDE_W, h: DESIGN_H };
    default:
      return { w: DESIGN_W, h: DESIGN_H };
  }
}

/* Which upload slots a card offers, and what to call them in the menu. */
function slotsFor(media: TweetMedia | undefined, story: StoryPayload): { slot: number; label: string }[] {
  switch (media?.kind) {
    case "logos":
      return (story.stocks ?? []).slice(0, 3).map((s, i) => ({ slot: i, label: `$${s.ticker} logo` }));
    case "faces":
      return (story.buyers ?? []).slice(0, 5).map((b, i) => ({ slot: i, label: `${b.name} photo` }));
    case "chart":
      return [{ slot: 0, label: "company picture" }, { slot: 1, label: "company icon" }];
    case "chart_entry":
      return [{ slot: 0, label: "investor picture" }, { slot: 1, label: "company icon" }];
    case "chart_month":
      return [{ slot: 0, label: "company logo" }];
    case "chart_wide":
      return [{ slot: 1, label: "company icon" }];
    case "dual_image":
      return [{ slot: 0, label: "left image" }, { slot: 1, label: "right image" }];
    case "holdings":
      return [{ slot: 0, label: "fund / manager photo" }];
    case "list_buys":
      return (story.top_buys ?? []).slice(0, 5).map((r, i) => ({ slot: i, label: `$${r.ticker} icon` }));
    case "list_sells":
      return (story.top_sells ?? []).slice(0, 5).map((r, i) => ({ slot: i, label: `$${r.ticker} icon` }));
    case "square_chart":
      return [{ slot: 0, label: "person photo" }, { slot: 1, label: "company icon" }];
    case "square_plain":
      return [{ slot: 1, label: "company icon" }];
    case "none":
      return [];
    default:
      return [{ slot: 0, label: "picture" }];
  }
}

export function ThreadCard({ story }: { story: StoryPayload }) {
  const tweets = useMemo(
    () => [...(story.tweets ?? [])].sort((a, b) => a.order - b.order),
    [story.tweets]
  );
  const sources = [...new Set((story.sources ?? []).map((s) => s.trim()).filter(Boolean))];

  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  /* Which (tweet, slot) pairs carry a picture. Seeded from the feed so the
     card knows without asking for any bytes, then kept current by this
     card's own uploads — the feed row is a page-load-old snapshot. */
  const [known, setKnown] = useState<Set<string>>(
    () => new Set((story.images ?? []).map((i) => `${i.order}:${i.slot}`))
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingSlot = useRef(0);
  const exportRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  // The preview is of the creator's own account, not Stalvian's — they are
  // the one posting it. Already in the cache from the app shell.
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });

  const active = tweets[Math.min(index, tweets.length - 1)];
  const order = active?.order ?? 1;
  const media = story.media?.[Math.min(index, tweets.length - 1)] ?? { kind: "image" as const };
  const slots = slotsFor(media, story);
  const hasAny = [...known].some((k) => k.startsWith(`${order}:`));

  // Only the tweet on screen fetches its pictures, so a feed of threads never
  // pulls every image at once.
  const { data: images } = useQuery({
    queryKey: ["tweet-images", story.id, order],
    queryFn: () => fetchTweetImages(story.id, order),
    enabled: hasAny,
    staleTime: Infinity,
  });
  const urlFor = (slot: number): string | undefined =>
    images?.find((i) => i.slot === slot)?.data_url;

  const upload = useMutation({
    mutationFn: ({ file, slot }: { file: File; slot: number }) =>
      uploadTweetImage(story.id, order, file, slot),
    onSuccess: (result) => {
      queryClient.setQueryData<TweetImage[]>(["tweet-images", story.id, order], (prev) => [
        ...(prev ?? []).filter((i) => i.slot !== result.slot),
        result,
      ]);
      setKnown((prev) => new Set(prev).add(`${order}:${result.slot}`));
      toast.success(`Picture added to tweet ${order}`);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Could not upload that picture");
    },
  });

  const remove = useMutation({
    mutationFn: (slot: number) => deleteTweetImage(story.id, order, slot),
    onSuccess: (_r, slot) => {
      queryClient.setQueryData<TweetImage[]>(["tweet-images", story.id, order], (prev) =>
        (prev ?? []).filter((i) => i.slot !== slot)
      );
      setKnown((prev) => {
        const next = new Set(prev);
        next.delete(`${order}:${slot}`);
        return next;
      });
      toast.success(`Picture removed from tweet ${order}`);
    },
    onError: () => toast.error("Could not remove that picture"),
  });

  const pickFile = (slot = 0) => {
    pendingSlot.current = slot;
    fileRef.current?.click();
  };

  /* The un-scaled 1600×900 node, rendered to PNG at 2× — the chart and text
     are vector so they stay sharp; uploaded photos are as sharp as uploaded. */
  const download = async () => {
    if (!exportRef.current) return;
    setDownloading(true);
    try {
      const { w, h } = nativeSize(media.kind);
      const dataUrl = await toPng(exportRef.current, { width: w, height: h, pixelRatio: 2, cacheBust: true });
      const link = document.createElement("a");
      link.download = `${story.ticker || "thread"}-tweet-${order}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      toast.error("Could not render the image");
    } finally {
      setDownloading(false);
    }
  };

  const length = active ? [...active.text].length : 0;
  const over = length > TWEET_MAX_CHARS;
  const stocks = story.stocks ?? [];
  const buyers = story.buyers ?? [];
  const company = story.company_name || stocks[0]?.short_name || story.ticker || "";

  const renderMedia = () => {
    const busy = upload.isPending;
    switch (media.kind) {
      case "none":
        return undefined;
      case "logos":
        return (
          <ScaledMedia ref={exportRef}>
            <ThreeLogoCard
              stocks={stocks}
              logos={[0, 1, 2].map((i) => urlFor(i) ?? stocks[i]?.logo_url ?? undefined)}
              onPick={(i) => !busy && pickFile(i)}
            />
          </ScaledMedia>
        );
      case "faces":
        return (
          <ScaledMedia ref={exportRef}>
            <InsiderFacesCard
              buyers={buyers}
              photos={buyers.map((b, i) => urlFor(i) ?? b.photo_url ?? undefined)}
              onPick={(i) => !busy && pickFile(i)}
            />
          </ScaledMedia>
        );
      case "chart":
      case "chart_entry":
      case "chart_month": {
        const chart = media.kind === "chart_month" ? story.chart_month : story.chart;
        if (!chart) return undefined;
        const entry = media.kind === "chart_entry";
        const photo = urlFor(0);
        // Slot 1 is the company icon on the card; a movers month card uses
        // the logo upload for both the photo half and the icon, as the panel does.
        const icon = media.kind === "chart_month" ? photo : urlFor(1) ?? stocks[0]?.logo_url;
        return (
          <ScaledMedia ref={exportRef}>
            <SplitMedia
              photoUrl={photo}
              hint={media.hint ?? "Click to upload a picture"}
              onUploadClick={() => !busy && pickFile(0)}
              busy={busy}
            >
              <CompanyChartCard
                companyName={company}
                ticker={chart.ticker || story.ticker || ""}
                chart={chart}
                logoUrl={icon}
                entryIndex={entry ? chart.entry_index : undefined}
                entryPhotoUrl={entry ? photo ?? story.featured_buyer?.photo_url ?? undefined : undefined}
              />
            </SplitMedia>
          </ScaledMedia>
        );
      }
      case "chart_wide":
        if (!story.chart) return undefined;
        return (
          <ScaledMedia ref={exportRef} nativeW={WIDE_W} nativeH={DESIGN_H}>
            <CompanyChartCard
              companyName={company}
              ticker={story.chart.ticker || story.ticker || ""}
              chart={story.chart}
              logoUrl={urlFor(1) ?? stocks[0]?.logo_url}
              width={WIDE_W}
              height={DESIGN_H}
              iconSize={124}
            />
          </ScaledMedia>
        );
      case "dual_image":
        return (
          <ScaledMedia ref={exportRef}>
            <DualImage
              left={urlFor(0)}
              right={urlFor(1)}
              onLeft={() => !busy && pickFile(0)}
              onRight={() => !busy && pickFile(1)}
              busy={busy}
            />
          </ScaledMedia>
        );
      case "holdings":
        return (
          <ScaledMedia ref={exportRef}>
            <div style={{ width: DESIGN_W, height: DESIGN_H, display: "flex", background: "#FFFFFF" }}>
              <PictureSlot
                url={urlFor(0)}
                hint={media.hint ?? "Click to upload fund / manager photo"}
                onClick={() => !busy && pickFile(0)}
                width={PHOTO_W}
                height={DESIGN_H}
                busy={busy}
              />
              <PositionsTableCard holdings={story.holdings ?? []} />
            </div>
          </ScaledMedia>
        );
      case "list_buys":
      case "list_sells": {
        const buys = media.kind === "list_buys";
        const rows = (buys ? story.top_buys : story.top_sells) ?? [];
        return (
          <ScaledMedia ref={exportRef} nativeW={LIST_W} nativeH={LIST_W}>
            <RankedListCard
              title={buys ? "Top Buys" : "Top Sells"}
              rows={rows}
              positive={buys}
              icons={rows.map((r, i) => urlFor(i) ?? r.icon_url ?? undefined)}
              onPick={(i) => !busy && pickFile(i)}
            />
          </ScaledMedia>
        );
      }
      case "square_chart":
      case "square_plain":
        if (!story.chart) return undefined;
        return (
          <ScaledMedia ref={exportRef} nativeW={SQ_W} nativeH={SQ_H}>
            <SquareChartCard
              headline={(story.headline || story.title || "").replace(/^\s*just\s+in\b\s*:?\s*/i, "")}
              chart={story.chart}
              personPhotoUrl={urlFor(0) ?? story.featured_buyer?.photo_url}
              companyLogoUrl={urlFor(1) ?? stocks[0]?.logo_url}
              insiderReturnPct={story.insider_return_pct ?? 0}
              showMarker={media.kind === "square_chart"}
              source={media.kind === "square_plain" ? story.source_label : undefined}
              onPickPerson={media.kind === "square_chart" ? () => !busy && pickFile(0) : undefined}
              onPickLogo={() => !busy && pickFile(1)}
            />
          </ScaledMedia>
        );
      default:
        return (
          <ScaledMedia ref={exportRef}>
            <PictureSlot
              url={urlFor(0)}
              hint={media.hint ?? "Click to upload an image"}
              onClick={() => !busy && pickFile(0)}
              busy={busy}
            />
          </ScaledMedia>
        );
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate({ file, slot: pendingSlot.current });
          e.target.value = "";
        }}
      />

      {tweets.length === 0 && (
        <p className="text-[15px] leading-5 text-slate-500">
          This thread has no text yet — check back shortly.
        </p>
      )}

      {active && (
        <div className="flex w-full max-w-[598px] flex-col gap-2">
          <div className="relative">
            <TweetPreview
              name={me?.name}
              handle={me?.handle}
              age={compactAge(story.published_at || story.created_at)}
              text={active.text}
              media={renderMedia()}
            />

            {/* Step through the thread from the card itself. Each side appears
                only when there is somewhere to go, so the arrows also say
                where in the thread you are. */}
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex(index - 1)}
                aria-label="Previous tweet"
                className="absolute left-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <i className="ph ph-caret-left text-[18px]" />
              </button>
            )}
            {index < tweets.length - 1 && (
              <button
                type="button"
                onClick={() => setIndex(index + 1)}
                aria-label="Next tweet"
                className="absolute right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
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
                    i === index ? "scale-125 bg-ink" : "bg-slate-300 hover:bg-slate-400"
                  }`}
                />
              ))}
            </div>
          )}

          {/* The panel's row: Actions, position in the thread, and when the
              post was generated — nothing else. */}
          <div className="flex flex-wrap items-center gap-3">
            <ActionsMenu>
              {(close) => (
                <>
                  <MenuItem
                    icon="ph-paper-plane-tilt"
                    onClick={() => {
                      close();
                      router.push(`/my-posts?story=${story.id}`);
                    }}
                  >
                    Submit your post
                  </MenuItem>
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
                  {tweets.length > 1 && (
                    <MenuItem
                      icon="ph-copy-simple"
                      onClick={() => {
                        close();
                        copy(fullThreadText(tweets), "Thread");
                      }}
                    >
                      Copy the whole thread
                    </MenuItem>
                  )}
                  <MenuItem
                    icon="ph-x-logo"
                    onClick={() => {
                      close();
                      window.open(postIntentUrl(active.text), "_blank", "noopener,noreferrer");
                    }}
                  >
                    Post this tweet on X
                  </MenuItem>
                  {(slots.length > 0 || media.kind !== "none") && (
                    <div className="my-1 border-t border-bone-200" />
                  )}
                  {slots.map(({ slot, label }) => (
                    <MenuItem
                      key={slot}
                      icon="ph-image"
                      onClick={() => {
                        close();
                        pickFile(slot);
                      }}
                    >
                      {known.has(`${order}:${slot}`) ? `Replace ${label}` : `Upload ${label}`}
                    </MenuItem>
                  ))}
                  {slots
                    .filter(({ slot }) => known.has(`${order}:${slot}`))
                    .map(({ slot, label }) => (
                      <MenuItem
                        key={`rm-${slot}`}
                        icon="ph-trash"
                        onClick={() => {
                          close();
                          remove.mutate(slot);
                        }}
                      >
                        Remove {label}
                      </MenuItem>
                    ))}
                  {media.kind !== "none" && (
                    <MenuItem
                      icon="ph-download-simple"
                      disabled={downloading}
                      onClick={() => {
                        close();
                        download();
                      }}
                    >
                      {downloading ? "Rendering…" : "Download image"}
                    </MenuItem>
                  )}
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

            {tweets.length > 1 && (
              <span className="text-[13px] leading-5 text-slate-500">
                Tweet {index + 1}/{tweets.length}
              </span>
            )}

            {over && (
              <span className="text-[12px] font-medium leading-4 text-red-600">
                {length}/{TWEET_MAX_CHARS} · over the limit
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              <span className="text-[12px] leading-4 text-slate-500">
                {formatStamp(story.published_at || story.created_at)}
              </span>
              {story.category_label && (
                <span className="rounded-[4px] bg-bone-100 px-2 py-0.5 text-[10px] font-medium uppercase leading-4 tracking-[0.04em] text-slate-500">
                  {story.category_label}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Every claim traces back to a disclosure. A creator about to post it
          should be able to see the filing first. */}
      {sources.length > 0 && sourcesOpen && (
        <ul className="flex max-w-[598px] flex-col gap-2 rounded-[8px] bg-bone-100 p-4">
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
    </div>
  );
}
