"use client";

/* A date-range picker: presets on the left, a month calendar on the right.

   Built here rather than pulled from npm — it needs one month grid, two
   selected edges and a handful of presets, which is less code than the adapter
   any library would need to match the Stalvian system. */

import { useEffect, useMemo, useRef, useState } from "react";

export type DateRange = { start: Date; end: Date };

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/* Local calendar date, NOT toISOString() — that converts to UTC and can land
   on the previous day for anyone east of Greenwich. */
export function toISODate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

export function rangeDays(r: DateRange): number {
  return Math.round((r.end.getTime() - r.start.getTime()) / DAY_MS) + 1;
}

export function lastNDays(n: number, today = startOfDay(new Date())): DateRange {
  return { start: addDays(today, -(n - 1)), end: today };
}

const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 12 months", days: 365 },
];

function label(d: Date, withYear: boolean): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export function rangeLabel(r: DateRange): string {
  const thisYear = new Date().getFullYear();
  const spansYears = r.start.getFullYear() !== r.end.getFullYear();
  const withYear = spansYears || r.end.getFullYear() !== thisYear;
  if (sameDay(r.start, r.end)) return label(r.start, withYear);
  return `${label(r.start, spansYears || withYear)} – ${label(r.end, withYear)}`;
}

/* Cells for one month, padded so the 1st lands on its weekday (Monday-first). */
function monthCells(month: Date): (Date | null)[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // JS weeks start Sunday
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: count }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ];
}

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(value.end.getFullYear(), value.end.getMonth(), 1));
  // First click of a new range; the second click closes it.
  const [pending, setPending] = useState<Date | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const today = useMemo(() => startOfDay(new Date()), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setPending(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPending(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (day: Date) => {
    if (pending === null) {
      setPending(day);
      return;
    }
    // Clicking before the pending edge reads as "I meant this as the start".
    const next = day < pending ? { start: day, end: pending } : { start: pending, end: day };
    setPending(null);
    setOpen(false);
    onChange(next);
  };

  const applyPreset = (days: number) => {
    setPending(null);
    setOpen(false);
    const next = lastNDays(days, today);
    setMonth(new Date(next.end.getFullYear(), next.end.getMonth(), 1));
    onChange(next);
  };

  const inRange = (d: Date) => d >= value.start && d <= value.end;
  const isEdge = (d: Date) => sameDay(d, value.start) || sameDay(d, value.end);
  const activeDays = rangeDays(value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 cursor-pointer items-center gap-2 rounded-full bg-bone-100 px-4 text-[13px] font-medium leading-4 text-ink hover:bg-bone-200"
      >
        <i className="ph ph-calendar-blank text-[16px] text-slate-500" />
        {rangeLabel(value)}
        <i className="ph ph-caret-down text-[14px] text-slate-500" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 flex gap-0 overflow-hidden rounded-[8px] border border-bone-200 bg-white shadow-[0_12px_32px_-12px_rgba(1,5,16,0.3)]">
          <div className="flex w-[150px] shrink-0 flex-col gap-1 border-r border-bone-200 p-2">
            {PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => applyPreset(p.days)}
                className={`cursor-pointer rounded-[6px] px-3 py-2 text-left text-[13px] leading-5 hover:bg-bone-100 ${
                  pending === null && activeDays === p.days && sameDay(value.end, today)
                    ? "bg-bone-100 font-medium text-ink"
                    : "text-slate-500"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex w-[268px] flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                className="cursor-pointer rounded-[6px] p-1 text-slate-500 hover:bg-bone-100 hover:text-ink"
              >
                <i className="ph ph-caret-left text-[16px]" />
              </button>
              <span className="text-[14px] font-medium leading-5 text-ink">
                {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
              </span>
              <button
                type="button"
                aria-label="Next month"
                disabled={month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth()}
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                className="cursor-pointer rounded-[6px] p-1 text-slate-500 hover:bg-bone-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <i className="ph ph-caret-right text-[16px]" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-y-1">
              {WEEKDAYS.map((w) => (
                <div key={w} className="text-center text-[11px] leading-4 text-slate-400">
                  {w}
                </div>
              ))}
              {monthCells(month).map((day, i) => {
                if (!day) return <div key={`pad-${i}`} />;
                const future = day > today;
                const edge = pending ? sameDay(day, pending) : isEdge(day);
                const within = !pending && inRange(day) && !edge;
                return (
                  <button
                    key={day.getTime()}
                    type="button"
                    disabled={future}
                    onClick={() => pick(day)}
                    className={`h-8 cursor-pointer rounded-[6px] text-[13px] leading-5 disabled:cursor-not-allowed disabled:text-slate-300 ${
                      edge
                        ? "bg-ink font-medium text-white"
                        : within
                          ? "bg-bone-100 text-ink"
                          : "text-slate-500 hover:bg-bone-100 hover:text-ink"
                    }`}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            <p className="text-[12px] leading-4 text-slate-400">
              {pending ? "Pick the end of the range" : `${activeDays} days selected`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
