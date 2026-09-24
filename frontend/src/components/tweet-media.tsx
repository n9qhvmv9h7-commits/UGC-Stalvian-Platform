"use client";

/* The cards under a tweet — ports of the Marketing Panel's tweet media.

   The panel draws every card at a fixed 1600×900 design size (X's inline
   image frame) and scales it down to fit the preview; the un-scaled node is
   what exports to PNG, so the picture a creator downloads is razor-sharp
   whatever their screen. Same here: ScaledMedia scales, the inner ref is the
   export target.

   Sources (frontend/src/components/tweets/ in the panel):
   - split-tweet-media.tsx   CompanyChartCard, SplitTweetMedia
   - breaking-news-tweet-panel.tsx  ThreeLogoCard, InsiderFacesCard
   - insider-picks-tweet-panel.tsx  ScaledMedia, InsiderPicksSquareCard
   - hedge-fund-alert-tweet-panel.tsx  PositionsTableCard, HedgeFundListCard
   - big-trade-alert-tweet-panel.tsx  the two-upload split (DualImage)

   Colours stay the panel's on purpose: these cards are posted to X as
   images, and the two apps must not disagree about what the same post looks
   like. The only Stalvian-system touch is the font (Geist is both apps'). */

import {
  forwardRef,
  useCallback,
  useId,
  useState,
  type ReactNode,
} from "react";
import type { RankedRow, ThreadBuyer, ThreadChart, ThreadHolding, ThreadStock } from "@/lib/api";

export const DESIGN_W = 1600;
export const DESIGN_H = 900;
const HALF_W = DESIGN_W / 2;

const RED = "#F4433C";
const GREEN = "#16A34A";
const GRAY = "#9AA0A6";
const INK = "#010510";
const FONT = "var(--font-geist-sans), 'Geist', system-ui, -apple-system, sans-serif";

export type CardTheme = "light" | "dark";

/* Both card palettes, the panel's values. Dark is for posts meant to sit
   flush with X's dark timeline; light is the default. The wordmark is one
   asset filtered two ways rather than two files. */
const THEMES: Record<
  CardTheme,
  { bg: string; text: string; muted: string; sub: string; iconBg: string; iconFg: string; baseline: string; logo: string }
> = {
  light: {
    bg: "#FFFFFF", text: "#202124", muted: "#9AA0A6", sub: "#5F6368",
    iconBg: "#F1F3F4", iconFg: "#3C4043", baseline: "#DADCE0",
    logo: "brightness(0)",
  },
  dark: {
    bg: "#101215", text: "#FFFFFF", muted: "#8B949E", sub: "#8B949E",
    iconBg: "#1E2228", iconFg: "#C9D1D9", baseline: "#2A2F36",
    logo: "brightness(0) invert(1)",
  },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/* Renders children at their native size, scaled to the width available.
   The forwarded ref is the un-transformed node — export that. */
export const ScaledMedia = forwardRef<
  HTMLDivElement,
  { nativeW?: number; nativeH?: number; children: ReactNode }
>(function ScaledMedia({ nativeW = DESIGN_W, nativeH = DESIGN_H, children }, ref) {
  const [scale, setScale] = useState(0.35);
  const wrapRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const update = () => {
        const w = node.offsetWidth;
        if (w > 0) setScale(w / nativeW);
      };
      update();
      const observer = new ResizeObserver(update);
      observer.observe(node);
    },
    [nativeW]
  );
  return (
    <div ref={wrapRef} style={{ width: "100%", position: "relative", height: nativeH * scale }}>
      <div style={{ position: "absolute", top: 0, left: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <div ref={ref} style={{ width: nativeW, height: nativeH }}>
          {children}
        </div>
      </div>
    </div>
  );
});

/* A picture slot: the creator's upload, or the prompt to add one. Sized by
   its parent — the whole frame, or one half of a split. */
export function PictureSlot({
  url,
  hint,
  onClick,
  width = DESIGN_W,
  height = DESIGN_H,
  busy = false,
}: {
  url?: string | null;
  hint: string;
  onClick?: () => void;
  width?: number;
  height?: number;
  busy?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        width,
        height,
        background: "#0a0a0a",
        cursor: onClick ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ color: "#71767b", fontSize: 40, fontFamily: FONT, textAlign: "center", padding: 40 }}>
          {busy ? "Uploading…" : hint}
        </span>
      )}
    </div>
  );
}

/* Left: the creator's picture. Right: whatever card is passed in. */
export function SplitMedia({
  photoUrl,
  hint,
  onUploadClick,
  busy,
  children,
}: {
  photoUrl?: string | null;
  hint: string;
  onUploadClick?: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ width: DESIGN_W, height: DESIGN_H, display: "flex", background: "#FFFFFF" }}>
      <PictureSlot url={photoUrl} hint={hint} onClick={onUploadClick} width={HALF_W} height={DESIGN_H} busy={busy} />
      {children}
    </div>
  );
}

/* The company price card — the panel's shared chart card.

   A port of CompanyChartCard in the panel's split-tweet-media.tsx as it
   stands now. Several of the panel's tweet tabs render this same card rather
   than drawing their own chart, so keeping it faithful keeps every one of
   them right at once.

   The layout reads top to bottom: the icon with the ticker beside it and the
   wordmark opposite, then the company name, the price, the change, the plot,
   and the footer. */
export function CompanyChartCard({
  companyName,
  heading,
  ticker,
  chart,
  logoUrl,
  entryIndex,
  entryPhotoUrl,
  width = HALF_W,
  height = DESIGN_H,
  iconSize = 124,
  theme = "light",
}: {
  companyName: string;
  /** Replaces the name line, and may carry newlines (the plot shrinks to fit). */
  heading?: string;
  ticker: string;
  chart: ThreadChart;
  logoUrl?: string | null;
  entryIndex?: number | null;
  entryPhotoUrl?: string | null;
  width?: number;
  height?: number;
  iconSize?: number;
  /** Light is the default; dark sits flush with X's dark timeline. */
  theme?: CardTheme;
}) {
  const { price, change_abs: changeAbs, change_pct: changePct, points } = chart;
  const t = THEMES[theme];
  // Both footer strings share one line. They fit side by side on a 1080 card
  // but not on an 800 half, so narrow cards step the type down rather than
  // wrap mid-date.
  const footFont = width >= 1000 ? 26 : 21;
  const down = changePct < 0;
  const color = down ? RED : GREEN;
  const gradId = useId();
  const markClipId = useId();

  const W = width - 112;
  // Everything but the plot measures 570px with a one-line name, and each
  // extra line adds 55 (48px type at 1.15). Reserve per actual line, or a
  // long name pushes the footer through the padding and off the card.
  // No shortening here: the panel's card trims "Inc / Corp / Class B" itself
  // because its data is raw, while this app is served a name the backend has
  // already shortened (services/threads.py short_company_name). Doing it
  // twice is how the two would drift.
  const headingText = heading ?? companyName;
  const CHROME_1_LINE = 570;
  const LINE = 55;
  const AVG_GLYPH = 26.4; // Geist 600 at 48px, measured in the panel
  const perLine = Math.max(8, Math.floor((width - 112) / AVG_GLYPH));
  const headingLines = Math.min(
    4,
    String(headingText || "")
      .split("\n")
      .reduce((total, seg) => total + Math.max(1, Math.ceil(seg.trim().length / perLine)), 0)
  );
  const H = Math.max(240, height - (CHROME_1_LINE + LINE * (headingLines - 1)));
  const pad = 22;
  const n = points.length;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const ER = 60;
  const STEM = 26; // dotted connector between the bubble and the point
  const HALO = ER + 6; // ring around the bubble
  const CLEAR = 16; // the halo stays this far off the curve
  const hasEntry = typeof entryIndex === "number" && entryIndex >= 0 && n > 1;
  const eIdx = hasEntry ? Math.min(Math.max(Math.round(entryIndex as number), 0), n - 1) : 0;
  // The bubble hangs above its point, so what it clears is not the entry price
  // but the highest price the curve reaches under the bubble's width.
  const stepX = n > 1 ? W / (n - 1) : W;
  const win = stepX > 0 ? Math.min(n, Math.ceil((HALO + CLEAR) / stepX)) : n;
  const lo = Math.max(0, eIdx - win);
  const hi = Math.min(n - 1, eIdx + win);
  let nearMax = points[eIdx];
  for (let i = lo; i <= hi; i++) nearMax = Math.max(nearMax, points[i]);
  // Headroom the plot gives up: only what THIS marker needs, so a buy under a
  // low stretch reserves nothing and the line gets the full height.
  const NEED = 2 * HALO + CLEAR;
  const nearRatio = hasEntry ? (nearMax - min) / range : 0; // 1 = top of range
  const topPad = !hasEntry
    ? pad
    : Math.min(
        NEED,
        Math.max(pad, nearRatio > 0 ? (NEED - (1 - nearRatio) * (H - pad)) / nearRatio : pad)
      );
  const xy = points.map((p, i) => {
    const x = n > 1 ? (i / (n - 1)) * W : 0;
    const y = topPad + (1 - (p - min) / range) * (H - topPad - pad);
    return [x, y] as const;
  });
  const polyline = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [endX, endY] = xy[xy.length - 1];
  const baselineY = xy[0][1];
  const enY = hasEntry ? xy[eIdx][1] : 0;
  const enX = hasEntry ? xy[eIdx][0] : 0;
  // The stem reads as a plumb line, so the bubble sits at the entry's x and
  // may spill into the card's padding rather than slant. Only an entry within
  // ~16px of an edge is nudged, and by at most that much.
  const SPILL = 50;
  const mX = hasEntry ? Math.min(Math.max(enX, HALO - SPILL), W - (HALO - SPILL)) : 0;
  let yNear = enY;
  for (let i = lo; i <= hi; i++) yNear = Math.min(yNear, xy[i][1]);
  const markCY = hasEntry ? Math.max(HALO, Math.min(enY - ER - STEM, yNear - HALO - CLEAR)) : 0;
  const areaPath =
    `M ${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)} ` +
    xy.slice(1).map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`).join(" ") +
    ` L ${endX.toFixed(1)},${H} L ${xy[0][0].toFixed(1)},${H} Z`;

  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div
      style={{
        width,
        height,
        background: t.bg,
        padding: 56,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT,
        flexShrink: 0,
      }}
    >
      {/* Title row: company icon + ticker (left), wordmark (right) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, minWidth: 0 }}>
          <div
            style={{
              width: iconSize,
              height: iconSize,
              borderRadius: 9999,
              overflow: "hidden",
              background: t.iconBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: Math.round(iconSize * 0.48),
              color: t.iconFg,
              flexShrink: 0,
            }}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              (ticker || "?").charAt(0).toUpperCase()
            )}
          </div>
          <div style={{ fontSize: 32, fontWeight: 600, color: t.muted, lineHeight: 1, whiteSpace: "nowrap" }}>
            {(ticker || "").toUpperCase()}
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/stalvian-logo.svg"
          alt="Stalvian"
          style={{ height: 44, filter: t.logo, flexShrink: 0 }}
        />
      </div>

      {/* Company name — its own line under the icon, left-aligned with it */}
      <div
        style={{
          marginTop: 64,
          fontSize: 48,
          fontWeight: 600,
          color: t.text,
          lineHeight: 1.15,
          whiteSpace: heading ? "pre-line" : "nowrap",
          overflow: heading ? "visible" : "hidden",
          textOverflow: heading ? "clip" : "ellipsis",
        }}
      >
        {headingText}
      </div>

      <div style={{ marginTop: 12, fontSize: 52, fontWeight: 600, color: t.text, lineHeight: 1 }}>
        ${fmt(price)}
      </div>

      <div style={{ marginTop: 14, fontSize: 30, fontWeight: 600, color, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 22 }}>{down ? "▼" : "▲"}</span>
        <span>
          ${fmt(changeAbs)} ({changePct >= 0 ? "+" : ""}
          {changePct.toFixed(2)}%)
        </span>
        <span style={{ color: t.muted, fontWeight: 500 }}>{chart.range_label}</span>
      </div>

      <div style={{ flex: 1, marginTop: 18, display: "flex", alignItems: "center" }}>
        <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            {hasEntry && entryPhotoUrl && (
              <clipPath id={markClipId}>
                <circle cx={mX} cy={markCY} r={ER} />
              </clipPath>
            )}
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
          <line x1={0} y1={baselineY} x2={W} y2={baselineY} stroke={t.baseline} strokeWidth={3} strokeDasharray="2 12" strokeLinecap="round" />
          <polyline points={polyline} fill="none" stroke={color} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
          {hasEntry && (
            <>
              {/* stem: bubble down to the exact point on the line */}
              <line x1={mX} y1={markCY + ER} x2={enX} y2={enY} stroke={color} strokeWidth={3} strokeDasharray="2 10" strokeLinecap="round" />
              <circle cx={enX} cy={enY} r={10} fill={color} />
              <circle cx={mX} cy={markCY} r={ER + 6} fill={t.bg} />
              {entryPhotoUrl ? (
                <>
                  <circle cx={mX} cy={markCY} r={ER + 3} fill={color} />
                  <image
                    href={entryPhotoUrl}
                    x={mX - ER}
                    y={markCY - ER}
                    width={ER * 2}
                    height={ER * 2}
                    clipPath={`url(#${markClipId})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                </>
              ) : (
                <circle cx={mX} cy={markCY} r={ER} fill={t.bg} stroke={color} strokeWidth={8} />
              )}
            </>
          )}
          <circle cx={endX} cy={endY} r={20} fill={color} opacity={0.18} />
          <circle cx={endX} cy={endY} r={9} fill={color} />
        </svg>
      </div>

      {/* Footer: the chart window (left) and the risk line (right), one line
          each so they share a baseline. */}
      <div style={{ marginTop: 18, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 20 }}>
        <div style={{ fontSize: footFont, fontWeight: 500, color: t.muted, whiteSpace: "nowrap" }}>
          From {fmtDate(chart.from_date)} to {fmtDate(chart.to_date)}
        </div>
        <p style={{ fontSize: footFont - 2, fontWeight: 400, color: t.sub, margin: 0, lineHeight: "130%", textAlign: "right", whiteSpace: "nowrap" }}>
          Investing involves risk of loss.
        </p>
      </div>
    </div>
  );
}

/* Macro tweet 2 — three columns, one company logo (+ $ticker) each. Each
   logo is its own upload slot. */
export function ThreeLogoCard({
  stocks,
  logos,
  onPick,
}: {
  stocks: ThreadStock[];
  logos: (string | undefined)[];
  onPick: (i: number) => void;
}) {
  return (
    <div style={{ width: DESIGN_W, height: DESIGN_H, display: "flex", background: INK, fontFamily: FONT }}>
      {[0, 1, 2].map((i) => {
        const s = stocks[i];
        return (
          <div
            key={i}
            onClick={() => onPick(i)}
            style={{
              flex: 1,
              borderRight: i < 2 ? "2px solid rgba(255,255,255,0.08)" : "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 44,
              cursor: "pointer",
              padding: 48,
            }}
          >
            <div
              style={{
                width: 320,
                height: 320,
                borderRadius: 32,
                overflow: "hidden",
                background: logos[i] ? "transparent" : "#11161f",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {logos[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logos[i]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ color: "#5A6472", fontSize: 28 }}>Upload logo</span>
              )}
            </div>
            {s?.ticker && <span style={{ fontSize: 76, fontWeight: 700, color: "#FFFFFF" }}>${s.ticker}</span>}
          </div>
        );
      })}
    </div>
  );
}

/* Macro tweet 3 — one column per smart-money buyer: face, name, return.
   Column count follows the number of buyers. */
export function InsiderFacesCard({
  buyers,
  photos,
  onPick,
}: {
  buyers: ThreadBuyer[];
  photos: (string | undefined)[];
  onPick: (i: number) => void;
}) {
  const n = Math.max(buyers.length, 1);
  const colW = DESIGN_W / n;
  const faceSize = Math.min(360, Math.max(180, colW - 80));
  const nameFont = n <= 3 ? 34 : n === 4 ? 28 : 24;
  return (
    <div style={{ width: DESIGN_W, height: DESIGN_H, display: "flex", background: INK, fontFamily: FONT }}>
      {buyers.map((b, i) => {
        const up = (b.return_pct ?? 0) >= 0;
        const ring = up ? GREEN : "#DC2626";
        const ret = b.return_pct === null ? "" : `${up ? "+" : "-"}${Math.abs(Math.round(b.return_pct))}%`;
        const sub = [ret, b.ticker ? `$${b.ticker}` : ""].filter(Boolean).join(" · ");
        return (
          <div
            key={i}
            onClick={() => onPick(i)}
            style={{
              flex: 1,
              borderRight: i < n - 1 ? "2px solid rgba(255,255,255,0.08)" : "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 28,
              cursor: "pointer",
              padding: 40,
              minWidth: 0,
            }}
          >
            <div
              style={{
                width: faceSize,
                height: faceSize,
                borderRadius: "50%",
                overflow: "hidden",
                background: photos[i] ? "transparent" : "#11161f",
                border: "5px solid #FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {photos[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photos[i]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ color: "#5A6472", fontSize: 24 }}>Upload face</span>
              )}
            </div>
            <span style={{ fontSize: nameFont, fontWeight: 700, color: "#FFFFFF", textAlign: "center", lineHeight: "115%", maxWidth: colW - 56 }}>
              {b.name}
            </span>
            {sub && <span style={{ fontSize: nameFont - 4, fontWeight: 600, color: ring, textAlign: "center" }}>{sub}</span>}
          </div>
        );
      })}
    </div>
  );
}

/* Big Buy tweet 1 — two uploads side by side, nothing generated. */
export function DualImage({
  left,
  right,
  onLeft,
  onRight,
  busy,
}: {
  left?: string | null;
  right?: string | null;
  onLeft?: () => void;
  onRight?: () => void;
  busy?: boolean;
}) {
  return (
    <div style={{ width: DESIGN_W, height: DESIGN_H, display: "flex", background: "#FFFFFF" }}>
      <PictureSlot url={left} hint="Click to upload left image" onClick={onLeft} width={HALF_W} height={DESIGN_H} busy={busy} />
      <PictureSlot url={right} hint="Click to upload right image" onClick={onRight} width={HALF_W} height={DESIGN_H} busy={busy} />
    </div>
  );
}

const fmtUsd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const fmtShares = (n?: number | null) => (typeof n === "number" && n > 0 ? Math.round(n).toLocaleString("en-US") : "—");

export const PHOTO_W = 600; // hedge-fund tweet 1: photo on the left, the table gets the rest
export const LIST_W = 1080; // the square dark list card
export const SQ_W = 1080; // square chart card (~1.2:1, not too tall on X)
export const SQ_H = 900;
export const WIDE_W = 1080; // big-buy tweet 2 chart card

/* Hedge Fund tweet 1, right side — "Top 10 Largest Positions". */
export function PositionsTableCard({
  holdings,
  width = DESIGN_W - PHOTO_W,
  height = DESIGN_H,
}: {
  holdings: ThreadHolding[];
  width?: number;
  height?: number;
}) {
  const rows = holdings.slice(0, 10);
  const head: React.CSSProperties = { fontSize: 18, fontWeight: 500, color: "#70757A", whiteSpace: "pre-line", lineHeight: "118%" };
  return (
    <div style={{ width, height, background: "#FFFFFF", padding: 48, boxSizing: "border-box", display: "flex", flexDirection: "column", fontFamily: FONT, flexShrink: 0 }}>
      <div style={{ fontSize: 36, fontWeight: 700, color: "#111418", marginBottom: 22 }}>Top 10 Largest Positions</div>
      <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 12, borderBottom: "2px solid #E4E7EB" }}>
        <span style={{ ...head, width: 56, flexShrink: 0 }}>Rank</span>
        <span style={{ ...head, flex: 1, minWidth: 0 }}>Issuer</span>
        <span style={{ ...head, width: 120, flexShrink: 0 }}>{"Class /\nType"}</span>
        <span style={{ ...head, width: 220, flexShrink: 0, textAlign: "right" }}>{"Reported Value\n(Notional)"}</span>
        <span style={{ ...head, width: 188, flexShrink: 0, textAlign: "right" }}>{"Share Count /\nPrincipal"}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA0A6", fontSize: 24 }}>
          Holdings populate from the 13F filing
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {rows.map((h, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", flex: 1, borderBottom: "1px solid #F0F2F4", fontSize: 23, color: "#202124" }}>
              <span style={{ width: 56, flexShrink: 0, color: "#5F6368", fontWeight: 500 }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 12 }}>
                {h.issuer.toUpperCase()}
              </span>
              <span style={{ width: 120, flexShrink: 0, color: "#3C4043" }}>{h.class_type}</span>
              <span style={{ width: 220, flexShrink: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUsd(h.value)}</span>
              <span style={{ width: 188, flexShrink: 0, textAlign: "right", color: "#3C4043", fontVariantNumeric: "tabular-nums" }}>{fmtShares(h.shares)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SERIF = "'Martina Plantijn', Georgia, serif";

/* Hedge Fund tweets 2/3 — the dark ranked list (Top Buys / Top Sells). Each
   row's icon is an upload slot. */
export function RankedListCard({
  title,
  rows,
  positive,
  icons,
  onPick,
}: {
  title: string;
  rows: RankedRow[];
  positive: boolean;
  icons: (string | undefined)[];
  onPick?: (i: number) => void;
}) {
  const amountColor = positive ? GREEN : "#DC2626";
  const list = rows.slice(0, 5);
  return (
    <div style={{ width: LIST_W, height: LIST_W, background: INK, padding: 64, boxSizing: "border-box", display: "flex", flexDirection: "column", fontFamily: FONT }}>
      <h1 style={{ fontFamily: SERIF, fontSize: 60, fontWeight: 400, color: "#FFFFFF", margin: 0, lineHeight: "110%" }}>{title}</h1>
      <div style={{ flex: 1, marginTop: 36, display: "flex", flexDirection: "column", gap: 20 }}>
        {list.map((r, i) => (
          <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", border: "2px solid rgba(255,255,255,0.16)", borderRadius: 12, padding: "0 32px" }}>
            <span style={{ fontSize: 40, fontWeight: 500, color: "#FFFFFF", width: 64, flexShrink: 0 }}>{i + 1}.</span>
            <div
              onClick={() => onPick?.(i)}
              style={{ width: 96, height: 96, borderRadius: 10, background: icons[i] ? "transparent" : "#1A2332", overflow: "hidden", flexShrink: 0, marginRight: 28, cursor: onPick ? "pointer" : "default" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {icons[i] && <img src={icons[i]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <span style={{ flex: 1, fontSize: 42, fontWeight: 600, color: "#FFFFFF", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              ${r.ticker}
            </span>
            <span style={{ fontSize: 42, fontWeight: 600, color: amountColor, flexShrink: 0 }}>{r.amount}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 28, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <p style={{ margin: 0, fontSize: 26, fontWeight: 400, color: "#FFFFFF", lineHeight: "128%" }}>
          Investing involves risk of loss.
          <br />
          This is not investment advice
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/stalvian-logo.svg" alt="Stalvian" style={{ height: 46, flexShrink: 0 }} />
      </div>
    </div>
  );
}

/* Insider Picks / Top Movers — the dark square chart card. With the marker
   it shows where the insider bought and their return since; without, a plain
   mover chart. */
export function SquareChartCard({
  headline,
  chart,
  personPhotoUrl,
  companyLogoUrl,
  insiderReturnPct = 0,
  showMarker = true,
  source,
  onPickPerson,
  onPickLogo,
}: {
  headline: string;
  chart: ThreadChart;
  personPhotoUrl?: string | null;
  companyLogoUrl?: string | null;
  insiderReturnPct?: number;
  showMarker?: boolean;
  source?: string | null;
  onPickPerson?: () => void;
  onPickLogo?: () => void;
}) {
  const clipId = useId();
  const lineHex = "#FFFFFF";
  const entryHex = GREEN;
  const closes = chart.points;
  const W = SQ_W - 128;
  const H = 410;
  const n = closes.length;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const ER = 52;
  const topBand = showMarker ? 2 * ER + 30 : 12;
  const CW = W - 155;
  const xy = closes.map((c, i) => {
    const x = (i / (n - 1)) * CW;
    const y = topBand + (1 - (c - min) / range) * (H - topBand - 12);
    return [x, y] as const;
  });
  const polyline = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [endX, endY] = xy[n - 1];
  const baselineY = xy[0][1];
  const eIdx = Math.min(Math.max(chart.entry_index ?? 0, 0), n - 1);
  const enY = xy[eIdx][1];
  const mX = Math.min(Math.max(xy[eIdx][0], ER + 6), CW - (ER + 6));
  const markCY = ER + 14;
  const insTxt = `${insiderReturnPct >= 0 ? "+" : ""}${insiderReturnPct.toFixed(1).replace(".", ",")}%`;
  const insBoxW = 22 + insTxt.length * 14;
  const insBoxX = mX + ER + 16;
  const endPct = chart.change_pct;
  const endTxt = `${endPct >= 0 ? "+" : ""}${endPct.toFixed(1).replace(".", ",")}%`;
  const endBoxW = 22 + endTxt.length * 14;
  // First-of-month ticks over the line width, thinned to >=150px apart.
  const ticks: { text: string; x: number }[] = [];
  const times = chart.times;
  if (times && times.length === n) {
    const firstTs = times[0];
    const lastTs = times[n - 1];
    const totalMs = lastTs - firstTs || 1;
    let d = new Date(Date.UTC(new Date(firstTs).getUTCFullYear(), new Date(firstTs).getUTCMonth(), 1));
    while (d.getTime() <= lastTs) {
      if (d.getTime() >= firstTs) {
        const x = ((d.getTime() - firstTs) / totalMs) * CW;
        if (x < CW - 20) {
          const tick = { text: `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`, x: Math.max(28, x) };
          if (!ticks.length || tick.x - ticks[ticks.length - 1].x >= 150) ticks.push(tick);
        }
      }
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    }
  }
  return (
    <div style={{ width: SQ_W, height: SQ_H, background: INK, padding: 64, boxSizing: "border-box", display: "flex", flexDirection: "column", fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
        <h1 style={{ fontFamily: SERIF, fontSize: 58, fontWeight: 400, color: "#FFFFFF", lineHeight: "112%", margin: 0, flex: 1, whiteSpace: "pre-line" }}>{headline}</h1>
        <div
          onClick={onPickLogo}
          style={{ width: 120, height: 120, borderRadius: 14, overflow: "hidden", background: companyLogoUrl ? "transparent" : "#1A2332", flexShrink: 0, cursor: onPickLogo ? "pointer" : "default" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {companyLogoUrl && <img src={companyLogoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
      </div>
      <div style={{ flex: 1, marginTop: 28, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <svg width={W} height={H + 56} style={{ display: "block", overflow: "visible" }}>
          <line x1={0} y1={baselineY} x2={CW} y2={baselineY} stroke="#FFFFFF" strokeWidth={3} strokeDasharray="0 14" strokeLinecap="round" opacity={0.5} />
          <polyline points={polyline} fill="none" stroke={lineHex} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
          {showMarker && (
            <>
              <line x1={mX} y1={markCY + ER} x2={mX} y2={enY - 10} stroke={entryHex} strokeWidth={5} strokeLinecap="round" />
              <polygon points={`${mX - 8},${enY - 12} ${mX + 8},${enY - 12} ${mX},${enY}`} fill={entryHex} />
              <g onClick={onPickPerson} style={{ cursor: onPickPerson ? "pointer" : "default" }}>
                {personPhotoUrl ? (
                  <>
                    <defs>
                      <clipPath id={clipId}>
                        <circle cx={mX} cy={markCY} r={ER} />
                      </clipPath>
                    </defs>
                    <circle cx={mX} cy={markCY} r={ER + 3} fill={entryHex} />
                    <image href={personPhotoUrl} x={mX - ER} y={markCY - ER} width={ER * 2} height={ER * 2} clipPath={`url(#${clipId})`} preserveAspectRatio="xMidYMid slice" />
                  </>
                ) : (
                  <>
                    <circle cx={mX} cy={markCY} r={ER} fill="#1A2332" stroke={entryHex} strokeWidth={4} />
                    <text x={mX} y={markCY + 7} textAnchor="middle" fontSize={22} fill="#5A6472" style={{ fontFamily: FONT }}>Photo</text>
                  </>
                )}
              </g>
              <polygon points={`${insBoxX - 2},${markCY} ${insBoxX + 11},${markCY - 10} ${insBoxX + 11},${markCY + 10}`} fill={entryHex} />
              <rect x={insBoxX + 10} y={markCY - 21} width={insBoxW} height={42} rx={6} fill={entryHex} />
              <text x={insBoxX + 10 + insBoxW / 2} y={markCY + 7} textAnchor="middle" fontSize={22} fontWeight={600} fill="#FFFFFF" style={{ fontFamily: FONT }}>{insTxt}</text>
            </>
          )}
          <circle cx={endX} cy={endY} r={6} fill={lineHex} />
          <rect x={endX + 14} y={endY - 21} width={endBoxW} height={42} rx={6} fill="#FFFFFF" />
          <text x={endX + 14 + endBoxW / 2} y={endY + 7} textAnchor="middle" fontSize={22} fontWeight={600} fill={INK} style={{ fontFamily: FONT }}>{endTxt}</text>
          <line x1={0} y1={H} x2={CW} y2={H} stroke="#FFFFFF" strokeWidth={2} opacity={0.4} />
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={t.x} y1={H} x2={t.x} y2={H + 14} stroke="#FFFFFF" strokeWidth={2} opacity={0.6} />
              <text x={t.x} y={H + 46} textAnchor="middle" fontSize={26} fill="#FFFFFF" opacity={0.85} style={{ fontFamily: FONT }}>{t.text}</text>
            </g>
          ))}
        </svg>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginTop: 12 }}>
        <div>
          {source && <p style={{ margin: 0, fontFamily: FONT, fontSize: 22, fontWeight: 400, color: GRAY }}>Source: {source}</p>}
          <p style={{ margin: "8px 0 0", fontFamily: FONT, fontSize: 26, fontWeight: 400, color: "#FFFFFF", lineHeight: "128%" }}>
            Investing involves risk of loss.
            <br />
            This is not investment advice
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/stalvian-logo.svg" alt="Stalvian" style={{ height: 46, flexShrink: 0 }} />
      </div>
    </div>
  );
}
