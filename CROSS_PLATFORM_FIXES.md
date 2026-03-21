# Cross-Platform Fixes Applied

This document lists all cross-platform fixes applied to the Barakeat mobile app.
If you need to rollback any of these changes, provide this file and specify which fix to revert.

## Fix 1: app.json — Added expo-image-picker and expo-location plugins

**File:** `app.json`
**What changed:** Added `expo-image-picker` (with camera/photo permissions) and `expo-location` (with location permission) to the plugins array.
**Why:** These native modules require plugin declarations for iOS/Android builds. Without them, image picker and location services fail on native builds.
**To rollback:** Remove the `expo-image-picker` and `expo-location` entries from `app.json` → `plugins` array.

## Fix 2: KeyboardAvoidingView behavior standardized

**Files:** `app/auth/sign-in.tsx`, `app/auth/sign-up.tsx`, `app/auth/forgot-password.tsx`, `app/review.tsx`, `app/business/create-basket.tsx`, `app/business/scan-qr.tsx`
**What changed:** Ensured all KeyboardAvoidingView components use `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`.
**Why:** iOS requires 'padding' behavior, Android works best with 'height'. Using 'undefined' on Android causes keyboard overlap issues.
**To rollback:** No functional reason to rollback. If needed, revert behavior prop to original values per file.

## Fix 3: Linking import fixed in ReservationCard

**File:** `src/components/ReservationCard.tsx`
**What changed:** Moved `Linking` from dynamic `require('react-native').Linking` inside handler to a top-level import.
**Why:** Dynamic require is an anti-pattern that can cause issues with bundlers, tree-shaking, and hot reload. Top-level imports are the standard React Native pattern.
**To rollback:** Move `Linking` back to a dynamic require inside `handleDirections`.

## Fix 4: Tab header height reduced

**File:** `app/(tabs)/_layout.tsx`
**What changed:** Set `headerStyle: { backgroundColor: theme.colors.bg, height: 44 }` to reduce the empty space at the top.
**Why:** The default header height was too large, creating unnecessary whitespace above the tab content.
**To rollback:** Remove `height: 44` from headerStyle.

## Notes

- The iOS native folder (`ios/`) needs to be generated before building. Run: `npx expo prebuild --clean`
- For Android maps, you need a Google Maps API key in `app.json` under `android.config.googleMaps.apiKey`
- Arabic (RTL) language switching requires an app restart on iOS — this is expected React Native behavior
