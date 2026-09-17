"use client";

/* ThreadCard — an X thread for a creator to post.

   The video ScriptCard is built around scenes to shoot; this is built around
   tweets to paste. Each tweet is its own block with its own copy button and a
   character count against X's limit, because a creator posts them one reply
   at a time and the count is the one thing that can stop a post going out. */

import { useState } from "react";
import { toast } from "sonner";
import type { StoryPayload, Tweet } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/format";
import { Badge, Button } from "@/components/ui";
import { ViralityMeter } from "@/components/script-card";

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

function tweetLength(text: string): number {
  return [...text].length;
}

/* Deep link that opens X's composer with tweet 1 filled in. The rest of the
   thread is posted as replies, which the intent URL cannot pre-fill. */
function postIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function ThreadCard({ story }: { story: StoryPayload }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const tweets = [...(story.tweets ?? [])].sort((a, b) => a.order - b.order);
  const sources = [...new Set((story.sources ?? []).map((s) => s.trim()).filter(Boolean))];
  const overLimit = tweets.some((t) => tweetLength(t.text) > TWEET_MAX_CHARS);

  return (
    <div className="dashed-card flex flex-col gap-5 bg-white p-6 lg:p-8">
      {/* Header — badges + timestamp left, virality meter right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {story.ticker && <Badge tone="ink">${story.ticker}</Badge>}
          <Badge>
            {tweets.length} tweet{tweets.length === 1 ? "" : "s"}
          </Badge>
          {story.language && <Badge>{story.language.toUpperCase()}</Badge>}
          <span className="text-[12px] leading-4 text-slate-400">
            {timeAgo(story.published_at || story.created_at)}
          </span>
        </div>
        {typeof story.virality_score === "number" && (
          <ViralityMeter score={story.virality_score} />
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <h3 className="display-xs max-w-[720px] text-ink">{story.title || story.headline}</h3>
        <Button
          kind="secondary"
          size="s"
          icon="ph-copy"
          onClick={() => copy(fullThreadText(tweets), "Thread")}
        >
          Copy
        </Button>
      </div>

      {/* The thread — one block per tweet, threaded down the left edge like
          X renders replies. */}
      <div className="flex flex-col">
        {tweets.map((tweet, i) => {
          const length = tweetLength(tweet.text);
          const over = length > TWEET_MAX_CHARS;
          const last = i === tweets.length - 1;
          return (
            <div key={tweet.order} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-medium text-white">
                  {i + 1}
                </div>
                {!last && <div className="w-px flex-1 bg-bone-200" />}
              </div>
              <div className={`flex min-w-0 flex-1 flex-col gap-2 ${last ? "" : "pb-6"}`}>
                <p className="whitespace-pre-line rounded-[8px] bg-cream p-5 text-[16px] leading-6 text-ink">
                  {tweet.text}
                </p>
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`text-[12px] leading-4 ${over ? "font-medium text-red-600" : "text-slate-400"}`}
                  >
                    {length}/{TWEET_MAX_CHARS}
                    {over && " · over the limit"}
                  </span>
                  <button
                    type="button"
                    onClick={() => copy(tweet.text, `Tweet ${i + 1}`)}
                    className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium leading-4 text-slate-500 hover:text-ink"
                  >
                    <i className="ph ph-copy text-[14px]" />
                    Copy tweet {i + 1}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {tweets.length === 0 && (
          <p className="text-[15px] leading-5 text-slate-500">
            This thread has no text yet — check back shortly.
          </p>
        )}
      </div>

      {overLimit && (
        <p className="text-[13px] leading-5 text-slate-500">
          One of these tweets runs past X&apos;s limit in this language — trim it before
          posting.
        </p>
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
        {tweets.length > 0 && (
          <Button size="s" icon="ph-copy" onClick={() => copy(fullThreadText(tweets), "Thread")}>
            Copy Thread
          </Button>
        )}
        {tweets.length > 0 && (
          <a href={postIntentUrl(tweets[0].text)} target="_blank" rel="noopener noreferrer">
            <Button kind="secondary" size="s" icon="ph-x-logo">
              Post on X
            </Button>
          </a>
        )}
        {sources.length > 0 && (
          <Button
            kind="secondary"
            size="s"
            icon={sourcesOpen ? "ph-caret-up" : "ph-file-text"}
            onClick={() => setSourcesOpen((v) => !v)}
          >
            {sourcesOpen ? "Hide Sources" : `Check Sources (${sources.length})`}
          </Button>
        )}
        <span className="ml-auto text-[12px] leading-4 text-slate-400">
          Generated {formatDate(story.created_at || story.published_at)}
        </span>
      </div>
    </div>
  );
}
