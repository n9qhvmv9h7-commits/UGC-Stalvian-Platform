"use client";

/* Admin › Creators — invite-only roster with per-creator performance metrics.
   Sort by views/earned/balance = the leaderboard. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createCreator,
  fetchApplications,
  fetchCreatorMetrics,
  reviewCreator,
  type AccountType,
  type CreatorApplication,
  type CreatorMetrics,
} from "@/lib/api";
import { formatDate, formatEuros, formatViews, LANGUAGES, PLATFORM_ICONS } from "@/lib/format";
import { Badge, Button, EmptyState, Field, SelectField, Spinner } from "@/components/ui";
import { BarList } from "@/components/bar-list";
import { Modal } from "@/components/modal";

const TABS = [
  { key: "approved", label: "Active" },
  { key: "terminated", label: "Terminated" },
  { key: "", label: "All" },
];

const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "views", label: "Most views" },
  { key: "earned", label: "Most earned" },
  { key: "balance", label: "Highest balance" },
] as const;

function InviteModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<{
    email: string;
    name: string;
    language: string;
    account_type: AccountType;
  }>({ email: "", name: "", language: "en", account_type: "video" });
  const [issued, setIssued] = useState<{ email: string; password: string; code: string | null } | null>(null);

  const invite = useMutation({
    mutationFn: () =>
      createCreator({
        email: form.email.trim(),
        name: form.name.trim() || undefined,
        language: form.language,
        account_type: form.account_type,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-creators"] });
      queryClient.invalidateQueries({ queryKey: ["creator-metrics"] });
      if (result.password)
        setIssued({
          email: result.creator.email,
          password: result.password,
          code: result.creator.referral_code,
        });
      toast.success(`${result.creator.email} added`);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Could not add the creator");
    },
  });

  return (
    <Modal open onClose={onClose} title="Add a creator">
      {issued ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 rounded-[8px] bg-cream p-5">
            <div className="flex items-center gap-2">
              <i className="ph ph-key text-[20px] text-ink" />
              <span className="text-[14px] leading-5 text-ink">
                One-time password for <span className="font-medium">{issued.email}</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <code className="rounded-[4px] bg-white px-3 py-2 text-[16px] text-ink">
                {issued.password}
              </code>
              <Button
                kind="secondary"
                size="s"
                onClick={() => {
                  navigator.clipboard.writeText(issued.password);
                  toast.success("Password copied");
                }}
              >
                Copy
              </Button>
            </div>
            <p className="text-[12px] leading-4 text-slate-500">
              Shown only once — copy it now and send it to the creator securely. They can
              change it in Settings.
            </p>
          </div>
          {issued.code && (
            <p className="text-[14px] leading-5 text-slate-500">
              Their referral code is{" "}
              <code className="rounded-[4px] bg-bone-100 px-2 py-1 text-[14px] text-ink">
                {issued.code}
              </code>{" "}
              — it&apos;s on their dashboard, no need to send it.
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={onClose}>Done</Button>
            <Button
              kind="secondary"
              onClick={() => {
                setIssued(null);
                setForm({ email: "", name: "", language: "en", account_type: "video" });
              }}
            >
              Add Another
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (form.email.trim()) invite.mutate();
          }}
          className="flex flex-col gap-5"
        >
          <p className="text-[14px] leading-5 text-slate-500">
            Access is invite-only. A one-time password is generated for you to share with
            the creator.
          </p>
          <Field
            label="Email"
            type="email"
            placeholder="creator@example.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <Field
            label="Name (optional)"
            placeholder="Their name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {/* Decides the creator's whole surface — video creators get Album
              Stories and Daily Scripts, tweet creators get the X equivalents.
              An admin can change it later, but a creator cannot. */}
          <SelectField
            label="Creates"
            value={form.account_type}
            onChange={(e) =>
              setForm({ ...form, account_type: e.target.value as AccountType })
            }
          >
            <option value="video">Videos — TikTok, Instagram, YouTube</option>
            <option value="tweets">Tweets — X threads</option>
          </SelectField>
          <SelectField
            label="Language"
            value={form.language}
            onChange={(e) => setForm({ ...form, language: e.target.value })}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </SelectField>
          <div className="flex gap-2">
            <Button type="submit" disabled={invite.isPending || !form.email.trim()}>
              {invite.isPending ? "Adding…" : "Add Creator"}
            </Button>
            <Button kind="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function MetricsStrip({ metrics }: { metrics: CreatorMetrics | undefined }) {
  if (!metrics) return null;
  const cells = [
    { label: "Videos", value: `${metrics.verified_videos}/${metrics.videos}` },
    { label: "Eligible views", value: formatViews(metrics.eligible_views) },
    { label: "Total views", value: formatViews(metrics.total_views) },
    { label: "From views", value: formatEuros(metrics.views_earned_cents) },
    {
      label: "From client fees",
      value: `${formatEuros(metrics.commission_cents)}${
        metrics.referred_clients > 0 ? ` · ${metrics.referred_clients} client${metrics.referred_clients === 1 ? "" : "s"}` : ""
      }`,
    },
    { label: "Earned", value: formatEuros(metrics.earned_cents) },
    { label: "Balance", value: formatEuros(metrics.balance_cents) },
  ];
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-bone-200 pt-3">
      {cells.map((c) => (
        <div key={c.label} className="flex flex-col">
          <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-slate-400">
            {c.label}
          </span>
          <span className="text-[15px] font-medium leading-5 text-ink">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

function CreatorCard({
  creator,
  metrics,
}: {
  creator: CreatorApplication;
  metrics: CreatorMetrics | undefined;
}) {
  const queryClient = useQueryClient();
  const review = useMutation({
    mutationFn: (body: { status: string; review_note?: string }) =>
      reviewCreator(creator.id, body),
    onSuccess: (_data, body) => {
      toast.success(`${creator.name} ${body.status === "approved" ? "reinstated" : body.status}`);
      queryClient.invalidateQueries({ queryKey: ["admin-creators"] });
    },
    onError: () => toast.error("Update failed"),
  });

  const terminate = () => {
    const note = window.prompt(
      "Optional note shown to the creator on their access screen:",
      creator.review_note || ""
    );
    if (note === null) return; // cancelled
    review.mutate({ status: "terminated", review_note: note.slice(0, 255) });
  };

  const language =
    LANGUAGES.find((l) => l.code === creator.language)?.label ?? creator.language.toUpperCase();

  return (
    <div className="dashed-card flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="display-xs text-ink">{creator.name}</div>
          <div className="mt-1 text-[14px] leading-5 text-slate-500">
            {creator.email} · {language}
            {creator.country ? ` · ${creator.country}` : ""} · added{" "}
            {formatDate(creator.created_at)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {creator.strikes > 0 && (
            <Badge tone="warn">
              {creator.strikes} strike{creator.strikes > 1 ? "s" : ""}
            </Badge>
          )}
          {creator.is_admin && <Badge tone="ink">Admin</Badge>}
          <Badge
            tone={
              creator.status === "approved"
                ? "positive"
                : creator.status === "terminated"
                  ? "warn"
                  : "neutral"
            }
          >
            {creator.status === "approved" ? "active" : creator.status}
          </Badge>
          {/* Only flag tweet accounts — video is the default and the
              overwhelming majority, so badging it would be noise. */}
          {creator.account_type === "tweets" && <Badge tone="ink">X / tweets</Badge>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {creator.referral_code && (
          <button
            type="button"
            title="Copy referral code"
            onClick={() => {
              navigator.clipboard.writeText(creator.referral_code!);
              toast.success("Code copied");
            }}
            className="inline-flex cursor-pointer items-center gap-2 rounded-[8px] border border-dashed border-ink bg-white px-3 py-2 text-[14px] font-medium leading-5 tracking-[0.04em] text-ink hover:bg-bone-100"
          >
            <i className="ph ph-handshake text-[18px]" />
            {creator.referral_code}
            <i className="ph ph-copy text-[14px] text-slate-500" />
          </button>
        )}
        {creator.socials.length > 0 &&
          creator.socials.map((s) => (
            <a
              key={s.platform}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-[8px] bg-bone-100 px-3 py-2 text-[14px] font-medium leading-5 text-ink hover:bg-bone-200"
            >
              <i className={`ph ${PLATFORM_ICONS[s.platform] ?? "ph-link"} text-[18px]`} />
              @{s.handle}
              <i className="ph ph-arrow-up-right text-[14px] text-slate-500" />
            </a>
          ))}
      </div>

      <MetricsStrip metrics={metrics} />

      {creator.review_note && (
        <p className="text-[14px] leading-5 text-slate-500">Note: {creator.review_note}</p>
      )}

      {!creator.is_admin && (
        <div className="flex gap-2">
          {creator.status === "approved" ? (
            <Button size="m" kind="secondary" onClick={terminate} disabled={review.isPending}>
              Revoke Access
            </Button>
          ) : (
            <Button
              size="m"
              onClick={() => review.mutate({ status: "approved", review_note: "" })}
              disabled={review.isPending}
            >
              Reinstate
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminCreatorsPage() {
  const [tab, setTab] = useState("approved");
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("newest");
  const [inviteOpen, setInviteOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-creators", tab],
    queryFn: () => fetchApplications(tab),
  });
  const { data: metricsData } = useQuery({
    queryKey: ["creator-metrics"],
    queryFn: fetchCreatorMetrics,
  });

  const metricsById = useMemo(() => {
    const map = new Map<number, CreatorMetrics>();
    for (const m of metricsData?.items ?? []) map.set(m.creator_id, m);
    return map;
  }, [metricsData]);

  // Names for the leaderboard come from the full roster, independent of the
  // active status tab (shares the react-query cache with the "All" tab).
  const { data: allCreators } = useQuery({
    queryKey: ["admin-creators", ""],
    queryFn: () => fetchApplications(""),
  });

  const items = useMemo(() => {
    const rows = [...(data?.items ?? [])];
    const metric = (c: CreatorApplication) => metricsById.get(c.id);
    if (sort === "views")
      rows.sort((a, b) => (metric(b)?.eligible_views ?? 0) - (metric(a)?.eligible_views ?? 0));
    else if (sort === "earned")
      rows.sort((a, b) => (metric(b)?.earned_cents ?? 0) - (metric(a)?.earned_cents ?? 0));
    else if (sort === "balance")
      rows.sort((a, b) => (metric(b)?.balance_cents ?? 0) - (metric(a)?.balance_cents ?? 0));
    return rows;
  }, [data, sort, metricsById]);

  const leaderboard = useMemo(() => {
    const names = new Map((allCreators?.items ?? []).map((c) => [c.id, c.name]));
    return (metricsData?.items ?? [])
      .filter((m) => m.eligible_views > 0 || m.earned_cents > 0)
      .sort((a, b) => b.eligible_views - a.eligible_views)
      .slice(0, 10)
      .map((m, i) => ({
        label: `${i + 1}. ${names.get(m.creator_id) ?? `Creator #${m.creator_id}`}`,
        value: m.eligible_views,
        sub: formatEuros(m.earned_cents),
        tone: (i === 0 ? "green" : "ink") as "green" | "ink",
      }));
  }, [metricsData, allCreators]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="display-md text-ink">Creators</h1>
          <p className="max-w-[560px] text-[16px] leading-6 text-slate-500">
            Everyone with access to the creator program — with their numbers. Sort by views
            or earnings for the leaderboard.
          </p>
        </div>
        <Button icon="ph-plus" size="m" onClick={() => setInviteOpen(true)}>
          Add Creator
        </Button>
      </div>

      {leaderboard.length > 0 && (
        <div className="dashed-card flex flex-col gap-5 p-6 lg:p-8">
          <div className="flex items-baseline justify-between">
            <h2 className="display-xs text-ink">Leaderboard</h2>
            <span className="text-[12px] leading-4 text-slate-400">
              eligible views · earned all-time
            </span>
          </div>
          <BarList rows={leaderboard} labelWidth="w-44" />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`cursor-pointer rounded-full px-4 py-2 text-[13px] font-medium leading-4 ${
                tab === t.key ? "bg-ink text-white" : "text-slate-500 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <SelectField
          value={sort}
          onChange={(e) => setSort(e.target.value as (typeof SORTS)[number]["key"])}
          className="w-[220px]"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              Sort: {s.label}
            </option>
          ))}
        </SelectField>
      </div>

      {isLoading ? (
        <Spinner label="Loading creators…" />
      ) : items.length === 0 ? (
        <EmptyState icon="ph-tray" title="No creators here" />
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((creator) => (
            <CreatorCard
              key={creator.id}
              creator={creator}
              metrics={metricsById.get(creator.id)}
            />
          ))}
        </div>
      )}

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} />}
    </div>
  );
}
