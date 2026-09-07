"use client";

/* Breaking News — market events + how the tracked investors are positioned. */

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchBreaking, refreshFeeds } from "@/lib/api";
import { Button, EmptyState, Eyebrow, Spinner } from "@/components/ui";
import { ScriptCard } from "@/components/script-card";

export default function BreakingNewsPage() {
  const queryClient = useQueryClient();
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
    queryKey: ["breaking"],
    queryFn: ({ pageParam }) => fetchBreaking(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.items.length === last.limit ? last.page + 1 : undefined),
  });
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  const refresh = useMutation({
    mutationFn: refreshFeeds,
    onSuccess: (result: { status: string; new_breaking?: number }) => {
      // the refresh syncs both feeds server-side — invalidate both, everywhere
      queryClient.invalidateQueries({ queryKey: ["breaking"] });
      queryClient.invalidateQueries({ queryKey: ["movers"] });
      if (result.status === "ok") {
        toast.success(
          result.new_breaking
            ? `${result.new_breaking} new stories pulled in`
            : "You're up to date"
        );
      } else {
        toast.error("Could not reach the Stalvian data engine");
      }
    },
    onError: () => toast.error("Could not reach the server — try again"),
  });

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-6">
          <Eyebrow icon="ph-lightning">Breaking News</Eyebrow>
          <h1 className="display-md max-w-[720px] text-ink">
            What just happened —
            <br />
            and who is positioned for it.
          </h1>
          <p className="max-w-[560px] text-[18px] leading-6 text-slate-500">
            Fresh market stories with the insider angle: how the politicians and funds in
            Stalvian&apos;s albums are placed. New scripts arrive through the day.
          </p>
        </div>
        <Button
          kind="secondary"
          size="m"
          icon="ph-arrows-clockwise"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          {refresh.isPending ? "Checking…" : "Check for New Stories"}
        </Button>
      </div>

      {isLoading && <Spinner label="Loading stories…" />}

      {/* A failed fetch must say so — the empty state below is gated on `data`,
          so without this the page renders nothing under the header.
          `paused` matters as much as `isError`: React Query parks a query
          there after a failed attempt without ever setting the error flag,
          and that state is indistinguishable from a blank page to the user. */}
      {!data && (isError || fetchStatus === "paused") && (
        <EmptyState
          icon="ph-plugs"
          title="Stories unavailable"
          body="The Stalvian server isn't reachable right now, so the feed couldn't load."
          action={
            <Button kind="secondary" size="m" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      )}

      {data && items.length === 0 && (
        <EmptyState
          icon="ph-newspaper"
          title="No breaking stories yet"
          body="The Stalvian engine publishes breaking scripts through the day. Check back soon, or pull the feed now."
          action={
            <Button kind="secondary" size="m" onClick={() => refresh.mutate()}>
              Check for New Stories
            </Button>
          }
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
          {isFetchingNextPage ? "Loading…" : "Load Older Stories"}
        </Button>
      )}
    </div>
  );
}
