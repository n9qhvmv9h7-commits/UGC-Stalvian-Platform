"use client";

/* Admin › Payouts — per-creator balances (eligible earned − paid) and the
   record-payment action. Monthly runs stay manual: pay who's owed, log it. */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchAdminPayouts, recordPayout, type AdminPayoutBalance } from "@/lib/api";
import { formatDate, formatEuros, formatViews } from "@/lib/format";
import { Badge, Button, EmptyState, Field, Spinner } from "@/components/ui";
import { Modal } from "@/components/modal";

function RecordPaymentModal({
  target,
  onClose,
}: {
  target: AdminPayoutBalance;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState((target.balance_cents / 100).toFixed(2));
  const [note, setNote] = useState("");

  const record = useMutation({
    mutationFn: () =>
      recordPayout({
        creator_id: target.creator_id,
        amount_cents: Math.round(parseFloat(amount.replace(",", ".")) * 100),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
      queryClient.invalidateQueries({ queryKey: ["creator-metrics"] });
      toast.success(`Payment recorded for ${target.name}`);
      onClose();
    },
    onError: () => toast.error("Could not record the payment"),
  });

  const cents = Math.round(parseFloat(amount.replace(",", ".")) * 100);
  const valid = Number.isFinite(cents) && cents > 0;

  return (
    <Modal open onClose={onClose} title={`Record payment — ${target.name}`}>
      <div className="flex flex-col gap-5">
        <p className="text-[14px] leading-5 text-slate-500">
          Balance: <span className="font-medium text-ink">{formatEuros(target.balance_cents)}</span>
          {" · "}
          {target.payout_ready
            ? `via ${target.payout_method === "iban" ? "bank transfer" : "PayPal"}`
            : "payout method not set by the creator yet"}
        </p>
        <Field
          label="Amount (€)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />
        <Field
          label="Note (optional)"
          placeholder="July payout"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex gap-2">
          <Button disabled={!valid || record.isPending} onClick={() => record.mutate()}>
            {record.isPending ? "Recording…" : "Record Payment"}
          </Button>
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function AdminPayoutsPage() {
  const [target, setTarget] = useState<AdminPayoutBalance | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-payouts"],
    queryFn: fetchAdminPayouts,
  });

  if (isLoading) return <Spinner label="Loading balances…" />;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="display-md text-ink">Payouts</h1>
        <p className="max-w-[560px] text-[16px] leading-6 text-slate-500">
          Balances are eligible earnings minus what&apos;s been paid. Record each payment
          here after sending it — creators see it on their earnings page immediately.
        </p>
      </div>

      <div className="dashed-card flex flex-col gap-5 p-6 lg:p-8">
        <h2 className="display-xs text-ink">Balances</h2>
        {data.balances.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-ink">
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Creator</th>
                  <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">Views</th>
                  <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">Earned</th>
                  <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">Paid</th>
                  <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">Balance</th>
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Method</th>
                  <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Last payout</th>
                  <th className="py-3" />
                </tr>
              </thead>
              <tbody>
                {data.balances.map((b) => (
                  <tr key={b.creator_id} className="border-b border-bone-200">
                    <td className="py-3 pr-4">
                      <div className="text-[15px] font-medium leading-5 text-ink">{b.name}</div>
                      <div className="text-[12px] leading-4 text-slate-400">{b.email}</div>
                    </td>
                    <td className="py-3 pr-4 text-right text-[14px] leading-5 text-slate-500">
                      {formatViews(b.eligible_views)}
                    </td>
                    <td className="py-3 pr-4 text-right text-[14px] leading-5 text-ink">
                      {formatEuros(b.earned_cents)}
                    </td>
                    <td className="py-3 pr-4 text-right text-[14px] leading-5 text-slate-500">
                      {formatEuros(b.paid_cents)}
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span
                        className={`font-serif text-[18px] leading-6 ${
                          b.balance_cents > 0 ? "text-green-600" : "text-slate-400"
                        }`}
                      >
                        {formatEuros(b.balance_cents)}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {b.payout_ready ? (
                        <Badge tone="positive">
                          {b.payout_method === "iban" ? "IBAN" : "PayPal"}
                        </Badge>
                      ) : (
                        <Badge tone="warn">Not set</Badge>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-[13px] leading-5 text-slate-500">
                      {b.last_payout_at ? formatDate(b.last_payout_at) : "—"}
                    </td>
                    <td className="py-3 text-right">
                      <Button
                        kind="secondary"
                        size="s"
                        disabled={b.balance_cents === 0}
                        onClick={() => setTarget(b)}
                      >
                        Record Payment
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[14px] leading-5 text-slate-400">No creators with activity yet.</p>
        )}
      </div>

      <div className="dashed-card flex flex-col gap-5 p-6 lg:p-8">
        <h2 className="display-xs text-ink">Payout history</h2>
        {data.history.length > 0 ? (
          <table className="w-full max-w-[760px] text-left">
            <thead>
              <tr className="border-b border-ink">
                <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Date</th>
                <th className="py-3 pr-4 text-[13px] font-medium leading-5 text-slate-500">Creator</th>
                <th className="py-3 pr-4 text-right text-[13px] font-medium leading-5 text-slate-500">Amount</th>
                <th className="py-3 text-[13px] font-medium leading-5 text-slate-500">Note</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((p) => (
                <tr key={p.id} className="border-b border-bone-200">
                  <td className="py-3 pr-4 text-[14px] leading-5 text-ink">
                    {formatDate(p.created_at)}
                  </td>
                  <td className="py-3 pr-4 text-[14px] leading-5 text-ink">{p.creator.name}</td>
                  <td className="py-3 pr-4 text-right font-serif text-[18px] leading-6 text-ink">
                    {formatEuros(p.amount_cents)}
                  </td>
                  <td className="py-3 text-[13px] leading-5 text-slate-500">{p.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            icon="ph-currency-eur"
            title="No payouts recorded yet"
            body="Payments you record appear here and on each creator's earnings page."
          />
        )}
      </div>

      {target && <RecordPaymentModal target={target} onClose={() => setTarget(null)} />}
    </div>
  );
}
