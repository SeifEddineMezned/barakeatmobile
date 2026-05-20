// Display-only rate: wallet balances and prices are stored in TND (the DB-native
// currency), but the UI presents everything as a larger "credit" unit so a 12 DT
// basket reads as 120 credits. The backend does NOT multiply by this for balance
// math — deductions and refunds happen in TND — this constant is purely a
// mobile-side display tool. Keep it in sync with backend/config/featureFlags.js.
export const CREDITS_PER_DT = 10;

export const dtToCredits = (dt: number): number => Math.round(dt * CREDITS_PER_DT);
