"use client";

/* Admin › Content — which content actually produces views: by album, by story
   kind, by platform, and the top individual scripts. Eligible views (the
   payout basis) so it reconciles with earnings. */

import { useQuery } from "@tanstack/react-query";
import { fetchAdminContent } from "@/lib/api";
import { formatViews, PLATFORM_ICONS } from "@/lib/format";
import { Badge, EmptyState, Spinner } from "@/components/ui";
import { BarList } from "@/components/bar-list";

const KIND_LABELS: Record<string, string> = {
  album_story: "Album Stories",
  breaking: "Breaking News",
  mover: "Movers",
};

export default function AdminContentPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-content"],
    queryFn: fetchAdminContent,
  });

  if (isLoading) return <Spinner label="Loading content performance…" />;
  if (!data) return null;

  const empty =
    data.albums.length === 0 && data.top_stories.length === 0 && data.unlinked.videos === 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="display-md text-ink">Content Performance</h1>
        <p className="max-w-[560px] text-[16px] leading-6 text-slate-500">
          Which albums, feeds, and scripts drive the views — eligible views, so the
          numbers line up with earnings.
        </p>
      </div>

      {empty ? (
        <EmptyState
          icon="ph-film-slate"
          title="No verified videos yet"
          body="Once videos are verified, their performance rolls up here by album and script."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="dashed-card flex flex-col gap-5 p-6">
              <h2 className="display-xs text-ink">Views by album</h2>
              {data.albums.length > 0 ? (
                <BarList
                  rows={data.albums.slice(0, 10).map((a) => ({
                    label: a.album_name,
                    value: a.eligible_views,
                    sub: `${a.videos} video${a.videos === 1 ? "" : "s"}`,
                  }))}
                />
              ) : (
                <p className="text-[14px] leading-5 text-slate-400">
                  No album-linked videos yet.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-6">
              <div className="dashed-card flex flex-col gap-5 p-6">
                <h2 className="display-xs text-ink">Views by feed</h2>
                {data.kinds.length > 0 ? (
                  <BarList
                    rows={data.kinds.map((k) => ({
                      label: KIND_LABELS[k.kind] ?? k.kind,
                      value: k.eligible_views,
                      sub: `${k.videos} video${k.videos === 1 ? "" : "s"}`,
                    }))}
                  />
                ) : (
                  <p className="text-[14px] leading-5 text-slate-400">
                    No script-linked videos yet.
                  </p>
                )}
              </div>
              <div className="dashed-card flex flex-col gap-5 p-6">
                <h2 className="display-xs text-ink">Views by platform</h2>
                <BarList
                  rows={data.platforms.map((p) => ({
                    label: p.platform,
                    icon: PLATFORM_ICONS[p.platform] ?? "ph-play",
                    value: p.eligible_views,
                    sub: `${p.videos} video${p.videos === 1 ? "" : "s"}`,
                  }))}
                />
              </div>
            </div>
          </div>

          <div className="dashed-card flex flex-col gap-5 p-6 lg:p-8">
            <h2 className="display-xs text-ink">Top scripts</h2>
            {data.top_stories.length > 0 || data.unlinked.videos > 0 ? (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-ink">
                    <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Script</th>
                    <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Feed</th>
                    <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Album</th>
                    <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">Videos</th>
                    <th className="py-3 text-right text-[13px] font-medium leading-5 text-slate-500">Views</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_stories.map((s) => (
                    <tr key={s.story_id} className="border-b border-bone-200">
                      <td className="max-w-[320px] truncate py-3 pr-4 text-[14px] leading-5 text-ink">
                        {s.title}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge>{KIND_LABELS[s.kind] ?? s.kind}</Badge>
                      </td>
                      <td className="py-3 pr-4 text-[13px] leading-5 text-slate-500">
                        {s.album_name || "—"}
                      </td>
                      <td className="py-3 pr-4 text-right text-[14px] leading-5 text-ink">
                        {s.videos}
                      </td>
                      <td className="py-3 text-right text-[14px] leading-5 text-ink">
                        {formatViews(s.eligible_views)}
                      </td>
                    </tr>
                  ))}
                  {data.unlinked.videos > 0 && (
                    <tr className="border-b border-bone-200">
                      <td className="py-3 pr-4 text-[14px] leading-5 text-slate-400">
                        No script linked
                      </td>
                      <td className="py-3 pr-4">
                        <Badge>—</Badge>
                      </td>
                      <td className="py-3 pr-4 text-[13px] leading-5 text-slate-400">—</td>
                      <td className="py-3 pr-4 text-right text-[14px] leading-5 text-slate-500">
                        {data.unlinked.videos}
                      </td>
                      <td className="py-3 text-right text-[14px] leading-5 text-slate-500">
                        {formatViews(data.unlinked.eligible_views)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <p className="text-[14px] leading-5 text-slate-400">No verified videos yet.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
