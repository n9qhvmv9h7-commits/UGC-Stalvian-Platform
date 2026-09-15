"use client";

/* ScriptCard — renders a story/script for a creator to shoot from.
   Dashed editorial card per the brand: header with virality meter, cream HOOK
   panel with selectable options, numbered SCENES, ink CALL TO ACTION panel. */

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Scene, StoryPayload } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/format";
import { Badge, Button } from "@/components/ui";

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text);
  toast.success(`${what} copied`);
}

export function fullScriptText(story: StoryPayload): string {
  const parts: string[] = [];
  if (story.title) parts.push(story.title.toUpperCase());
  if (story.hook) parts.push(`HOOK: ${story.hook}`);
  if (story.scenes?.length) {
    story.scenes.forEach((scene, i) => {
      const bits = [
        scene.narration ? `Narration: ${scene.narration}` : null,
        scene.visual ? `Visual: ${scene.visual}` : null,
        scene.overlay ? `Overlay: ${scene.overlay}` : null,
      ].filter(Boolean);
      parts.push(`SCENE ${i + 1}\n${bits.join("\n")}`);
    });
  } else if (story.script_body) {
    parts.push(story.script_body);
  }
  if (story.call_to_action) parts.push(`CTA: ${story.call_to_action}`);
  return parts.join("\n\n");
}

function sceneDuration(scene: Scene): string | null {
  const raw = scene.duration ?? scene.duration_seconds ?? scene.seconds;
  if (typeof raw === "number") return `${raw}s`;
  if (typeof raw === "string" && raw) return raw;
  return null;
}

function SectionLabel({ tone = "light", children }: { tone?: "light" | "dark"; children: React.ReactNode }) {
  return (
    <span
      className={`text-[12px] font-bold uppercase leading-4 tracking-[0.08em] ${
        tone === "dark" ? "text-white/50" : "text-slate-500"
      }`}
    >
      {children}
    </span>
  );
}

function ViralityMeter({ score }: { score: number }) {
  // 8+ is a strong script — show it in brand green; below that, gold.
  const strong = score >= 8;
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[12px] leading-4 text-slate-400">Virality</span>
      <div className="flex gap-[3px]">
        {Array.from({ length: 10 }).map((_, i) => (
          <span
            key={i}
            className={`h-[12px] w-[5px] rounded-[1px] ${
              i < score ? (strong ? "bg-green-600" : "bg-gold") : "bg-bone-200"
            }`}
          />
        ))}
      </div>
      <span className={`text-[13px] font-medium leading-4 ${strong ? "text-green-600" : "text-ink"}`}>
        {score}/10
      </span>
    </div>
  );
}

export function ScriptCard({
  story,
  footer,
  defaultOpen = false,
}: {
  story: StoryPayload;
  footer?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [hookIdx, setHookIdx] = useState(0);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  // The panel re-parses these out of the generation prompt, so blanks and
  // duplicates both turn up; a creator should see each filing once.
  const sources = [...new Set((story.sources ?? []).map((s) => s.trim()).filter(Boolean))];

  const meta: string[] = [];
  if (story.album_name) meta.push(story.album_name);
  if (story.angle_label) meta.push(story.angle_label);

  // Option A is the main hook; alternatives follow (deduped — the panel often
  // repeats the main hook as the first alternative).
  const hookOptions = story.hook
    ? [story.hook, ...(story.alternative_hooks || [])].filter(
        (h, i, all) => all.indexOf(h) === i
      )
    : [];
  // Clamp: a re-synced edit can shrink the options under a selected index.
  const safeHookIdx = Math.min(hookIdx, Math.max(hookOptions.length - 1, 0));
  const selectedHook = hookOptions[safeHookIdx];

  const hasBody =
    (story.scenes && story.scenes.length > 0) ||
    !!story.script_body ||
    !!story.company_description ||
    !!story.caption;

  return (
    <div className="dashed-card flex flex-col gap-5 bg-white p-6 lg:p-8">
      {/* Header — badges + timestamp left, virality meter right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {story.ticker && <Badge tone="ink">${story.ticker}</Badge>}
          {typeof story.pct_change === "number" && (
            <Badge tone={story.pct_change >= 0 ? "positive" : "warn"}>
              {story.pct_change >= 0 ? "+" : ""}
              {story.pct_change.toLocaleString("de-DE", { maximumFractionDigits: 1 })}% · 30d
            </Badge>
          )}
          {meta.map((m) => (
            <Badge key={m}>{m}</Badge>
          ))}
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
          onClick={() => copy(fullScriptText(story), "Script")}
        >
          Copy
        </Button>
      </div>

      {/* HOOK — cream panel with selectable options */}
      {hookOptions.length > 0 && (
        <div className="flex flex-col gap-3 rounded-[8px] bg-cream p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionLabel>Hook</SectionLabel>
            {hookOptions.length > 1 && (
              <div className="flex gap-1 rounded-full bg-white p-1">
                {hookOptions.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setHookIdx(i)}
                    className={`cursor-pointer rounded-full px-3 py-1 text-[12px] font-medium leading-4 ${
                      safeHookIdx === i ? "bg-ink text-white" : "text-slate-500 hover:text-ink"
                    }`}
                  >
                    Option {String.fromCharCode(65 + i)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-[17px] leading-6 text-ink">&ldquo;{selectedHook}&rdquo;</p>
        </div>
      )}
      {hookOptions.length === 0 && story.summary && (
        <p className="text-[16px] leading-6 text-slate-500">{story.summary}</p>
      )}

      {/* Collapse / expand — centered, like the panel */}
      {hasBody && (
        <button
          onClick={() => setOpen(!open)}
          className="flex cursor-pointer items-center gap-2 self-center text-[13px] font-medium leading-4 text-slate-500 transition-colors hover:text-ink"
        >
          <i className={`ph ${open ? "ph-caret-up" : "ph-caret-down"} text-[14px]`} />
          {open ? "Collapse" : "Expand script"}
        </button>
      )}

      {open && (
        <div className="flex flex-col gap-6">
          {story.scenes && story.scenes.length > 0 && (
            <div className="flex flex-col gap-3">
              <SectionLabel>Scenes</SectionLabel>
              <div className="flex flex-col gap-5">
                {story.scenes.map((scene, i) => {
                  const duration = sceneDuration(scene);
                  return (
                    <div key={i} className="flex gap-4">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-medium text-white">
                        {i + 1}
                      </div>
                      <div className="flex min-w-0 flex-col gap-1">
                        {(duration || scene.overlay) && (
                          <div className="flex flex-wrap items-center gap-2">
                            {duration && (
                              <span className="rounded-full bg-bone-100 px-2 py-0.5 text-[12px] font-medium leading-4 text-slate-500">
                                {duration}
                              </span>
                            )}
                            {scene.overlay && (
                              <span className="text-[12px] leading-4 text-slate-400">
                                [{scene.overlay}]
                              </span>
                            )}
                          </div>
                        )}
                        {scene.narration && (
                          <p className="text-[16px] leading-6 text-ink">{scene.narration}</p>
                        )}
                        {scene.visual && (
                          <p className="text-[14px] leading-5 text-slate-500">
                            Visual: {scene.visual}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(!story.scenes || story.scenes.length === 0) && story.script_body && (
            <p className="whitespace-pre-line text-[15px] leading-6 text-ink">{story.script_body}</p>
          )}

          {(!story.scenes || story.scenes.length === 0) &&
            !story.script_body &&
            (story.company_description || story.caption) && (
              <div className="flex flex-col gap-3 text-[15px] leading-6 text-ink">
                {story.headline && story.title !== story.headline && (
                  <p className="font-medium">{story.headline}</p>
                )}
                {story.company_description && <p>{story.company_description}</p>}
                {story.summary && <p>{story.summary}</p>}
                {story.caption && (
                  <p className="whitespace-pre-line text-slate-500">{story.caption}</p>
                )}
              </div>
            )}

          {/* CALL TO ACTION — ink panel */}
          {story.call_to_action && (
            <div className="flex flex-col gap-2 rounded-[8px] bg-ink p-5">
              <SectionLabel tone="dark">Call to Action</SectionLabel>
              <p className="text-[16px] leading-6 text-white">
                &ldquo;{story.call_to_action}&rdquo;
              </p>
            </div>
          )}

          {/* Every claim in these scripts traces back to a disclosure. A creator
              about to say it on camera should be able to see the filing first —
              and be able to show it if anyone asks. */}
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
            <Button size="s" icon="ph-copy" onClick={() => copy(fullScriptText(story), "Script")}>
              Copy Script
            </Button>
            {selectedHook && (
              <Button kind="secondary" size="s" onClick={() => copy(selectedHook, "Hook")}>
                Copy Hook
              </Button>
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
            <div className="ml-auto flex items-center gap-4">
              <span className="text-[12px] leading-4 text-slate-400">
                Generated {formatDate(story.created_at || story.published_at)}
              </span>
              <Link href={`/my-videos?story=${story.id}`}>
                <Button kind="secondary" size="s" icon="ph-video-camera">
                  Submit Your Video
                </Button>
              </Link>
              {footer}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
