"use client";

/* Minimal flat modal per the Stalvian app-UI rules (shadow allowed in app UI). */

import { useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-[860px] flex-col overflow-hidden rounded-[12px] bg-white shadow-[0_24px_48px_-24px_rgba(1,5,16,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-bone-200 px-8 py-5">
          <div className="display-xs text-ink">{title}</div>
          <button
            onClick={onClose}
            className="cursor-pointer text-slate-400 hover:text-ink"
            aria-label="Close"
          >
            <i className="ph ph-x text-[22px]" />
          </button>
        </div>
        <div className="overflow-y-auto px-8 py-6">{children}</div>
      </div>
    </div>
  );
}
