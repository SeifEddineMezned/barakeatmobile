/**
 * Timezone-aware time utilities for comparing pickup times.
 *
 * Business hours are stored as HH:MM in the business's local timezone.
 * The user's device may be in a different timezone. All pickup time comparisons
 * must convert "now" to the business's timezone before comparing.
 *
 * Default timezone: Africa/Tunis (UTC+1). When we expand to other countries,
 * each location can store its own timezone and pass it here.
 */

const DEFAULT_BUSINESS_TZ = 'Africa/Tunis';

/**
 * Get the current time in the business's timezone as { hours, minutes }.
 */
export function getNowInBusinessTz(timezone?: string): { hours: number; minutes: number } {
  const tz = timezone || DEFAULT_BUSINESS_TZ;
  try {
    // Use Intl to get current time in the target timezone
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
    // Fallback: use device local time if Intl fails
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
 * Check if the pickup window has expired.
 * Compares against the business's timezone, not the device's local time.
 *
 * @param pickupEnd - End time as "HH:MM"
 * @param timezone - IANA timezone string (default: Africa/Tunis)
 * @returns true if the current time in the business timezone is past pickupEnd
 */
export function isPickupExpiredInTz(pickupEnd: string | undefined | null, timezone?: string): boolean {
  if (!pickupEnd) return false;
  const endMinutes = timeToMinutes(pickupEnd);
  if (endMinutes < 0) return false;
  const now = getNowInBusinessTz(timezone);
  const nowMinutes = now.hours * 60 + now.minutes;
  return nowMinutes > endMinutes;
}

/**
 * Check if the pickup window is currently open (between start and end).
 */
export function isPickupWindowOpenInTz(
  pickupStart: string | undefined | null,
  pickupEnd: string | undefined | null,
  timezone?: string
): boolean {
  if (!pickupStart || !pickupEnd) return true; // No window = always open
  const endMinutes = timeToMinutes(pickupEnd);
  if (endMinutes < 0) return true;
  const now = getNowInBusinessTz(timezone);
  const nowMinutes = now.hours * 60 + now.minutes;
  return nowMinutes <= endMinutes;
}
