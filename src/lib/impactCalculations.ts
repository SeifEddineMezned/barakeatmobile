/**
 * Shared impact calculation utilities.
 *
 * CO2 methodology — ReFED (Rethink Food Waste) Charity/Donation GHG factor:
 *   3.36 kg CO2e per kg of food diverted from landfill (Quantis methodology for ReFED, 2024)
 *   Source: https://docs.refed.org (via FoodMesh implementation)
 *   Assumed average Barakeat basket weight: 1 kg per basket (restaurant/bakery surprise basket)
 *   → 3.36 kg CO2e saved per basket collected
 */

/** ReFED charity/donation GHG factor: kg CO2e saved per basket collected (assumes ~1 kg food per basket) */
export const CO2_KG_PER_BASKET = 3.36;

/** XP threshold for the start of each level (index = level - 1).
 *  50 levels. Band sizes grow from 10 XP (level 1→2) to 200 XP (level 49→50).
 *  Must match backend gamification.js levels array exactly.  */
export const XP_THRESHOLDS = [
  0, 10, 24, 42, 64, 90, 119, 152, 189, 230,
  275, 324, 377, 434, 494, 558, 626, 698, 774, 854,
  938, 1026, 1117, 1212, 1311, 1414, 1521, 1632, 1747, 1866,
  1988, 2114, 2244, 2378, 2516, 2658, 2804, 2954, 3107, 3264,
  3425, 3590, 3759, 3932, 4109, 4290, 4474, 4662, 4854, 5050,
];

/**
 * CO2 saved in kg, using the ReFED methodology.
 * @param basketCount  Number of baskets successfully collected
 */
export function calcCO2Saved(basketCount: number): number {
  return basketCount * CO2_KG_PER_BASKET;
}

/**
 * Money saved in TND from a list of completed reservations (local fallback).
 * Prefers prices recorded at reservation time over current basket prices.
 */
export function calcMoneySaved(completedReservations: any[]): number {
  return completedReservations.reduce((sum, r) => {
    const qty = r.quantity ?? 1;

    // Original (full) price — prefer value recorded at reservation time
    const orig = Number(
      r.original_price_at_reservation ??
      r.original_price ??
      r.basket?.originalPrice ??
      r.basket?.original_price ??
      r.restaurant?.original_price ??
      0
    );

    // Amount paid — prefer total_price recorded at purchase (includes qty)
    const totalPaid = Number(r.total_price ?? r.total ?? 0);

    if (orig > 0 && totalPaid > 0) {
      // total_price already covers all quantity units
      return sum + Math.max(0, orig * qty - totalPaid);
    }

    // Fallback: derive from discounted unit price
    const disc = Number(
      r.basket?.discountedPrice ??
      r.basket?.price_tier ??
      r.basket?.discounted_price ??
      r.basket?.selling_price ??
      r.price_tier ??
      r.selling_price ??
      r.restaurant?.price_tier ??
      0
    );

    if (orig > 0 && disc > 0) {
      return sum + Math.max(0, (orig - disc) * qty);
    }

    return sum;
  }, 0);
}

/**
 * XP level progress breakdown using the XP_THRESHOLDS table.
 * Returns level, xpInLevel (XP earned within current level),
 * xpBandSize (XP needed for the full level), and xpProgress (0–1).
 */
export function calcLevelProgress(xp: number) {
  // Find current level: last threshold index where XP >= threshold
  let level = 1;
  for (let i = XP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= XP_THRESHOLDS[i]) {
      level = i + 1;
      break;
    }
  }

  const currentLevelThreshold = XP_THRESHOLDS[level - 1] ?? 0;
  const nextLevelThreshold = XP_THRESHOLDS[level] ?? currentLevelThreshold + 500;
  const xpInLevel = Math.max(0, xp - currentLevelThreshold);
  const xpBandSize = Math.max(1, nextLevelThreshold - currentLevelThreshold);
  const xpProgress = Math.min(1, xpInLevel / xpBandSize);

  return { level, xpInLevel, xpBandSize, xpProgress };
}
