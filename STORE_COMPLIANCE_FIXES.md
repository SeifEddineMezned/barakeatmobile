# App Store & Google Play Compliance Fixes — Changelog

All changes made to pass Apple App Store Review Guidelines and Google Play Developer Policies.

---

## CRITICAL FIXES (Would cause rejection)

### 1. Sign in with Apple — IMPLEMENTED
- **Policy:** Apple Review Guideline 4.8 — required when offering third-party login (Google OAuth)
- **Files changed:**
  - `app/auth/sign-in.tsx` — Added Apple Sign-In button (iOS only), handler with AppleAuthentication API
  - `src/services/auth.ts` — Added `loginWithApple()` API call to `/api/auth/apple`
  - `app.json` — Added `expo-apple-authentication` plugin, `usesAppleSignIn: true`
  - `package.json` — Added `expo-apple-authentication@~8.0.8`
  - `src/i18n/locales/en.json` — Added `auth.continueWithApple`, `auth.appleAuthError`
  - `src/i18n/locales/fr.json` — Added French translations
  - `src/i18n/locales/ar.json` — Added Arabic translations
- **Backend required:** POST `/api/auth/apple` endpoint accepting `{ identityToken, fullName }`

### 2. Account Deletion — IMPLEMENTED
- **Policy:** Apple Guideline 5.1.1(v) & Google Play Data Deletion Policy
- **Files changed:**
  - `app/settings.tsx` — Replaced "Coming Soon" alert with a real two-step confirmation flow that calls the API, clears session, and redirects to sign-in
  - `src/services/auth.ts` — Added `deleteAccount()` function calling `DELETE /api/auth/account`
  - `src/i18n/locales/en.json` — Added `profile.deleteAccountFinalTitle`, `profile.deleteAccountFinalDesc`, `profile.deleteAccountConfirmButton`
  - `src/i18n/locales/fr.json` — Added French translations
  - `src/i18n/locales/ar.json` — Added Arabic translations
- **Backend required:** DELETE `/api/auth/account` endpoint that deletes user and all associated data

### 3. Privacy Policy, Terms of Service, Cookies Policy — IMPLEMENTED
- **Policy:** Apple Guideline 5.1.1 & Google Play — must be accessible within the app
- **Files changed:**
  - `app/settings.tsx` — Replaced placeholder "Content will be added soon" with actual legal content rendered in a scrollable modal
  - `src/i18n/locales/en.json` — Added full `legal.privacyContent`, `legal.termsContent`, `legal.cookiesContent`
  - `src/i18n/locales/fr.json` — Added French translations of all legal documents
  - `src/i18n/locales/ar.json` — Added Arabic translations of all legal documents
- **Note:** These are in-app documents. You also need to host the Privacy Policy at a public URL and provide it during store submission.

### 4. Removed Unused RECORD_AUDIO Permission — FIXED
- **Policy:** Both stores — requesting permissions your app doesn't use causes rejection
- **Files changed:**
  - `app.json` — Removed `android.permission.RECORD_AUDIO` from permissions array
  - `android/app/src/main/AndroidManifest.xml` — Removed `RECORD_AUDIO` permission line
- **No audio recording feature exists in the app**

### 5. Data Safety Declarations — PREPARED
- **Policy:** Both stores require detailed data collection declarations
- **Files created:**
  - `DATA_SAFETY.md` — Complete guide for filling out Apple App Privacy labels and Google Play Data Safety section, listing all data types collected, shared, and retained

---

## HIGH PRIORITY FIXES

### 6. Bundle Identifier / Package Name — CHANGED
- **Issue:** Was using `app.rork.*` which doesn't match Barakeat branding
- **Files changed:**
  - `app.json` — iOS bundleIdentifier: `tn.barakeat.app`, Android package: `tn.barakeat.app`
  - `android/app/build.gradle` — namespace and applicationId changed to `tn.barakeat.app`
  - `android/app/src/main/java/.../MainActivity.kt` — Package declaration updated
  - `android/app/src/main/java/.../MainApplication.kt` — Package declaration updated
  - `android/app/src/main/AndroidManifest.xml` — Deep link scheme changed to `barakeat`
- **WARNING:** These Kotlin files are still in the old directory path `app/rork/barakeat_surprise_baskets/`. After running `npx expo prebuild --clean`, they will be regenerated in the correct directory.

### 7. URL Scheme — CHANGED
- **Issue:** Was `rork-app://` which doesn't match brand
- **Files changed:**
  - `app.json` — scheme changed to `barakeat`
  - `app.json` — router origin changed to `https://barakeat.tn/`
  - `android/app/src/main/AndroidManifest.xml` — Deep link scheme updated

### 8. Crash Reporting (Sentry) — IMPLEMENTED
- **Policy:** Google Play Android Vitals tracks crashes; you need visibility
- **Files created:**
  - `src/lib/sentry.ts` — Sentry initialization, exception capture, user tracking
- **Files changed:**
  - `app/_layout.tsx` — Added `initSentry()` call at app startup
  - `src/components/ErrorBoundary.tsx` — Now reports caught errors to Sentry via `captureException()`
  - `package.json` — Added `@sentry/react-native@~7.2.0`
- **Configuration needed:** Set `EXPO_PUBLIC_SENTRY_DSN` environment variable with your Sentry project DSN

### 9. Password Policy Consistency — FIXED
- **Issue:** Signup had no validation, settings change required only 6 chars, but reset required 8+ with complexity
- **Files changed:**
  - `app/auth/sign-up.tsx` — Added password validation: 8+ chars, uppercase, lowercase, number, special character
  - `app/settings.tsx` — Changed password change validation from 6 chars to same 8+ complex requirement
- **Now consistent:** All three flows (signup, change, reset) enforce the same strong password policy

### 10. Accessibility Labels — ADDED
- **Policy:** Apple Guideline 2.5.16, Google Play accessibility requirements
- **Files changed:** Multiple screen files (sign-in, sign-up, settings, reserve, etc.)
  - Added `accessibilityLabel`, `accessibilityRole`, `accessibilityHint` to interactive elements
  - Buttons: `accessibilityRole="button"`
  - Inputs: labeled with field purpose
  - Switches: `accessibilityRole="switch"`
  - Delete account button: fully labeled
  - Apple/Google sign-in buttons: labeled
  - Payment method cards: labeled

### 11. Export Compliance (iOS) — CONFIGURED
- **Policy:** Apple requires encryption declaration
- **Files changed:**
  - `app.json` — Added `ITSAppUsesNonExemptEncryption: false` to iOS infoPlist
- **Rationale:** App uses only standard HTTPS/TLS encryption, qualifying for exemption

---

## MEDIUM PRIORITY FIXES

### 12. Hidden Disabled Payment UI — FIXED
- **Issue:** Card payment button was shown (grayed out) even when `ENABLE_CARD_PAYMENT: false`
- **Files changed:**
  - `app/reserve.tsx` — Card payment option is now conditionally rendered only when `FeatureFlags.ENABLE_CARD_PAYMENT` is true. No confusing disabled UI shown to reviewers.

### 13. Offline Detection & Banner — IMPLEMENTED
- **Policy:** Apple Guideline 2.1 — apps must handle network errors gracefully
- **Files created:**
  - `src/hooks/useNetworkStatus.ts` — Hook using `@react-native-community/netinfo` to track connectivity
  - `src/components/OfflineBanner.tsx` — Red banner displayed at top of app when offline
- **Files changed:**
  - `app/_layout.tsx` — Added `<OfflineBanner />` in the root layout
  - `package.json` — Added `@react-native-community/netinfo@11.4.1`
  - `src/i18n/locales/en.json` — Added `offline.title`, `offline.message`, `offline.retry`
  - `src/i18n/locales/fr.json` — Added French translations
  - `src/i18n/locales/ar.json` — Added Arabic translations

### 14. App Version Display — ADDED
- **Files changed:**
  - `app/settings.tsx` — Added version display at bottom of settings: "Barakeat v1.0.0" using `expo-constants`

### 15. PKCE OAuth Security Upgrade — FIXED
- **Issue:** Google OAuth used `code_challenge_method: 'plain'` (insecure)
- **Files changed:**
  - `app/auth/sign-in.tsx` — Now uses SHA-256 PKCE (`S256`) via `expo-crypto` for secure code challenge generation
  - `buildGoogleAuthUrl()` is now `async` to support crypto digest

---

## TRANSLATION UPDATES

All new features have been translated into all three supported languages:
- **English** (`src/i18n/locales/en.json`)
- **French** (`src/i18n/locales/fr.json`)
- **Arabic** (`src/i18n/locales/ar.json`)

New translation keys added:
- `auth.continueWithApple` / `auth.appleAuthError`
- `profile.deleteAccountFinalTitle` / `profile.deleteAccountFinalDesc` / `profile.deleteAccountConfirmButton`
- `legal.privacyContent` / `legal.termsContent` / `legal.cookiesContent`
- `offline.title` / `offline.message` / `offline.retry`

---

## BACKEND ENDPOINTS REQUIRED

These new frontend features require corresponding backend endpoints:

1. **POST `/api/auth/apple`** — Apple Sign-In
   - Body: `{ identityToken: string, fullName?: string }`
   - Returns: `{ token: string, user: { id, name, email, ... } }`
   - Verifies Apple identity token, creates/finds user, returns JWT

2. **DELETE `/api/auth/account`** — Account Deletion
   - Headers: `Authorization: Bearer <token>`
   - Deletes user account and all associated data (orders, reviews, preferences, push tokens)
   - Returns: `{ success: true }`

---

## POST-FIX STEPS REQUIRED

1. **Install dependencies:** Run `npm install --legacy-peer-deps` (requires disk space)
2. **Rebuild native code:** Run `npx expo prebuild --clean` to regenerate native directories with new package name
3. **Configure Sentry:** Create a Sentry project and set `EXPO_PUBLIC_SENTRY_DSN` env var
4. **Implement backend endpoints:** `/api/auth/apple` and `DELETE /api/auth/account`
5. **Host Privacy Policy:** Upload the privacy policy to a public URL (e.g., `https://barakeat.tn/privacy`)
6. **Google Play Console:** Fill out Data Safety form using `DATA_SAFETY.md` guide
7. **App Store Connect:** Fill out App Privacy section using `DATA_SAFETY.md` guide
8. **Content Rating:** Complete IARC questionnaire (Google) and content rating form (Apple)
   - Expected rating: 4+ / Everyone (food app, no restricted content)
   - Disclose: competitive elements (leaderboard)
9. **Test Apple Sign-In:** Requires Apple Developer account with Sign in with Apple capability enabled
10. **Test on physical devices:** Apple/Google reviewers test on real devices — ensure all permissions work correctly

---

## FILES CREATED

| File | Purpose |
|------|---------|
| `src/lib/sentry.ts` | Sentry crash reporting initialization and helpers |
| `src/hooks/useNetworkStatus.ts` | Network connectivity detection hook |
| `src/components/OfflineBanner.tsx` | Offline status banner component |
| `DATA_SAFETY.md` | Guide for store data safety declarations |
| `STORE_COMPLIANCE_FIXES.md` | This changelog |

## FILES MODIFIED

| File | Changes |
|------|---------|
| `app.json` | Removed RECORD_AUDIO, changed bundle IDs, scheme, added Apple auth plugin, export compliance |
| `package.json` | Added 3 new dependencies |
| `app/auth/sign-in.tsx` | Apple Sign-In, PKCE S256, accessibility labels |
| `app/auth/sign-up.tsx` | Password validation enforcement |
| `app/settings.tsx` | Account deletion, legal content, password policy, version display |
| `app/reserve.tsx` | Hidden disabled card payment UI |
| `app/_layout.tsx` | Sentry init, OfflineBanner |
| `src/services/auth.ts` | loginWithApple(), deleteAccount() |
| `src/components/ErrorBoundary.tsx` | Sentry error reporting |
| `src/i18n/locales/en.json` | New translation keys + legal content |
| `src/i18n/locales/fr.json` | French translations for all new features |
| `src/i18n/locales/ar.json` | Arabic translations for all new features |
| `android/app/build.gradle` | Package name change |
| `android/app/src/main/AndroidManifest.xml` | Removed RECORD_AUDIO, updated scheme |
| `android/.../MainActivity.kt` | Package declaration updated |
| `android/.../MainApplication.kt` | Package declaration updated |
