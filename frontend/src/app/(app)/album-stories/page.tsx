"use client";

/* Album Stories — one "Create New Script" button; a modal walks the creator
   through album (portrait list, like the Stalvian site) then angle. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchAlbums, fetchMyStories, generateStory, StoryPayload } from "@/lib/api";
import { albumImage } from "@/lib/album-images";
import { Button, EmptyState, Eyebrow, Field, Spinner } from "@/components/ui";
import { Modal } from "@/components/modal";
import { ScriptCard } from "@/components/script-card";

interface AlbumRow {
  kind: "fund" | "politician";
  name: string;
  slug?: string;
  ret: string;
  retValue: number;
  party?: string | null;
}

const ANGLE_HINTS: Record<string, string> = {
  origin_story: "How they started — the story behind the name",
  performance: "The numbers: returns, records, beating the market",
  trading_record: "Their full trading track record, wins and losses",
  scandal: "Controversy, investigations, drama",
  positions: "What they're betting on right now",
  committee_trades: "Committee seats vs the stocks they trade",
  hypocrisy: "What they say in public vs how they trade",
  best_trades: "The picks that made the most money",
  strategy: "How they actually make money",
  ceo_founder: "The person behind the fund",
  funny_quirky: "The weird and entertaining side",
  comparison: "Head-to-head against the S&P 500 or a rival",
};

function parseReturn(ret: string | undefined): number {
  if (!ret) return -Infinity;
  const value = parseFloat(ret.replace(/[+%\s]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isNaN(value) ? -Infinity : value;
}

function AlbumPortrait({ name, size = 56 }: { name: string; size?: number }) {
  const src = albumImage(name);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-[8px] object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-[8px] bg-bone-100"
    >
      <i className="ph ph-user-circle text-[28px] text-slate-400" />
    </div>
  );
}

export default function AlbumStoriesPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumRow | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | "fund" | "politician">("all");
  const [search, setSearch] = useState("");
  const [freshStory, setFreshStory] = useState<StoryPayload | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const { data: catalog } = useQuery({ queryKey: ["albums"], queryFn: fetchAlbums });
  const { data: mine } = useQuery({ queryKey: ["my-stories"], queryFn: fetchMyStories });

  const generate = useMutation({
    mutationFn: generateStory,
    onSuccess: (story) => {
      setFreshStory(story);
      setPendingLabel(null);
      queryClient.invalidateQueries({ queryKey: ["my-stories"] });
      toast.success("Your script is ready");
    },
    onError: () => {
      setPendingLabel(null);
      toast.error("Generation failed — try again in a minute");
    },
  });

  const albums = useMemo<AlbumRow[]>(() => {
    if (!catalog) return [];
    const rows: AlbumRow[] = [
      ...catalog.funds.map((f) => ({
        kind: "fund" as const,
        name: f.name,
        slug: f.slug,
        ret: f.total_return,
        retValue: parseReturn(f.total_return),
      })),
      ...catalog.politicians.map((p) => ({
        kind: "politician" as const,
        name: p.name,
        slug: p.slug,
        ret: p.total_return,
        retValue: parseReturn(p.total_return),
        party: p.party,
      })),
    ];
    return rows.sort((a, b) => b.retValue - a.retValue);
  }, [catalog]);

  const visible = albums.filter(
    (a) =>
      (kindFilter === "all" || a.kind === kindFilter) &&
      a.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const angles = selectedAlbum
    ? (selectedAlbum.kind === "fund" ? catalog?.fund_angles : catalog?.politician_angles) || []
    : [];

  const openModal = () => {
    setSelectedAlbum(null);
    setSearch("");
    setModalOpen(true);
  };

  const pickAngle = (angleKey: string, angleLabel: string) => {
    if (!selectedAlbum) return;
    setModalOpen(false);
    setFreshStory(null);
    setPendingLabel(`${selectedAlbum.name} — ${angleLabel}`);
    generate.mutate({
      album_kind: selectedAlbum.kind,
      album_name: selectedAlbum.name,
      album_slug: selectedAlbum.slug,
      angle: angleKey,
    });
  };

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-6">
          <Eyebrow icon="ph-vinyl-record">Album Stories</Eyebrow>
          <h1 className="display-md max-w-[720px] text-ink">
            Every album has a story.
            <br />
            Pick one and shoot.
          </h1>
          <p className="max-w-[560px] text-[18px] leading-6 text-slate-500">
            Every album mirrors a real investor tracked by Stalvian. Choose one, choose the
            angle, and we write the script in your language.
          </p>
        </div>
        <Button icon="ph-plus" onClick={openModal} disabled={!catalog || generate.isPending}>
          Create New Script
        </Button>
      </div>

      {generate.isPending && (
        <div className="dashed-card flex items-center gap-4 p-6">
          <Spinner />
          <div className="flex flex-col gap-1">
            <span className="text-[16px] font-medium leading-6 text-ink">
              Writing your script{pendingLabel ? ` — ${pendingLabel}` : ""}
            </span>
            <span className="text-[14px] leading-5 text-slate-500">
              Researching and writing takes up to a minute. Stay on this page.
            </span>
          </div>
        </div>
      )}

      {freshStory && <ScriptCard story={freshStory} defaultOpen />}

      <div className="flex flex-col gap-5">
        <h2 className="display-sm text-ink">Your stories</h2>
        {mine && mine.items.length === 0 && !freshStory && !generate.isPending && (
          <EmptyState
            icon="ph-file-dashed"
            title="No stories yet"
            body="Create your first script — it stays here so you can come back to it any time."
            action={
              <Button kind="secondary" size="m" onClick={openModal}>
                Create New Script
              </Button>
            }
          />
        )}
        <div className="flex flex-col gap-4">
          {(mine?.items || [])
            .filter((s) => s.id !== freshStory?.id)
            .map((story) => (
              <ScriptCard key={story.id} story={story} />
            ))}
        </div>
      </div>

      {/* ---- Modal: step 1 pick album, step 2 pick angle ---- */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          selectedAlbum ? (
            <button
              onClick={() => setSelectedAlbum(null)}
              className="flex cursor-pointer items-center gap-3 text-ink hover:opacity-75"
            >
              <i className="ph ph-arrow-left text-[20px]" />
              <span className="display-xs">Choose your angle</span>
            </button>
          ) : (
            "Choose an album"
          )
        }
      >
        {!selectedAlbum && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <Field
                icon="ph-magnifying-glass"
                placeholder="Search albums…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="min-w-[220px] flex-1"
              />
              <div className="flex gap-1 rounded-full bg-bone-100 p-1">
                {(
                  [
                    { key: "all", label: "All" },
                    { key: "fund", label: "Hedge Funds" },
                    { key: "politician", label: "Politicians" },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setKindFilter(f.key)}
                    className={`cursor-pointer rounded-full px-4 py-1.5 text-[13px] font-medium leading-4 ${
                      kindFilter === f.key ? "bg-ink text-white" : "text-slate-500"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-10">
              {visible.map((album) => (
                <button
                  key={`${album.kind}:${album.name}`}
                  onClick={() => setSelectedAlbum(album)}
                  className="flex cursor-pointer items-center gap-4 border-b border-bone-200 py-4 text-left hover:bg-bone-100"
                >
                  <AlbumPortrait name={album.name} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="text-[14px] leading-5">
                      <span className={`font-medium ${album.retValue >= 0 ? "text-green-600" : "text-ink"}`}>
                        {album.ret || "—"}
                      </span>{" "}
                      <span className="text-slate-400">total return</span>
                    </div>
                    <div className="truncate text-[17px] font-medium leading-6 text-ink">
                      {album.name}
                    </div>
                    <div className="text-[13px] leading-4 text-slate-400">
                      {album.kind === "fund" ? "Hedge Fund" : "Politician"}
                      {album.party ? ` · ${album.party}` : ""}
                    </div>
                  </div>
                  <i className="ph ph-caret-right text-[18px] text-slate-400" />
                </button>
              ))}
              {visible.length === 0 && (
                <p className="py-8 text-[15px] leading-5 text-slate-500">
                  No albums match your search.
                </p>
              )}
            </div>
          </div>
        )}

        {selectedAlbum && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-4">
              <AlbumPortrait name={selectedAlbum.name} size={64} />
              <div className="flex flex-col gap-0.5">
                <div className="text-[18px] font-medium leading-6 text-ink">{selectedAlbum.name}</div>
                <div className="text-[14px] leading-5 text-slate-400">
                  {selectedAlbum.kind === "fund" ? "Hedge Fund" : "Politician"} ·{" "}
                  <span className={selectedAlbum.retValue >= 0 ? "text-green-600" : "text-ink"}>
                    {selectedAlbum.ret}
                  </span>{" "}
                  total return
                </div>
              </div>
            </div>

            <div className="flex flex-col">
              <div className="pb-2 text-[14px] font-medium leading-5 text-slate-500">
                What kind of story do you want to tell?
              </div>
              {angles.map((angle) => (
                <button
                  key={angle.key}
                  onClick={() => pickAngle(angle.key, angle.label)}
                  className="flex cursor-pointer items-center gap-4 border-b border-bone-200 py-4 text-left hover:bg-bone-100"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="text-[16px] font-medium leading-6 text-ink">{angle.label}</div>
                    {ANGLE_HINTS[angle.key] && (
                      <div className="text-[14px] leading-5 text-slate-400">
                        {ANGLE_HINTS[angle.key]}
                      </div>
                    )}
                  </div>
                  <i className="ph ph-caret-right text-[18px] text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
