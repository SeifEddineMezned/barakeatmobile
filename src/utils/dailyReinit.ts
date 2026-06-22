// Daily reinit helpers for a basket. When a per-day schedule is stored on the
// basket (JSONB `daily_reinit_schedule`), we honour that day's value — otherwise
// we fall back to the flat `daily_reinitialization_quantity`. Mirrors the backend
// cron at backend/routes/cron.js so the number displayed matches what the cron
// actually resets to (daily at 03:30 Africa/Tunis).

import { getNowInBusinessTz } from './timezone';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const WEEK_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const RESET_MINUTES = 3 * 60 + 30; // 03:30 daily reset

function parseSchedule(raw: any): Record<string, any> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
  }
  return null;
}

export function getTodayReinitKey(date: Date = new Date()): string {
  return DAY_KEYS[date.getDay()] ?? 'mon';
}

// Calendar weekday key in Africa/Tunis (not the 03:30-shifted business day).
function tunisWeekdayKey(): string {
  try {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Tunis', weekday: 'short' }).format(new Date());
    const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
    if (idx >= 0) return DAY_KEYS[idx];
  } catch { /* ignore */ }
  return DAY_KEYS[new Date().getDay()];
}

/**
 * Day key of the NEXT 03:30 reset: today's key if we're still before 03:30
 * (today's reset is pending), otherwise tomorrow's (today's already ran).
 */
export function nextResetDayKey(): string {
  const now = getNowInBusinessTz('Africa/Tunis');
  const nowMin = now.hours * 60 + now.minutes;
  const todayIdx = DAY_KEYS.indexOf(tunisWeekdayKey() as any);
  const idx = nowMin < RESET_MINUTES ? todayIdx : (todayIdx + 1) % 7;
  return DAY_KEYS[idx];
}

/** The reinit target for a specific day key (per-day schedule, else flat). */
export function reinitForDay(basket: any, dayKey: string): number {
  if (!basket) return 0;
  const schedule = parseSchedule(basket.daily_reinit_schedule);
  if (schedule) {
    const n = Number(schedule[dayKey]);
    if (Number.isFinite(n)) return n;
  }
  const flat = Number(basket.daily_reinitialization_quantity);
  return Number.isFinite(flat) ? flat : 0;
}

/** Today's reinit target (what it reset to this morning). */
export function effectiveDailyReinit(basket: any): number {
  return reinitForDay(basket, getTodayReinitKey());
}

/** The quantity the basket will RESET to at the next 03:30. */
export function nextReinitQuantity(basket: any): number {
  return reinitForDay(basket, nextResetDayKey());
}

/** True when the basket uses a per-day reinit schedule (vs a flat value). */
export function hasPerDayReinit(basket: any): boolean {
  return parseSchedule(basket?.daily_reinit_schedule) != null;
}

/** Mon→Sun entries for the per-day schedule popup. */
export function reinitScheduleEntries(basket: any): Array<{ day: string; qty: number }> {
  return WEEK_ORDER.map((day) => ({ day, qty: reinitForDay(basket, day) }));
}
