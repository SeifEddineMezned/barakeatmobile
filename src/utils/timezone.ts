/**
 * Timezone-aware time utilities for comparing pickup times.
 *
 * Business hours are stored as HH:MM in the business's local timezone.
 * The user's device may be in a different timezone. All pickup time comparisons
 * must convert "now" to the business's timezone before comparing.
 *
 * The "business day" runs from 03:30 (daily cron reset) to 03:29 the next day.
 * Pickup end times can be after midnight (e.g., 01:30 AM) — these are treated
 * as later than evening times (23:00) within the same business day.
 *
 * Default timezone: Africa/Tunis (UTC+1).
 */

const DEFAULT_BUSINESS_TZ = 'Africa/Tunis';

/** The daily cron reset time in minutes since midnight (03:30 = 210). */
const DAILY_RESET_MINUTES = 3 * 60 + 30;

/**
 * Get the current time in the business's timezone as { hours, minutes }.
 */
export function getNowInBusinessTz(timezone?: string): { hours: number; minutes: number } {
  const tz = timezone || DEFAULT_BUSINESS_TZ;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());

    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
    return { hours: hour, minutes: minute };
  } catch {
    const now = new Date();
    return { hours: now.getHours(), minutes: now.getMinutes() };
  }
}

/**
 * Convert HH:MM string to minutes since midnight.
 */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

/**
 * Convert clock minutes to "business day minutes" — minutes since daily reset (03:30).
 * This makes times after midnight (00:00–03:29) sort AFTER evening times (20:00–23:59)
 * within the same business day.
 *
 * Examples (reset at 03:30 = 210):
 *   03:30 →   0 (start of business day)
 *   09:00 → 330
 *   20:00 → 990
 *   23:59 → 1229
 *   00:00 → 1230  (after midnight, same business day)
 *   01:30 → 1320
 *   03:29 → 1439 (end of business day)
 */
export function toBizDayMinutes(clockMinutes: number): number {
  if (clockMinutes >= DAILY_RESET_MINUTES) {
    return clockMinutes - DAILY_RESET_MINUTES;
  }
  // Before reset = late night, wraps to end of business day
  return (24 * 60 - DAILY_RESET_MINUTES) + clockMinutes;
}

/**
 * Check if the pickup window has expired.
 *
 * Compares current time vs end time in "business day" space so that
 * after-midnight end times (e.g., 01:30) are treated as later than
 * evening times (e.g., 23:00). This relies on the caller-side
 * validation (`validateBizDayWindow`) to reject any window that
 * straddles the 03:30 reset — without that guarantee the biz-day
 * comparison can produce nonsensical results.
 *
 * @param pickupEnd - End time as "HH:MM"
 * @param timezone - IANA timezone string (default: Africa/Tunis)
 * @returns true if the current time is past pickupEnd in the business day
 */
export function isPickupExpiredInTz(pickupEnd: string | undefined | null, timezone?: string): boolean {
  if (!pickupEnd) return false;
  const endMinutes = timeToMinutes(pickupEnd);
  if (endMinutes < 0) return false;
  const now = getNowInBusinessTz(timezone);
  const nowMinutes = now.hours * 60 + now.minutes;

  return toBizDayMinutes(nowMinutes) > toBizDayMinutes(endMinutes);
}

/**
 * Format a Date as YYYY-MM-DD in the business timezone.
 */
export function formatDateInBusinessTz(date: Date, timezone?: string): string {
  const tz = timezone || DEFAULT_BUSINESS_TZ;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
  } catch {
    return date.toISOString().split('T')[0];
  }
}

/**
 * Return the BUSINESS-DAY date (YYYY-MM-DD) for a given timestamp. The business
 * day runs 03:30 → 03:29 the next day in the business timezone, so:
 *   Nov 14 23:00 → "2026-11-14"
 *   Nov 15 02:00 → "2026-11-14"   (still in Nov 14's business day)
 *   Nov 15 04:00 → "2026-11-15"   (new business day)
 *
 * Implemented by shifting the timestamp back by the reset offset (03:30) before
 * formatting — times before 03:30 land on the previous calendar day.
 */
export function getBusinessDayDateStr(date: Date, timezone?: string): string {
  const shifted = new Date(date.getTime() - DAILY_RESET_MINUTES * 60 * 1000);
  return formatDateInBusinessTz(shifted, timezone);
}

/**
 * Check if the pickup window is currently open (between start and end).
 * Mirrors `isPickupExpiredInTz` — relies on `validateBizDayWindow` to
 * keep saved windows inside a single biz day.
 */
export function isPickupWindowOpenInTz(
  pickupStart: string | undefined | null,
  pickupEnd: string | undefined | null,
  timezone?: string
): boolean {
  if (!pickupStart || !pickupEnd) return true;
  const endMinutes = timeToMinutes(pickupEnd);
  if (endMinutes < 0) return true;
  const now = getNowInBusinessTz(timezone);
  const nowMinutes = now.hours * 60 + now.minutes;
  return toBizDayMinutes(nowMinutes) <= toBizDayMinutes(endMinutes);
}

/**
 * Validate a pickup window so it (a) has non-zero duration and (b) fits
 * inside ONE business day (03:30 → 03:29 next morning) — i.e. it does
 * not straddle the daily reset at 03:30.
 *
 * Returns one of three statuses so the caller can render the matching
 * translated message:
 *   - `ok`        : valid
 *   - `zero`      : start === end
 *   - `crosses-reset` : the window includes the 03:30 boundary
 *
 * The biz-day math is symmetric: a window fits one biz day iff
 *   toBizDayMinutes(end) > toBizDayMinutes(start)
 * Anything that crosses 03:30 produces `eBiz <= sBiz`.
 */
export type PickupWindowError = 'ok' | 'zero' | 'crosses-reset';

export function validateBizDayWindow(startStr: string, endStr: string): PickupWindowError {
  const s = timeToMinutes(startStr);
  const e = timeToMinutes(endStr);
  if (s < 0 || e < 0) return 'zero'; // treat unparseable as zero — same UX
  if (s === e) return 'zero';
  if (toBizDayMinutes(e) <= toBizDayMinutes(s)) return 'crosses-reset';
  return 'ok';
}
