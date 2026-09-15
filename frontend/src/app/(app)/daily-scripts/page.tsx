"use client";

/* Daily Scripts — every shoot-ready feed the panel publishes, under one tab.

   Breaking News and Movers used to be two near-identical pages; more feeds are
   coming, and a tab per feed does not scale. The server owns the list of feeds
   (GET /api/feed/types) and the page is deliberately generic about them —
   heading, blurb and empty state read the same whichever feed is selected — so
   a new feed needs NO frontend change at all, not even a copy entry.

   The active feed lives in `?type=`, so a creator can link someone straight to
   one and the browser's back button steps between them. */

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFeed, fetchFeedTypes, markFeedSeen } from "@/lib/api";
import { Button, Dropdown, EmptyState, Eyebrow, Spinner, UnreadDot } from "@/components/ui";
import { ScriptCard } from "@/components/script-card";

function DailyScripts() {
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
    getNextPageParam: (last) => (last.items.length === last.limit ? last.page + 1 : undefined),
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
          <Eyebrow icon="ph-lightning">Daily Scripts</Eyebrow>
          <h1 className="display-md max-w-[720px] text-ink">Fresh scripts, every day.</h1>
          <p className="max-w-[560px] text-[18px] leading-6 text-slate-500">
            Every story comes from real moves by politicians, hedge funds and insiders.
            Pick a feed, take a hook, and film it — new scripts arrive on their own.
          </p>
        </div>
      </div>

      {(isLoading || !types) && <Spinner label="Loading scripts…" />}

      {/* A failed fetch must say so — the empty state below is gated on `data`,
          so without this the page renders nothing under the header.
          `paused` matters as much as `isError`: React Query parks a query
          there after a failed attempt without ever setting the error flag,
          and that state is indistinguishable from a blank page to the user. */}
      {!data && (isError || fetchStatus === "paused") && (
        <EmptyState
          icon="ph-plugs"
          title="Scripts unavailable"
          body="The Stalvian server isn't reachable right now, so the feed couldn't load."
          action={
            <Button kind="secondary" size="m" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      )}

      {types && types.length > 0 && active && (
        <div className="-mb-8 flex flex-wrap items-center gap-2">
          <Dropdown
            value={active.key}
            onChange={(key) => router.replace(`/daily-scripts?type=${key}`, { scroll: false })}
            options={types.map((t) => ({
              value: t.key,
              label: t.unread ? `${t.label} · ${t.unread} new` : t.label,
            }))}
            icon="ph-squares-four"
          />
          {types.some((t) => t.key !== active.key && t.unread > 0) && (
            <div className="flex items-center gap-2 pl-1">
              {types
                .filter((t) => t.key !== active.key && t.unread > 0)
                .map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() =>
                      router.replace(`/daily-scripts?type=${t.key}`, { scroll: false })
                    }
                    className="flex h-9 cursor-pointer items-center gap-2 rounded-full px-3 text-[13px] font-medium leading-4 text-slate-500 hover:text-ink"
                  >
                    {t.label}
                    <UnreadDot count={t.unread} />
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {data && items.length === 0 && active && (
        <EmptyState
          icon="ph-newspaper"
          title={`No ${active.label.toLowerCase()} scripts yet`}
          body="Scripts arrive on their own as the Stalvian engine publishes them — nothing to pull, this feed fills itself in."
        />
      )}

      <div className="flex flex-col gap-4">
        {items.map((story) => (
          <ScriptCard key={story.id} story={story} />
        ))}
      </div>

      {hasNextPage && (
        <Button
          kind="secondary"
          size="m"
          className="self-center"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? "Loading…" : "Load Older Scripts"}
        </Button>
      )}
    </div>
  );
}

export default function DailyScriptsPage() {
  // useSearchParams needs a Suspense boundary above it in the App Router.
  return (
    <Suspense fallback={<Spinner label="Loading scripts…" />}>
      <DailyScripts />
    </Suspense>
  );
}
