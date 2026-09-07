"use client";

/* Albums — each Stalvian portfolio with its live chart vs the S&P 500, real
   returns, and current holdings. The creators' menu: pick a performer, tell
   its story. */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAlbumDetail,
  fetchAlbumHistory,
  fetchAlbums,
  type AlbumStats,
} from "@/lib/api";
import { albumImage } from "@/lib/album-images";
import { Badge, Button, EmptyState, Eyebrow, Spinner } from "@/components/ui";
import { PortfolioChart } from "@/components/line-chart";

function parseReturn(value: string | undefined): number {
  if (!value) return -Infinity;
  const n = parseFloat(value.replace(/[+%\s]/g, "").replace(",", "."));
  return Number.isNaN(n) ? -Infinity : n;
}

function Stat({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "green" | "red";
}) {
  const tones = { ink: "text-ink", green: "text-green-600", red: "text-[#c03f2e]" };
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-slate-400">
        {label}
      </span>
      <span className={`text-[15px] font-medium leading-5 ${tones[tone]}`}>{value}</span>
    </div>
  );
}

function Holdings({ slug }: { slug: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["album-detail", slug],
    queryFn: () => fetchAlbumDetail(slug),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  if (isLoading) return <Spinner label="Loading holdings…" />;
  if (isError || !data?.holdings?.length) {
    return (
      <p className="text-[13px] leading-5 text-slate-400">
        Holdings arrive with the panel&apos;s portfolio data access.
      </p>
    );
  }
  const top = [...data.holdings].sort((a, b) => b.weight - a.weight).slice(0, 15);
  const maxWeight = top[0]?.weight || 1;
  return (
    <div className="flex flex-col gap-2">
      {top.map((h) => (
        <div key={h.ticker} className="flex items-center gap-3">
          <span className={`w-14 shrink-0 text-[13px] font-medium leading-5 ${h.is_stale ? "text-slate-400" : "text-ink"}`}>
            ${h.ticker}
          </span>
          <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-bone-100">
            <div
              className="h-full rounded-full bg-ink"
              style={{ width: `${Math.max((h.weight / maxWeight) * 100, 2)}%` }}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-[13px] leading-5 text-slate-500">
            {(h.weight * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })}%
          </span>
        </div>
      ))}
      {data.holdings_as_of && (
        <p className="pt-1 text-[11px] leading-4 text-slate-400">
          As of {new Date(data.holdings_as_of).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      )}
    </div>
  );
}

const RANGE_PRESETS = [
  { key: "1w", label: "1W", days: 7 },
  { key: "1m", label: "1M", days: 30 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "all", label: "ALL", days: null },
] as const;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

type Pt = { date: string; portfolio: number | null; spy: number | null };

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
}

/* Window stats, panel-style: returns over the window, CAGR annualized from it,
   drawdown within it, sharpe/alpha/beta from the window's daily returns. */
function computeWindowStats(points: Pt[]) {
  const pts = points.filter((p) => p.portfolio != null && p.spy != null);
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const tr = last.portfolio! / first.portfolio! - 1;
  const trSpy = last.spy! / first.spy! - 1;
  const days = Math.max(
    (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000,
    1
  );
  const annualize = (r: number) => Math.pow(1 + r, 365 / days) - 1;
  const cagr = annualize(tr);
  const cagrSpy = annualize(trSpy);

  let peak = -Infinity;
  let maxDD = 0;
  for (const p of pts) {
    peak = Math.max(peak, p.portfolio!);
    maxDD = Math.min(maxDD, p.portfolio! / peak - 1);
  }

  const rp: number[] = [];
  const rs: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    rp.push(pts[i].portfolio! / pts[i - 1].portfolio! - 1);
    rs.push(pts[i].spy! / pts[i - 1].spy! - 1);
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const mp = mean(rp);
  const ms = mean(rs);
  const varSpy = mean(rs.map((r) => (r - ms) ** 2));
  const cov = mean(rp.map((r, i) => (r - mp) * (rs[i] - ms)));
  const beta = varSpy > 0 ? cov / varSpy : null;
  const volP = Math.sqrt(mean(rp.map((r) => (r - mp) ** 2)) * 252);
  const sharpe = volP > 0 ? (mp * 252) / volP : null;
  const alpha = beta != null ? cagr - beta * cagrSpy : null;
  return { tr, cagr, maxDD, sharpe, beta, alpha };
}

function AlbumCard({ album, kind }: { album: AlbumStats; kind: "fund" | "politician" }) {
  const [preset, setPreset] = useState<"1w" | "1m" | "1y" | "all" | "custom">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [holdingsOpen, setHoldingsOpen] = useState(false);
  const src = albumImage(album.name);
  const positive = parseReturn(album.total_return) >= 0;
  const slug = album.slug || "";

  // Fetch the full series once; every range is a client-side slice.
  const { data: history, isLoading: chartLoading, isError: chartError } = useQuery({
    queryKey: ["album-history", slug, "all"],
    queryFn: () => fetchAlbumHistory(slug, "all"),
    enabled: !!slug,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  const filteredPoints = useMemo(() => {
    const points = history?.points ?? [];
    let start = from;
    if (preset !== "custom") {
      const days = RANGE_PRESETS.find((p) => p.key === preset)?.days;
      start = days ? isoDaysAgo(days) : "";
    }
    const end = preset === "custom" ? to : "";
    // ISO dates compare correctly as strings
    const sliced = points.filter((p) => (!start || p.date >= start) && (!end || p.date <= end));
    // Rebase to 100 at the window start so short windows show real movement
    // (raw index values sit at e.g. 500 vs 170 and would flatten the lines).
    const baseP = sliced.find((p) => p.portfolio != null)?.portfolio;
    const baseS = sliced.find((p) => p.spy != null)?.spy;
    return sliced.map((p) => ({
      ...p,
      portfolio: p.portfolio != null && baseP ? (p.portfolio / baseP) * 100 : null,
      spy: p.spy != null && baseS ? (p.spy / baseS) * 100 : null,
    }));
  }, [history, preset, from, to]);

  // ALL shows the panel's canonical all-time stats; any narrower window gets
  // stats recomputed from that window's series (like the internal panel).
  const windowed = preset !== "all" || !!from || !!to;
  const windowStats = useMemo(
    () => computeWindowStats(filteredPoints),
    [filteredPoints]
  );
  const allTimeBeta = useMemo(
    () => computeWindowStats(history?.points ?? [])?.beta,
    [history]
  );
  const dataAsOf = history?.points?.length
    ? history.points[history.points.length - 1].date
    : null;

  return (
    <div className="dashed-card flex flex-col gap-5 bg-white p-6">
      {/* Header: portrait right before the name */}
      <div className="flex items-center gap-4">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={album.name} className="h-12 w-12 shrink-0 rounded-[8px] object-cover" />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-bone-100">
            <i className="ph ph-user-circle text-[26px] text-slate-400" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="display-xs truncate text-ink">{album.name}</h3>
          <div className="mt-0.5 text-[13px] leading-4 text-slate-400">
            {kind === "fund"
              ? "Hedge Fund"
              : `Politician${album.party ? ` · ${album.party}` : ""}${album.chamber ? ` · ${album.chamber}` : ""}`}
          </div>
        </div>
      </div>

      {/* Range filter: custom dates + quick presets */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPreset("custom");
          }}
          className="h-8 rounded-[6px] bg-bone-100 px-2 text-[12px] leading-4 text-ink outline-none [color-scheme:light]"
          aria-label="From date"
        />
        <i className="ph ph-arrow-right text-[14px] text-slate-400" />
        <input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPreset("custom");
          }}
          className="h-8 rounded-[6px] bg-bone-100 px-2 text-[12px] leading-4 text-ink outline-none [color-scheme:light]"
          aria-label="To date"
        />
        <div className="ml-auto flex gap-1 rounded-full bg-bone-100 p-1">
          {RANGE_PRESETS.map((r) => (
            <button
              key={r.key}
              onClick={() => {
                setPreset(r.key);
                setFrom("");
                setTo("");
              }}
              className={`cursor-pointer rounded-full px-3 py-1 text-[11px] font-bold uppercase leading-4 tracking-[0.04em] ${
                preset === r.key ? "bg-ink text-white" : "text-slate-500 hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {chartLoading && (
        <div className="flex h-[180px] items-center justify-center rounded-[8px] bg-bone-100">
          <Spinner />
        </div>
      )}
      {chartError && (
        <div className="flex h-[180px] flex-col items-center justify-center gap-2 rounded-[8px] bg-bone-100 px-6 text-center">
          <i className="ph ph-chart-line text-[24px] text-slate-400" />
          <p className="text-[13px] leading-5 text-slate-400">
            Performance chart pending — awaiting portfolio data access from the panel.
          </p>
        </div>
      )}
      {history && <PortfolioChart points={filteredPoints} />}

      {/* Stats — all-time from the panel, or recomputed for the active window */}
      {windowed && windowStats ? (
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 border-t border-bone-200 pt-4">
          <Stat
            label="Total Return"
            value={fmtPct(windowStats.tr)}
            tone={windowStats.tr >= 0 ? "green" : "red"}
          />
          <Stat label="Max Drawdown" value={fmtPct(windowStats.maxDD)} tone="red" />
          <Stat label="CAGR" value={fmtPct(windowStats.cagr)} />
          <Stat
            label="Alpha"
            value={windowStats.alpha != null ? fmtPct(windowStats.alpha) : "—"}
          />
          <Stat
            label="Sharpe"
            value={windowStats.sharpe != null ? windowStats.sharpe.toFixed(2) : "—"}
          />
          <Stat
            label="Beta"
            value={windowStats.beta != null ? windowStats.beta.toFixed(2) : "—"}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 border-t border-bone-200 pt-4">
          <Stat label="Total Return" value={album.total_return} tone={positive ? "green" : "ink"} />
          <Stat label="Max Drawdown" value={album.max_drawdown} tone="red" />
          <Stat label="CAGR" value={album.cagr} />
          <Stat label="Alpha" value={album.alpha} />
          <Stat label="Sharpe" value={album.sharpe} />
          <Stat label="Beta" value={allTimeBeta != null ? allTimeBeta.toFixed(2) : "—"} />
        </div>
      )}
      {dataAsOf && (
        <p className="-mt-3 text-right text-[11px] leading-4 text-slate-400">
          Data as of{" "}
          {new Date(dataAsOf).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
      )}

      {/* Holdings */}
      <div className="border-t border-bone-200 pt-4">
        <button
          onClick={() => setHoldingsOpen(!holdingsOpen)}
          className="flex w-full cursor-pointer items-center justify-between text-[13px] font-medium leading-5 text-ink hover:opacity-75"
        >
          Current Top-15 Allocation
          <i className={`ph ${holdingsOpen ? "ph-caret-up" : "ph-caret-down"} text-[16px] text-slate-400`} />
        </button>
        {holdingsOpen && (
          <div className="pt-4">
            <Holdings slug={slug} />
          </div>
        )}
      </div>

      <Link href="/album-stories">
        <Button kind="secondary" size="s" icon="ph-film-slate" className="w-full">
          Tell This Story
        </Button>
      </Link>
    </div>
  );
}

export default function AlbumsPage() {
  const [kind, setKind] = useState<"fund" | "politician">("fund");
  const { data, isLoading, isError, fetchStatus, refetch } = useQuery({
    queryKey: ["albums"],
    queryFn: fetchAlbums,
  });

  const albums = useMemo(() => {
    const rows = (kind === "fund" ? data?.funds : data?.politicians) ?? [];
    return [...rows].sort((a, b) => parseReturn(b.total_return) - parseReturn(a.total_return));
  }, [data, kind]);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-6">
          <Eyebrow icon="ph-stack">Albums</Eyebrow>
          <h1 className="display-md max-w-[720px] text-ink">
            The portfolios behind
            <br />
            every story.
          </h1>
          <p className="max-w-[560px] text-[18px] leading-6 text-slate-500">
            Each album mirrors a real investor&apos;s public filings — live performance
            against the S&amp;P 500, and what they hold right now.
          </p>
        </div>
        <div className="flex gap-1 rounded-full bg-bone-100 p-1">
          {(
            [
              { key: "fund", label: "Hedge Funds" },
              { key: "politician", label: "Politicians" },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              onClick={() => setKind(f.key)}
              className={`cursor-pointer rounded-full px-4 py-1.5 text-[13px] font-medium leading-4 ${
                kind === f.key ? "bg-ink text-white" : "text-slate-500 hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <Spinner label="Loading albums…" />}

      {/* The catalog lives on the panel — a failed fetch must say so rather
          than leave the page blank under the header. `paused` counts too:
          React Query parks a query there after a failed attempt without ever
          setting the error flag. */}
      {!data && (isError || fetchStatus === "paused") && (
        <EmptyState
          icon="ph-plugs"
          title="Albums unavailable"
          body="The Stalvian engine isn't reachable right now, so the album catalog couldn't load."
          action={
            <Button kind="secondary" size="m" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      )}

      {data && albums.length === 0 && (
        <EmptyState
          icon="ph-stack"
          title="No albums yet"
          body="Albums appear here as soon as the Stalvian engine has their performance data."
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {albums.map((album) => (
          <AlbumCard key={album.slug || album.name} album={album} kind={kind} />
        ))}
      </div>
    </div>
  );
}
