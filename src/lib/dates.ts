/** UTC-anchored date helpers. All reporting windows are inclusive of both ends. */

export interface DateRange {
  since: Date;
  until: Date;
  /** Inclusive day count, always >= 1. */
  days: number;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Presets used by the dashboard's range picker. */
export const RANGE_PRESETS = {
  today: 1,
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
} as const;

export type RangePreset = keyof typeof RANGE_PRESETS;

export function rangeFromPreset(preset: RangePreset, now = new Date()): DateRange {
  const days = RANGE_PRESETS[preset];
  const until = endOfUtcDay(now);
  const since = startOfUtcDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  return { since, until, days };
}

export function resolveRange(params: {
  since?: string | null;
  until?: string | null;
  preset?: string | null;
}): DateRange {
  const since = parseIsoDate(params.since ?? null);
  const until = parseIsoDate(params.until ?? null);

  if (since && until) {
    const normalizedUntil = endOfUtcDay(until);
    const days = Math.max(1, Math.round((startOfUtcDay(until).getTime() - since.getTime()) / DAY_MS) + 1);
    return { since, until: normalizedUntil, days };
  }

  const preset = (params.preset ?? '7d') as RangePreset;
  return rangeFromPreset(preset in RANGE_PRESETS ? preset : '7d');
}

/** Every calendar day in the range, ascending. */
export function eachDay(range: DateRange): Date[] {
  const days: Date[] = [];
  for (let cursor = startOfUtcDay(range.since); cursor <= range.until; cursor = new Date(cursor.getTime() + DAY_MS)) {
    days.push(new Date(cursor));
  }
  return days;
}

export function previousRange(range: DateRange): DateRange {
  const until = new Date(range.since.getTime() - 1);
  const since = startOfUtcDay(new Date(range.since.getTime() - range.days * DAY_MS));
  return { since, until, days: range.days };
}
