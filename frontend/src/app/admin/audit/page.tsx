"use client";

/* Admin › Audit — every admin mutation, newest first. Who did what, when. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAuditLog, type AuditEntry } from "@/lib/api";
import { formatEuros, formatViews, timeAgo } from "@/lib/format";
import { Badge, Button, EmptyState, Spinner } from "@/components/ui";

const LIMIT = 50;

const ACTION_LABELS: Record<string, string> = {
  "creator.invite": "Invited creator",
  "creator.review": "Reviewed creator",
  "video.review": "Reviewed video",
  "payout.record": "Recorded payout",
};

function summarize(entry: AuditEntry): string {
  const d = entry.detail as Record<string, unknown>;
  const parts: string[] = [];
  if (entry.action === "creator.invite") {
    parts.push(String(d.email ?? ""));
  }
  if (typeof d.from === "string" && typeof d.to === "string") {
    parts.push(`status ${d.from} → ${d.to}`);
  }
  if (typeof d.from_status === "string" && typeof d.to_status === "string") {
    parts.push(`status ${d.from_status} → ${d.to_status}`);
  }
  if (typeof d.views_from === "number" && typeof d.views_to === "number") {
    parts.push(`views ${formatViews(d.views_from)} → ${formatViews(d.views_to)}`);
  }
  if (typeof d.amount_cents === "number") {
    parts.push(`${formatEuros(d.amount_cents)} to creator #${d.creator_id}`);
  }
  const strike = d.strike as { strikes?: number; creator_status?: string } | undefined;
  if (strike?.strikes) {
    parts.push(
      `strike ${strike.strikes}${strike.creator_status === "terminated" ? " — terminated" : ""}`
    );
  }
  if (typeof d.note === "string" && d.note) {
    parts.push(`note: "${d.note}"`);
  }
  return parts.join(" · ");
}

function actionTone(action: string): "positive" | "ink" | "neutral" {
  if (action.startsWith("payout")) return "positive";
  if (action.startsWith("creator")) return "ink";
  return "neutral";
}

export default function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-audit", page],
    queryFn: () => fetchAuditLog(page, LIMIT),
    placeholderData: (prev) => prev,
  });

  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="display-md text-ink">Audit Trail</h1>
        <p className="max-w-[560px] text-[16px] leading-6 text-slate-500">
          Every admin action, recorded with the change itself — approvals, view counts,
          strikes, and payments.
        </p>
      </div>

      {isLoading && !data ? (
        <Spinner label="Loading audit trail…" />
      ) : items.length === 0 && page === 1 ? (
        <EmptyState
          icon="ph-scroll"
          title="Nothing logged yet"
          body="Admin actions — invites, reviews, view counts, payouts — appear here as they happen."
        />
      ) : (
        <div className="dashed-card flex flex-col divide-y divide-bone-200 p-6">
          {items.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center gap-3 py-3">
              <Badge tone={actionTone(entry.action)}>
                {ACTION_LABELS[entry.action] ?? entry.action}
              </Badge>
              <span className="text-[14px] leading-5 text-ink">
                <span className="font-medium">{entry.admin.name}</span>
                {entry.entity_id != null && (
                  <span className="text-slate-400">
                    {" "}
                    · {entry.entity} #{entry.entity_id}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-slate-500">
                {summarize(entry)}
              </span>
              <span className="shrink-0 text-[12px] leading-4 text-slate-400">
                {timeAgo(entry.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}

      {(page > 1 || items.length === LIMIT) && (
        <div className="flex items-center gap-2 self-center">
          <Button
            kind="secondary"
            size="s"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Newer
          </Button>
          <span className="text-[13px] leading-4 text-slate-400">Page {page}</span>
          <Button
            kind="secondary"
            size="s"
            disabled={items.length < LIMIT}
            onClick={() => setPage((p) => p + 1)}
          >
            Older
          </Button>
        </div>
      )}
    </div>
  );
}
