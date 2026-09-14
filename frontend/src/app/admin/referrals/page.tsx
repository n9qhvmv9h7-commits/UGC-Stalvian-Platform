"use client";

/* Admin › Referrals — every creator's code and client-fee numbers, the
   client roster, and the fee ledger. The Stalvian product reports clients
   and fees automatically over the referral API; the two modals here are the
   manual path (before the integration is live, or to correct a record). */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  adminAttributeClient,
  adminRecordFee,
  adminRegenerateCode,
  adminSetClientStatus,
  fetchAdminReferrals,
  type AdminReferrals,
} from "@/lib/api";
import { formatDate, formatEuros } from "@/lib/format";
import { Badge, Button, EmptyState, Field, SelectField, Spinner, StatCard } from "@/components/ui";
import { Modal } from "@/components/modal";

type Creators = AdminReferrals["creators"];
type Clients = AdminReferrals["clients"];

function errorDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of ["admin-referrals", "admin-payouts", "admin-overview", "creator-metrics"]) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

function AttributeClientModal({
  creators,
  preselect,
  onClose,
}: {
  creators: Creators;
  preselect: number | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    creator_id: String(preselect ?? creators[0]?.creator_id ?? ""),
    client_ref: "",
    label: "",
  });
  const attribute = useMutation({
    mutationFn: () =>
      adminAttributeClient({
        creator_id: Number(form.creator_id),
        client_ref: form.client_ref.trim(),
        label: form.label.trim() || undefined,
      }),
    onSuccess: (result) => {
      invalidateAll(queryClient);
      toast.success(result.created ? "Client attributed" : "Client was already attributed to this creator");
      onClose();
    },
    onError: (err) => toast.error(errorDetail(err, "Could not attribute the client")),
  });

  return (
    <Modal open onClose={onClose} title="Attribute a client">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.client_ref.trim() && form.creator_id) attribute.mutate();
        }}
        className="flex flex-col gap-5"
      >
        <p className="text-[14px] leading-5 text-slate-500">
          Link a Stalvian client to the creator whose code they used. The client reference
          is the product&apos;s own id for that account — it is what fees are reported against.
        </p>
        <SelectField
          label="Creator"
          value={form.creator_id}
          onChange={(e) => setForm({ ...form, creator_id: e.target.value })}
        >
          {creators.map((c) => (
            <option key={c.creator_id} value={c.creator_id}>
              {c.name} · {c.code ?? "no code"}
            </option>
          ))}
        </SelectField>
        <Field
          label="Client reference"
          placeholder="cust_8f3a…"
          value={form.client_ref}
          onChange={(e) => setForm({ ...form, client_ref: e.target.value })}
          required
        />
        <Field
          label="Label shown to the creator (optional)"
          placeholder="m***@gmail.com"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={attribute.isPending || !form.client_ref.trim()}>
            {attribute.isPending ? "Saving…" : "Attribute Client"}
          </Button>
          <Button kind="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RecordFeeModal({
  clients,
  commissionPct,
  preselect,
  onClose,
}: {
  clients: Clients;
  commissionPct: number;
  preselect: number | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    client_id: String(preselect ?? clients[0]?.id ?? ""),
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    note: "",
  });
  const cents = Math.round(parseFloat(form.amount.replace(",", ".")) * 100);
  const valid = Number.isFinite(cents) && cents > 0 && !!form.client_id;
  const share = valid ? Math.floor((cents * commissionPct * 100 + 5000) / 10000) : 0;

  const record = useMutation({
    mutationFn: () =>
      adminRecordFee({
        client_id: Number(form.client_id),
        fee_cents: cents,
        occurred_at: form.date ? `${form.date}T12:00:00Z` : undefined,
        note: form.note.trim() || undefined,
      }),
    onSuccess: (result) => {
      invalidateAll(queryClient);
      toast.success(`Fee recorded — ${formatEuros(result.commission_cents)} to the creator`);
      onClose();
    },
    onError: (err) => toast.error(errorDetail(err, "Could not record the fee")),
  });

  return (
    <Modal open onClose={onClose} title="Record a client fee">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) record.mutate();
        }}
        className="flex flex-col gap-5"
      >
        <p className="text-[14px] leading-5 text-slate-500">
          The creator&apos;s {commissionPct}% share is computed and locked in at the moment you
          record it, and appears in their balance immediately.
        </p>
        <SelectField
          label="Client"
          value={form.client_id}
          onChange={(e) => setForm({ ...form, client_id: e.target.value })}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label ?? c.client_ref} · {c.creator_name}
            </option>
          ))}
        </SelectField>
        <Field
          label="Fee paid (€)"
          placeholder="40,00"
          inputMode="decimal"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          required
        />
        <Field
          label="Date"
          type="date"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
        <Field
          label="Note (optional)"
          placeholder="September management fee"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
        <div className="flex items-baseline justify-between rounded-[8px] bg-cream px-5 py-4">
          <span className="text-[14px] leading-5 text-slate-500">Creator receives</span>
          <span className="font-serif text-[24px] leading-8 text-green-600">
            {valid ? formatEuros(share) : "—"}
          </span>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={!valid || record.isPending}>
            {record.isPending ? "Recording…" : "Record Fee"}
          </Button>
          <Button kind="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function AdminReferralsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-referrals"],
    queryFn: fetchAdminReferrals,
  });
  const [attributeFor, setAttributeFor] = useState<number | null | false>(false);
  const [feeFor, setFeeFor] = useState<number | null | false>(false);
  const [clientFilter, setClientFilter] = useState("");

  const regenerate = useMutation({
    mutationFn: (creatorId: number) => adminRegenerateCode(creatorId),
    onSuccess: (result) => {
      invalidateAll(queryClient);
      queryClient.invalidateQueries({ queryKey: ["admin-creators"] });
      toast.success(`New code issued: ${result.code}`);
    },
    onError: () => toast.error("Could not issue a new code"),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "active" | "churned" }) =>
      adminSetClientStatus(id, status),
    onSuccess: () => invalidateAll(queryClient),
    onError: () => toast.error("Could not update the client"),
  });

  const filteredClients = useMemo(() => {
    const q = clientFilter.trim().toLowerCase();
    const rows = data?.clients ?? [];
    if (!q) return rows;
    return rows.filter(
      (c) =>
        c.client_ref.toLowerCase().includes(q) ||
        (c.label ?? "").toLowerCase().includes(q) ||
        c.creator_name.toLowerCase().includes(q)
    );
  }, [data, clientFilter]);

  if (isLoading) return <Spinner label="Loading referrals…" />;
  if (!data) return null;

  const activeCreators = data.creators.filter((c) => c.status === "approved");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="display-md text-ink">Referrals</h1>
          <p className="max-w-[600px] text-[16px] leading-6 text-slate-500">
            Every creator has a code new clients enter during onboarding. Creators earn{" "}
            <span className="font-medium text-ink">{data.commission_pct}%</span> of every fee
            those clients pay. The product reports clients and fees over the referral API;
            use the buttons here to record either by hand.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            kind="secondary"
            size="m"
            icon="ph-user-plus"
            onClick={() => setAttributeFor(null)}
            disabled={activeCreators.length === 0}
          >
            Attribute Client
          </Button>
          <Button
            size="m"
            icon="ph-receipt"
            onClick={() => setFeeFor(null)}
            disabled={data.clients.length === 0}
          >
            Record Fee
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-8 sm:flex-row">
        <StatCard value={String(data.totals.active_clients)} description="Active referred clients" />
        <StatCard value={formatEuros(data.totals.fees_cents)} description="Fees paid by referred clients" />
        <StatCard value={formatEuros(data.totals.commission_cents)} description="Owed to creators from fees, all-time" />
        <StatCard value={`${data.commission_pct}%`} description="Creator share of each fee" />
      </div>

      {/* Per-creator */}
      <div className="dashed-card flex flex-col gap-5 p-6 lg:p-8">
        <h2 className="display-xs text-ink">Creators</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="border-b border-ink">
                <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Creator</th>
                <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Code</th>
                <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">Clients</th>
                <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">Fees paid</th>
                <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">Creator share</th>
                <th className="py-3" />
              </tr>
            </thead>
            <tbody>
              {data.creators.map((c) => (
                <tr key={c.creator_id} className="border-b border-bone-200">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2 text-[15px] font-medium leading-5 text-ink">
                      {c.name}
                      {c.status !== "approved" && <Badge tone="warn">{c.status}</Badge>}
                    </div>
                    <div className="text-[12px] leading-4 text-slate-400">{c.email}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <code className="rounded-[4px] bg-bone-100 px-2 py-1 text-[14px] tracking-[0.04em] text-ink">
                        {c.code ?? "—"}
                      </code>
                      <button
                        type="button"
                        title="Copy"
                        onClick={() => {
                          if (!c.code) return;
                          navigator.clipboard.writeText(c.code);
                          toast.success("Code copied");
                        }}
                        className="cursor-pointer text-slate-400 hover:text-ink"
                      >
                        <i className="ph ph-copy text-[16px]" />
                      </button>
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-right text-[14px] leading-5 text-ink">
                    {c.active_clients}
                    {c.clients !== c.active_clients && (
                      <span className="text-slate-400"> / {c.clients}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-right text-[14px] leading-5 text-slate-500">
                    {formatEuros(c.fees_cents)}
                  </td>
                  <td className="py-3 pr-4 text-right">
                    <span
                      className={`font-serif text-[18px] leading-6 ${
                        c.commission_cents > 0 ? "text-green-600" : "text-slate-400"
                      }`}
                    >
                      {formatEuros(c.commission_cents)}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        kind="secondary"
                        size="s"
                        onClick={() => setAttributeFor(c.creator_id)}
                        disabled={c.status !== "approved"}
                      >
                        Add Client
                      </Button>
                      <Button
                        kind="secondary"
                        size="s"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Issue a new code for ${c.name}? The current code ${c.code ?? ""} stops working immediately; existing clients stay attributed.`
                            )
                          )
                            regenerate.mutate(c.creator_id);
                        }}
                        disabled={regenerate.isPending}
                      >
                        New Code
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Clients */}
      <div className="dashed-card flex flex-col gap-5 p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="display-xs text-ink">Referred clients</h2>
          {data.clients.length > 5 && (
            <Field
              placeholder="Filter by reference, label or creator"
              icon="ph-magnifying-glass"
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="w-full max-w-[360px]"
            />
          )}
        </div>
        {filteredClients.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b border-ink">
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Client</th>
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Creator</th>
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Joined</th>
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Source</th>
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Status</th>
                  <th className="py-3" />
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((c) => (
                  <tr key={c.id} className="border-b border-bone-200">
                    <td className="py-3 pr-4">
                      <div className="text-[15px] leading-5 text-ink">{c.label ?? c.client_ref}</div>
                      {c.label && (
                        <div className="text-[12px] leading-4 text-slate-400">{c.client_ref}</div>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-[14px] leading-5 text-ink">{c.creator_name}</td>
                    <td className="py-3 pr-4 text-[13px] leading-5 text-slate-500">
                      {formatDate(c.attributed_at)}
                    </td>
                    <td className="py-3 pr-4 text-[13px] leading-5 text-slate-500">
                      {c.source === "api" ? "Product" : "Manual"}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge tone={c.status === "active" ? "positive" : "neutral"}>{c.status}</Badge>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button kind="secondary" size="s" onClick={() => setFeeFor(c.id)}>
                          Record Fee
                        </Button>
                        <Button
                          kind="secondary"
                          size="s"
                          disabled={setStatus.isPending}
                          onClick={() =>
                            setStatus.mutate({
                              id: c.id,
                              status: c.status === "active" ? "churned" : "active",
                            })
                          }
                        >
                          {c.status === "active" ? "Mark Churned" : "Reactivate"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="ph-users-three"
            title={clientFilter ? "No clients match" : "No referred clients yet"}
            body={
              clientFilter
                ? undefined
                : "Clients appear here as the product reports sign-ups with a creator code, or when you attribute one by hand."
            }
          />
        )}
      </div>

      {/* Fee ledger */}
      <div className="dashed-card flex flex-col gap-5 p-6 lg:p-8">
        <h2 className="display-xs text-ink">Fee ledger</h2>
        {data.recent_fees.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-ink">
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Date</th>
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Client</th>
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Creator</th>
                  <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">Fee</th>
                  <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">Share</th>
                  <th className="py-3 text-[13px] font-medium leading-5 text-slate-500">Note</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_fees.map((f) => (
                  <tr key={f.id} className="border-b border-bone-200">
                    <td className="py-3 pr-4 text-[14px] leading-5 text-ink">{formatDate(f.occurred_at)}</td>
                    <td className="py-3 pr-4 text-[14px] leading-5 text-ink">
                      {f.client.label ?? f.client.client_ref}
                    </td>
                    <td className="py-3 pr-4 text-[14px] leading-5 text-slate-500">{f.creator.name}</td>
                    <td className="py-3 pr-4 text-right text-[14px] leading-5 text-slate-500">
                      {formatEuros(f.fee_cents)}
                    </td>
                    <td className="py-3 pr-4 text-right font-serif text-[18px] leading-6 text-green-600">
                      {formatEuros(f.commission_cents)}
                      <span className="ml-1 font-sans text-[11px] text-slate-400">
                        {f.commission_bps / 100}%
                      </span>
                    </td>
                    <td className="py-3 text-[13px] leading-5 text-slate-500">
                      {f.note || (f.source === "api" ? "reported by product" : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[14px] leading-5 text-slate-400">No fees recorded yet.</p>
        )}
      </div>

      {attributeFor !== false && (
        <AttributeClientModal
          creators={activeCreators}
          preselect={attributeFor}
          onClose={() => setAttributeFor(false)}
        />
      )}
      {feeFor !== false && (
        <RecordFeeModal
          clients={data.clients}
          commissionPct={data.commission_pct}
          preselect={feeFor}
          onClose={() => setFeeFor(false)}
        />
      )}
    </div>
  );
}
