"use client";

/* Daily Scripts — every shoot-ready feed the panel publishes, under one tab.

   The server owns the list of feeds (GET /api/feed/types) and the page is
   deliberately generic about them — heading, blurb and empty state read the
   same whichever feed is selected — so a new feed needs NO frontend change at
   all, not even a copy entry. A feed can also be backed by several panel feeds
   at once: Top Trades is hindsight and trending interleaved.

   The active feed lives in `?type=`, so a creator can link someone straight to
   one and the browser's back button steps between them. */

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFeed, fetchFeedTypes, markFeedSeen } from "@/lib/api";
import { Button, Dropdown, EmptyState, Eyebrow, Spinner } from "@/components/ui";
import { ScriptCard } from "@/components/script-card";
import { ThreadCard } from "@/components/thread-card";

export interface ScriptFeedProps {
  /** Route this tab lives at, for the ?type= links. */
  basePath: string;
  eyebrow: string;
  icon?: string;
  headline: string;
  blurb: string;
  /** What one item is called in the copy: "scripts" to shoot, "threads" to post. */
  noun?: string;
}

function ScriptFeed({
  basePath,
  eyebrow,
  icon = "ph-lightning",
  headline,
  blurb,
  noun = "scripts",
}: ScriptFeedProps) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const { data: types } = useQuery({ queryKey: ["feed-types"], queryFn: fetchFeedTypes });

  // Fall back to the first feed the server offers rather than a hardcoded key:
  // the set of feeds is the server's to decide.
  const requested = params.get("type");
  const active =
    types?.find((t) => t.key === requested) ?? types?.[0] ?? null;

  const {
    data,
    isLoading,
    isError,
    fetchStatus,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["feed", active?.key],
    queryFn: ({ pageParam }) => fetchFeed(active!.key, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.items?.length && last.items.length === last.limit ? last.page + 1 : undefined,
    enabled: !!active,
    // Scripts are pushed to the server, not pulled by the creator — so a tab
    // left open all day has to refresh itself. Coming back to the tab is the
    // natural moment; the app-wide default has this off.
    refetchOnWindowFocus: true,
  });
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  /* Looking at a feed is what marks it read. Fire once the page has actually
     rendered scripts, not on mount — a creator who lands on a feed that is
     still loading, then leaves, has not seen anything. */
  const seen = useMutation({
    mutationFn: markFeedSeen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["feed-types"] }),
  });
  const activeKey = active?.key;
  const loaded = !!data;
  const unreadHere = active?.unread ?? 0;
  useEffect(() => {
    if (activeKey && loaded && unreadHere > 0) seen.mutate(activeKey);
    // `seen` is a stable mutation object; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, loaded, unreadHere]);

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-6">
          <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
          <h1 className="display-md max-w-[720px] text-ink">{headline}</h1>
          <p className="max-w-[560px] text-[18px] leading-6 text-slate-500">{blurb}</p>
        </div>
      </div>

      {(isLoading || !types) && <Spinner label={`Loading ${noun}…`} />}

      {/* A failed fetch must say so — the empty state below is gated on `data`,
          so without this the page renders nothing under the header.
          `paused` matters as much as `isError`: React Query parks a query
          there after a failed attempt without ever setting the error flag,
          and that state is indistinguishable from a blank page to the user. */}
      {!data && (isError || fetchStatus === "paused") && (
        <EmptyState
          icon="ph-plugs"
          title={`${noun[0].toUpperCase()}${noun.slice(1)} unavailable`}
          body="The Stalvian server isn't reachable right now, so the feed couldn't load."
          action={
            <Button kind="secondary" size="m" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      )}

      {types && types.length > 0 && active && (
        <div className="-mb-8 flex">
          <Dropdown
            value={active.key}
            onChange={(key) => router.replace(`${basePath}?type=${key}`, { scroll: false })}
            options={types.map((t) => ({
              value: t.key,
              label: t.unread ? `${t.label} · ${t.unread} new` : t.label,
            }))}
            icon="ph-squares-four"
          />
        </div>
      )}

      {data && items.length === 0 && active && (
        <EmptyState
          icon="ph-newspaper"
          title={`No ${active.label.toLowerCase()} ${noun} yet`}
          body={`${noun[0].toUpperCase()}${noun.slice(1)} arrive on their own as the Stalvian engine publishes them — nothing to pull, this feed fills itself in.`}
        />
      )}

      {/* A story with tweets is posted, not shot: the card follows the content,
          so one feed component serves both surfaces. */}
      <div className="flex flex-col gap-4">
        {items.map((story) =>
          story.tweets?.length ? (
            <ThreadCard key={story.id} story={story} />
          ) : (
            <ScriptCard key={story.id} story={story} />
          )
        )}
      </div>

      {hasNextPage && (
        <Button
          kind="secondary"
          size="m"
          className="self-center"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? "Loading…" : `Load Older ${noun[0].toUpperCase()}${noun.slice(1)}`}
        </Button>
      )}
    </div>
  );
}

export function ScriptFeedPage(props: ScriptFeedProps) {
  // useSearchParams needs a Suspense boundary above it in the App Router.
  return (
    <Suspense fallback={<Spinner label={`Loading ${props.noun ?? "scripts"}…`} />}>
      <ScriptFeed {...props} />
    </Suspense>
  );
}
