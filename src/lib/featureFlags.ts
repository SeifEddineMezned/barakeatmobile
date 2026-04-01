/**
 * Feature flags — controls every major feature in the app.
 * Set to true to enable, false to disable.
 * See March_21_fixes.md (project root) for full specs.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🥚 EASTER EGGS (search "EASTER EGG" in codebase to find them)
 *
 *  ENABLE_MAP_EASTER_EGG
 *    → On the Nearby map, zoom out far enough that all restaurants
 *      are visible at once. Animated lines connect the pins forming
 *      a star constellation. Popup: "🌟 You found the Barakeat
 *      Constellation! +50 XP". Fires once per session.
 *    → File: app/(tabs)/nearby.tsx
 *
 *  ENABLE_LOGO_TAP_EASTER_EGG
 *    → On the business dashboard, tap the "Barakeat." logo pill
 *      5 times quickly. Triggers a Lottie confetti burst and shows
 *      a random fun fact about food waste in Tunisia.
 *    → File: app/(business)/dashboard.tsx
 *
 *  ENABLE_LUCKY_DIP
 *    → After a successful reservation, there is a 5% random chance
 *      a "🎁 Lucky Dip!" banner appears with a small bonus discount
 *      code for the user's next order. Purely delightful surprise.
 *    → File: app/reserve.tsx
 *
 *  ENABLE_TIME_BADGES
 *    → Placing an order before 09:00 auto-awards the "Early Bird" 🌅
 *      badge. Placing one after 20:00 awards "Night Owl" 🦉.
 *      Checked server-side on reservation creation.
 *    → File: backend/routes/reservations.js (POST /)
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
export const FeatureFlags = {
  // ── Core live features ───────────────────────────────────────────────────
  ENABLE_PICKUP_INSTRUCTIONS: true,
  ENABLE_BASKET_PERSONALIZATION: true,
  ENABLE_COMMUNITY_BASKETS: true,
  ENABLE_GAMIFICATION: true,
  ENABLE_BADGES: true,
  ENABLE_LEADERBOARD: true,
  ENABLE_PROFILE_TAB: true,
  ENABLE_MAP_VIEW: true,
  ENABLE_TEAM: true,
  ENABLE_MULTIPLE_BASKETS: true,
  ENABLE_NOTIFICATIONS: true,
  ENABLE_REVIEWS: true,
  ENABLE_REPORTS: true,

  // ── B1: Cross-platform (iOS + Android) fixes ────────────────────────────
  // Uses useSafeAreaInsets() everywhere instead of hardcoded Platform values.
  ENABLE_CROSS_PLATFORM_FIXES: true,

  // ── B2: App Store & Google Play compliance ───────────────────────────────
  // Adds: ToS checkbox on sign-up, Privacy Policy link, Delete Account button,
  // global ErrorBoundary so crashes show a friendly screen instead of a red box.
  ENABLE_APP_STORE_COMPLIANCE: true,

  // ── B3: Team management v2 ──────────────────────────────────────────────
  // Redesigned team screen: onboarding card for new teams, role presets
  // ("Full Access" / "Orders Only" / "View Only"), cleaner member cards with
  // avatar initials, location badge pill, and quick-action row.
  ENABLE_TEAM_MANAGEMENT_V2: true,

  // ── B4: AI menu photo scanner ────────────────────────────────────────────
  // "Scan Menu" button in menu-items screen → pick a photo of a menu →
  // Claude reads the items → checkbox review modal → bulk-add to menu.
  // ⚠️  Requires ANTHROPIC_API_KEY in backend .env to work.
  ENABLE_AI_MENU_SCANNER: true,

  // ── B5: AI basket content & pricing suggestions ──────────────────────────
  // ✨ "Suggest" button in create-basket screen → Claude suggests a catchy
  // name, description, and a recommended price based on restaurant category.
  // ⚠️  Requires ANTHROPIC_API_KEY in backend .env to work.
  ENABLE_AI_BASKET_SUGGESTIONS: true,

  // ── B6: Easter eggs ──────────────────────────────────────────────────────
  // Master toggle — set false to silently disable ALL easter eggs at once.
  ENABLE_EASTER_EGGS: true,

  // 🥚 See header comment above for full descriptions of each egg.
  ENABLE_MAP_EASTER_EGG: true,       // Nearby map constellation
  ENABLE_LOGO_TAP_EASTER_EGG: true,  // Business dashboard logo × 5 taps
  ENABLE_LUCKY_DIP: true,            // 5% bonus discount after reservation
  ENABLE_TIME_BADGES: true,          // Early Bird 🌅 / Night Owl 🦉 badges

  // ── B7: Animations v2 ────────────────────────────────────────────────────
  // Skeleton loaders on all loading states, staggered list entrances,
  // card micro-interactions (heart pulse, price wiggle), Lottie confetti on
  // first completed order, enhanced tab bar bounce.
  ENABLE_ANIMATIONS_V2: true,

  // ── B8: Profile stat detail modals ──────────────────────────────────────
  // Tap any stat box on the customer profile to get a full breakdown:
  // Spots Tried → list of visited restaurants | Money Saved → monthly chart |
  // CO₂ → environmental equivalents | Streak → calendar view | etc.
  ENABLE_PROFILE_DETAIL_MODALS: true,

  // ── Team org chart view ──────────────────────────────────────────────────
  // Second view mode in team management: org shown as a central circle with
  // member circles animating outward around it on a dark (#114b3c) canvas.
  // Toggle the view with the grid/chart button in the team screen header.
  ENABLE_TEAM_ORG_CHART: true,

  // ── Payment ──────────────────────────────────────────────────────────────
  ENABLE_CARD_PAYMENT: false,  // Card payment at checkout — enable when payment provider is integrated

  // ── Previously disabled ──────────────────────────────────────────────────
  ENABLE_MAX_PER_CUSTOMER: false,  // Per-basket cap on how many a single customer can reserve
  ENABLE_GROWING_TREE: false,
  ENABLE_SPLASH_ANIMATION: false,
  IS_PROTOTYPE: false,
} as const;

export type FeatureFlag = keyof typeof FeatureFlags;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FeatureFlags[flag] ?? false;
}
