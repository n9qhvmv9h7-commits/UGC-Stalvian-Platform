"use client";

/* Stalvian UI primitives — faithful ports of the design-system website kit.
   Buttons are mostly square (L=4px, M=8px, S=pill). Serif is display-only.
   Icons are Phosphor via the CDN web font (<i className="ph ph-..." />). */

import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  useEffect,
  useRef,
  useState,
} from "react";

type ButtonKind = "primary" | "secondary" | "primary-on-ink" | "secondary-on-ink";
type ButtonSize = "l" | "m" | "s";

const buttonSizes: Record<ButtonSize, string> = {
  l: "h-14 px-6 text-[16px] leading-6 rounded-[4px]",
  m: "h-12 px-5 text-[15px] leading-6 rounded-[8px]",
  s: "h-8 px-4 text-[12px] leading-4 rounded-full uppercase tracking-[0.04em]",
};

const buttonKinds: Record<ButtonKind, string> = {
  primary: "bg-black text-white hover:opacity-90",
  secondary: "bg-bone-100 text-black hover:bg-bone-200",
  "primary-on-ink": "bg-white text-ink hover:opacity-90",
  "secondary-on-ink": "bg-white/10 text-white hover:bg-white/15",
};

export function Button({
  kind = "primary",
  size = "l",
  icon,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: ButtonKind;
  size?: ButtonSize;
  icon?: string;
}) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-bold whitespace-nowrap cursor-pointer transition-[background,opacity] duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${buttonSizes[size]} ${buttonKinds[kind]} ${className}`}
      {...props}
    >
      {icon && <i className={`ph ${icon} text-[18px]`} />}
      {children}
    </button>
  );
}

export function Eyebrow({
  icon,
  onDark = false,
  children,
}: {
  icon?: string;
  onDark?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-3 text-[18px] leading-6 font-medium ${onDark ? "text-white" : "text-ink"}`}
    >
      {icon && (
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-[4px] ${
            onDark ? "bg-white text-ink" : "bg-ink text-white"
          }`}
        >
          <i className={`ph-fill ${icon} text-[14px]`} />
        </span>
      )}
      {children}
    </div>
  );
}

export function StatCard({
  value,
  description,
  onDark = false,
}: {
  value: React.ReactNode;
  description: string;
  onDark?: boolean;
}) {
  return (
    <div
      className={`flex flex-1 flex-col gap-3 border-t pt-5 ${
        onDark ? "border-ink-500" : "border-ink"
      }`}
    >
      <div className={`display-md ${onDark ? "text-white" : "text-ink"}`}>{value}</div>
      <div className={`text-[16px] leading-6 ${onDark ? "text-slate-300" : "text-slate-500"}`}>
        {description}
      </div>
    </div>
  );
}

export function Field({
  label,
  icon,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; icon?: string }) {
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {label && <div className="text-[18px] leading-6 font-medium text-ink">{label}</div>}
      <div className="flex h-14 items-center gap-3 rounded-[8px] bg-bone-100 px-5">
        {icon && <i className={`ph ${icon} text-[20px] text-slate-500`} />}
        <input
          className="flex-1 bg-transparent text-[18px] leading-6 text-ink outline-none placeholder:text-slate-400"
          {...props}
        />
      </div>
    </div>
  );
}

export function SelectField({
  label,
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {label && <div className="text-[18px] leading-6 font-medium text-ink">{label}</div>}
      <div className="flex h-14 items-center rounded-[8px] bg-bone-100 px-5">
        <select
          className="w-full appearance-none bg-transparent text-[18px] leading-6 text-ink outline-none cursor-pointer"
          {...props}
        >
          {children}
        </select>
        <i className="ph ph-caret-down text-[18px] text-slate-500" />
      </div>
    </div>
  );
}

/* A small menu button: the trigger shows the current choice, the panel lists
   the rest. Used where a segmented control would be too wide for the options
   it holds. */
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  icon,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  icon?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 cursor-pointer items-center gap-2 rounded-full bg-bone-100 px-4 text-[13px] font-medium leading-4 text-ink hover:bg-bone-200"
      >
        {icon && <i className={`ph ${icon} text-[16px] text-slate-500`} />}
        {current?.label ?? String(value)}
        <i className="ph ph-caret-down text-[14px] text-slate-500" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 min-w-[160px] overflow-hidden rounded-[8px] border border-bone-200 bg-white py-1 shadow-[0_12px_32px_-12px_rgba(1,5,16,0.3)]">
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-2 text-left text-[14px] leading-5 hover:bg-bone-100 ${
                o.value === value ? "font-medium text-ink" : "text-slate-500"
              }`}
            >
              {o.label}
              {o.value === value && <i className="ph ph-check text-[14px]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* Unread count. Deliberately the one red thing in the app — it is the only
   signal that asks a creator to go somewhere. Caps at 99+ so a backfill of a
   thousand scripts cannot stretch the sidebar. */
export function UnreadDot({ count, onDark = false }: { count: number; onDark?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-4 text-white ${
        onDark ? "bg-red-500" : "bg-red-600"
      }`}
      aria-label={`${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "positive" | "warn" | "ink";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-bone-100 text-slate-500",
    positive: "bg-green-600/10 text-green-600",
    warn: "bg-gold/15 text-[#8a6400]",
    ink: "bg-ink text-white",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] leading-4 font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-slate-500">
      <i className="ph ph-circle-notch animate-spin text-[20px]" />
      {label && <span className="text-[15px] leading-5">{label}</span>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="dashed-card flex flex-col items-center gap-4 px-8 py-16 text-center">
      <i className={`ph ${icon} text-[40px] text-slate-400`} />
      <div className="display-xs text-ink">{title}</div>
      {body && <p className="max-w-md text-[16px] leading-6 text-slate-500">{body}</p>}
      {action}
    </div>
  );
}
