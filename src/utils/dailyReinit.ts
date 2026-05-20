// Compute today's daily reinit target for a basket. When a per-day schedule
// is stored on the basket (JSONB `daily_reinit_schedule`), we honour today's
// value — otherwise we fall back to the flat `daily_reinitialization_quantity`.
// This mirrors the backend cron logic at backend/routes/cron.js so the number
// displayed in the app matches what the cron will actually reset to.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function getTodayReinitKey(date: Date = new Date()): string {
  return DAY_KEYS[date.getDay()] ?? 'mon';
}

export function effectiveDailyReinit(basket: any): number {
  if (!basket) return 0;
  const raw = basket.daily_reinit_schedule;
  let schedule: Record<string, any> | null = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) schedule = raw;
  else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) schedule = parsed;
    } catch { /* ignore */ }
  }
  if (schedule) {
    const key = getTodayReinitKey();
    const v = schedule[key];
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  const flat = Number(basket.daily_reinitialization_quantity);
  return Number.isFinite(flat) ? flat : 0;
}
