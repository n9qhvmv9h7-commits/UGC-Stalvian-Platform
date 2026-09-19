"use client";

/* TweetPreview — how a thread looks on X, before it is posted.

   A port of the Marketing Panel's tweet mock (frontend/src/components/tweets/
   tweet-preview.tsx) into this project's design system: the ink surface and
   its tints instead of raw black and #2f3336, Geist instead of an inline font
   stack, and Phosphor icons instead of lucide. The proportions, the header
   order and the engagement bar are the panel's, because the two apps are
   previewing the same post and should not disagree about what it looks like.

   The engagement counts the panel shows are deliberately left out. There they
   are set dressing on a design mock; here the same numbers would sit on a
   creator's own unposted draft, next to the real view counts that pay them. */

import type { ReactNode } from "react";

/* Links on ink. The brand blue is tuned for white and falls to ~2.6:1 against
   the ink surface, so cashtags would be barely legible — this is the same
   move the app already makes with red-500 on dark against red-600 on light. */
const LINK = "text-blue-400";

/** X's own compact age: 45m, 3h, 2d. */
export function compactAge(iso: string | null | undefined): string {
  if (!iso) return "";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/* Cashtags, hashtags and mentions are the only coloured tokens, matching X.

   Two departures from the panel's version, both about what X actually links.
   The tag must start with a LETTER, so a sum of money ("$1.2B") stays plain
   text instead of turning blue as if it were a ticker. And trailing
   punctuation is split off, so the far more common "$NOW:" colours the
   cashtag and leaves the colon alone — and so does a bracketed "($MU)". X
   does the same. */
const TAG = /^([^A-Za-z0-9_$#@]*)([$#@][A-Za-z][A-Za-z0-9_.]*?)([^A-Za-z0-9_]*)$/;

function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, li) => (
        <span key={li} className="block" style={{ minHeight: line ? undefined : "0.9em" }}>
          {line.split(/(\s+)/).map((token, ti) => {
            const match = TAG.exec(token);
            return match ? (
              <span key={ti}>
                {match[1]}
                <span className={LINK}>{match[2]}</span>
                {match[3]}
              </span>
            ) : (
              <span key={ti}>{token}</span>
            );
          })}
        </span>
      ))}
    </>
  );
}

function Stat({ icon }: { icon: string }) {
  return <i className={`ph ${icon} text-[18px] text-slate-400`} />;
}

export function TweetPreview({
  name = "Stalvian",
  handle = "@stalvian",
  age,
  text,
  media,
}: {
  name?: string;
  handle?: string;
  /** Compact age shown after the handle, X style. */
  age?: string;
  text: string;
  /** The image inside the tweet. Omit for a tweet with no media. */
  media?: ReactNode;
}) {
  return (
    <div className="w-full max-w-[598px] rounded-[16px] border border-ink-500 bg-ink px-4 py-3 leading-[1.3] text-white">
      <div className="flex gap-3">
        {/* Avatar — the globe, cropped out of the left of the wordmark. */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/stalvian-logo.svg"
            alt=""
            className="h-[62%] w-[62%] object-cover object-left"
          />
        </div>

        <div className="min-w-0 flex-1">
          {/* Header */}
          <div className="flex items-center gap-1">
            <span className="font-bold text-white">{name}</span>
            <i className={`ph-fill ph-seal-check text-[17px] ${LINK}`} aria-label="Verified" />
            <span className="text-slate-400">{handle}</span>
            {age && (
              <>
                <span className="text-slate-400">·</span>
                <span className="text-slate-400">{age}</span>
              </>
            )}
            <i className="ph ph-x-logo ml-auto text-[20px] text-white" aria-label="X" />
          </div>

          {/* Body */}
          <div className="mt-1 whitespace-pre-wrap text-[15px] text-white">
            <RichText text={text} />
          </div>

          {/* Media */}
          {media !== undefined && media !== null && (
            <div className="mt-3 overflow-hidden rounded-[16px] border border-ink-500">{media}</div>
          )}

          {/* Engagement bar — the shape of X's, without invented numbers. */}
          <div className="mt-3 flex max-w-[425px] items-center justify-between">
            <Stat icon="ph-chat-circle" />
            <Stat icon="ph-repeat" />
            <Stat icon="ph-heart" />
            <Stat icon="ph-chart-bar" />
            <div className="flex items-center gap-4">
              <Stat icon="ph-bookmark-simple" />
              <Stat icon="ph-export" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
