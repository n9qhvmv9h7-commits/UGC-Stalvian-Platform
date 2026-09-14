"use client";

/* ReferralCode — the creator's code, big and copyable. Shown on the
   dashboard, the earnings page and settings; same component everywhere so
   the code always looks like the same object. */

import { useState } from "react";
import { toast } from "sonner";

export function ReferralCode({
  code,
  size = "m",
  onDark = false,
}: {
  code: string | null | undefined;
  size?: "m" | "l";
  onDark?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Code copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy — select the code and copy it by hand");
    }
  };
  const text = size === "l" ? "font-serif text-[40px] leading-[48px]" : "font-serif text-[28px] leading-8";
  return (
    <button
      type="button"
      onClick={copy}
      disabled={!code}
      title="Copy your code"
      className={`group inline-flex cursor-pointer items-center gap-4 rounded-[8px] border border-dashed px-5 py-3 text-left transition-colors ${
        onDark
          ? "border-white/30 bg-white/5 hover:bg-white/10"
          : "border-ink bg-white hover:bg-bone-100"
      }`}
    >
      <span className={`tracking-[0.06em] ${text} ${onDark ? "text-white" : "text-ink"}`}>
        {code ?? "— — — —"}
      </span>
      <span
        className={`inline-flex items-center gap-1 text-[12px] font-bold uppercase leading-4 tracking-[0.04em] ${
          onDark ? "text-white/60 group-hover:text-white" : "text-slate-500 group-hover:text-ink"
        }`}
      >
        <i className={`ph ${copied ? "ph-check" : "ph-copy"} text-[16px]`} />
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}
