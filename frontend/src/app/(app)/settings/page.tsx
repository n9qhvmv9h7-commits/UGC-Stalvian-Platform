"use client";

/* Settings — language (drives all content), profile, and payout details. */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchMe, setToken, updateMe } from "@/lib/api";
import { LANGUAGES } from "@/lib/format";
import { Button, Eyebrow, Field, SelectField } from "@/components/ui";
import { ReferralCode } from "@/components/referral-code";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });

  const [form, setForm] = useState({
    name: "",
    handle: "",
    tiktok_handle: "",
    instagram_handle: "",
    youtube_handle: "",
    language: "en",
    country: "",
    payout_method: "",
    payout_details: "",
  });

  // Populate once — a background ["me"] refetch must not clobber mid-edit typing.
  const initialized = useRef(false);
  useEffect(() => {
    if (me && !initialized.current) {
      initialized.current = true;
      setForm({
        name: me.name || "",
        handle: me.handle || "",
        tiktok_handle: me.tiktok_handle || "",
        instagram_handle: me.instagram_handle || "",
        youtube_handle: me.youtube_handle || "",
        language: me.language || "en",
        country: me.country || "",
        payout_method: me.payout_method || "",
        payout_details: me.payout_details || "",
      });
    }
  }, [me]);

  const [passwords, setPasswords] = useState({ current: "", next: "" });

  const save = useMutation({
    // Send only fields that differ from the server state — a stale tab must
    // never clobber changes (e.g. an IBAN) saved from another device.
    mutationFn: () => {
      const current: Record<string, string> = {
        name: me?.name || "",
        handle: me?.handle || "",
        tiktok_handle: me?.tiktok_handle || "",
        instagram_handle: me?.instagram_handle || "",
        youtube_handle: me?.youtube_handle || "",
        language: me?.language || "en",
        country: me?.country || "",
        payout_method: me?.payout_method || "",
        payout_details: me?.payout_details || "",
      };
      const dirty = Object.fromEntries(
        Object.entries(form).filter(([key, value]) => value !== current[key])
      );
      return updateMe({
        ...dirty,
        ...(passwords.next
          ? { current_password: passwords.current, new_password: passwords.next }
          : {}),
      });
    },
    onSuccess: (result) => {
      // A password change rotates the session token — store the fresh one.
      const token = (result as { token?: string }).token;
      if (token) setToken(token);
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["breaking"] });
      queryClient.invalidateQueries({ queryKey: ["movers"] });
      queryClient.invalidateQueries({ queryKey: ["my-stories"] });
      setPasswords({ current: "", next: "" });
      toast.success("Settings saved");
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Could not save settings");
    },
  });

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-6">
        <Eyebrow icon="ph-gear">Settings</Eyebrow>
        <h1 className="display-md text-ink">Your account</h1>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="flex max-w-[560px] flex-col gap-10"
      >
        <div className="flex flex-col gap-3">
          <div className="text-[18px] leading-6 font-medium text-ink">Referral code</div>
          <div className="flex flex-wrap items-center gap-4">
            <ReferralCode code={me?.referral_code} />
            <p className="max-w-[300px] text-[13px] leading-5 text-slate-500">
              Fixed to your account. If it ever needs changing, ask the Stalvian team.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <h2 className="display-xs text-ink">Profile</h2>
          <Field
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Field
            label="Handle"
            icon="ph-at"
            placeholder="the handle you post under"
            value={form.handle}
            onChange={(e) => setForm({ ...form, handle: e.target.value })}
          />
          <SelectField
            label="Content language"
            value={form.language}
            onChange={(e) => setForm({ ...form, language: e.target.value })}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </SelectField>
          <p className="-mt-3 text-[14px] leading-5 text-slate-500">
            Every script — album stories, breaking news, movers — is delivered in this
            language.
          </p>
          <Field
            label="Country"
            placeholder="Spain"
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-6">
          <h2 className="display-xs text-ink">Social profiles</h2>
          <Field
            label="TikTok"
            icon="ph-tiktok-logo"
            placeholder="your TikTok handle"
            value={form.tiktok_handle}
            onChange={(e) => setForm({ ...form, tiktok_handle: e.target.value })}
          />
          <Field
            label="Instagram"
            icon="ph-instagram-logo"
            placeholder="your Instagram handle"
            value={form.instagram_handle}
            onChange={(e) => setForm({ ...form, instagram_handle: e.target.value })}
          />
          <Field
            label="YouTube"
            icon="ph-youtube-logo"
            placeholder="your YouTube channel"
            value={form.youtube_handle}
            onChange={(e) => setForm({ ...form, youtube_handle: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-6">
          <h2 className="display-xs text-ink">Payout</h2>
          <SelectField
            label="Payout method"
            value={form.payout_method}
            onChange={(e) => setForm({ ...form, payout_method: e.target.value })}
          >
            <option value="">Choose…</option>
            <option value="iban">Bank transfer (IBAN)</option>
            <option value="paypal">PayPal</option>
          </SelectField>
          <Field
            label={form.payout_method === "paypal" ? "PayPal email" : "IBAN"}
            placeholder={form.payout_method === "paypal" ? "you@example.com" : "ES00 0000 0000 0000 0000 0000"}
            value={form.payout_details}
            onChange={(e) => setForm({ ...form, payout_details: e.target.value })}
          />
          <p className="-mt-3 text-[14px] leading-5 text-slate-500">
            Balances are paid out monthly once they reach €5,00.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <h2 className="display-xs text-ink">Password</h2>
          <p className="-mt-3 text-[14px] leading-5 text-slate-500">
            Your account was created by the Stalvian team — change the password they gave
            you here.
          </p>
          <Field
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={passwords.current}
            onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
          />
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            minLength={8}
            value={passwords.next}
            onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
          />
        </div>

        <div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save Settings"}
          </Button>
        </div>
      </form>
    </div>
  );
}
