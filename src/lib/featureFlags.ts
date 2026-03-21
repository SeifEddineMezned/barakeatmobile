/**
 * Feature flags matching the website's featureFlags.js
 * These can later be driven by a remote config service
 */
export const FeatureFlags = {
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
  // Disabled features
  ENABLE_GROWING_TREE: false,
  ENABLE_SPLASH_ANIMATION: false,
  IS_PROTOTYPE: false,
} as const;

export type FeatureFlag = keyof typeof FeatureFlags;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FeatureFlags[flag] ?? false;
}
