import { getBusinessDayDateStr, isPickupExpiredInTz } from './timezone';

/**
 * Single source of truth for "is this reservation row actually a
 * PENDING incoming order right now?" — used wherever a count needs
 * to match what the user sees in their incoming/upcoming list.
 *
 * Why we need this: the /location/today (business) and /my/reservations
 * (customer) endpoints intentionally return rows beyond the strict
 * "today" window — /location/today returns up to 14 days of
 * active rows for the Monday-for-Tuesday flow; /my/reservations
 * never filters by date at all. Anything that just counts
 * `status IN (confirmed, reserved, pending)` overcounts massively
 * because stale rows whose cron expiry never ran still carry
 * status='confirmed' even though their pickup day is long past.
 *
 * Accepts both flavors of row shape:
 *   • snake_case business: { status, reservation_date, created_at,
 *     pickup_end_time, pickup_end }
 *   • customer / nested: { status, reservation_date / pickup_date,
 *     created_at / createdAt, basket.pickup_end_time,
 *     restaurant.pickup_end_time, basket.pickupWindow.end,
 *     pickupWindow.end }
 *
 * Two-stage check:
 *   1. Status — must be in the active set.
 *   2. Calendar day — pickup day before today's biz day → expired.
 *      Effective day = reservation_date / pickup_date (when present)
 *      or created_at's biz day as a fallback for legacy rows from
 *      before the reservation_date column existed.
 *
 * Same-day rows ALSO check the pickup-window end time (matching the orders
 * tab's `isPickupExpiredCheck`): an order whose pickup window has already
 * closed today reads as "expired" in the orders tab, so it must NOT count as
 * an active/blocking order — otherwise account deletion (and the business
 * active-order counts) over-report orders the user can no longer act on. A
 * 5-minute grace mirrors the orders tab so a just-placed order is never
 * mis-flagged as expired by clock skew.
 */
export function isPendingReservationActive(
  row: any,
  today: string = getBusinessDayDateStr(new Date()),
): boolean {
  const status = String(row?.status ?? '').toLowerCase();
  if (status !== 'confirmed' && status !== 'reserved' && status !== 'pending') return false;

  // 5-min grace — a brand-new reservation is always active.
  const createdRaw = row?.created_at ?? row?.createdAt;
  if (createdRaw && Date.now() - new Date(createdRaw).getTime() < 5 * 60 * 1000) return true;

  const rawResDate = row?.pickup_date ?? row?.reservation_date ?? row?.reservationDate;
  const resDateStr = typeof rawResDate === 'string' && rawResDate.length >= 10
    ? rawResDate.substring(0, 10)
    : null;
  const effectiveDay = resDateStr
    ?? (createdRaw ? getBusinessDayDateStr(new Date(createdRaw)) : null);
  if (effectiveDay && effectiveDay < today) return false; // past biz day → expired
  // Same biz day: expired once the pickup window's end time has passed.
  if (effectiveDay === today) {
    const end = row?.pickup_end_time
      ?? row?.basket?.pickup_end_time
      ?? row?.restaurant?.pickup_end_time
      ?? row?.basket?.pickupWindow?.end
      ?? row?.pickupWindow?.end;
    if (end && isPickupExpiredInTz(String(end).substring(0, 5))) return false;
  }
  return true;
}
