# Data Safety & Export Compliance — Barakeat App

Use this document when filling out the Google Play Data Safety section and Apple App Privacy (nutrition labels).

---

## Data Types Collected

| Data Type | Collected | Shared | Purpose | Required |
|-----------|-----------|--------|---------|----------|
| Name | Yes | With merchants (at pickup) | Account, order fulfillment | Yes |
| Email address | Yes | No | Account, authentication | Yes |
| Phone number | Yes | No | Account, support contact | Yes |
| Password | Yes (hashed on backend) | No | Authentication | Yes |
| Approximate location | Yes (with permission) | No | Show nearby baskets | No |
| Precise location | Yes (with permission) | No | Map features, distance calc | No |
| Photos | Yes (user-uploaded) | Stored on backend | Reviews, profile pictures | No |
| Purchase history | Yes | No | Order tracking, gamification | Yes |
| Device push token | Yes | Expo push service | Notifications | No |
| App interactions | Yes | No | Gamification (XP, badges) | No |
| Food preferences | Yes | No | Personalization | No |

## Data NOT Collected

- Financial/payment info (no card payments currently)
- Health data
- Browsing history
- Contact list
- Files/documents
- Calendar
- Advertising identifiers (no IDFA, no ad SDKs)
- SMS/call logs
- Audio/video recordings

## Third-Party Services

| Service | Data Shared | Purpose |
|---------|-------------|---------|
| Google OAuth | Email, name (from Google) | Authentication |
| Apple Sign-In | Email, name (from Apple) | Authentication |
| Expo Push Service | Device push token | Notifications |
| Sentry | Crash stack traces, device info | Crash reporting |
| Railway (backend host) | All API data | Backend infrastructure |

## Data Retention

- Account data: Retained while account is active
- Deleted upon account deletion request
- Push tokens: Cleared on logout
- Local storage: Cleared on app uninstall or logout

## Encryption

- **In transit:** All API communication uses HTTPS/TLS
- **At rest:** Auth tokens stored in iOS Keychain / Android EncryptedSharedPreferences via expo-secure-store
- **Export compliance:** Uses standard HTTPS encryption only — qualifies for encryption exemption (EAR 740.17(b)(1))

## Apple App Privacy Responses

For the App Store Connect privacy questionnaire:

1. **Do you or your third-party partners collect data?** Yes
2. **Contact Info collected:** Name, Email, Phone
3. **Location collected:** Precise Location (optional, with permission)
4. **User Content collected:** Photos (reviews/profile)
5. **Identifiers collected:** User ID
6. **Usage Data collected:** Product Interaction
7. **Is data linked to identity?** Yes
8. **Is data used for tracking?** No
9. **Does the app use IDFA?** No — ATT framework not required

## Google Play Data Safety Responses

1. **Does your app collect or share any of the required user data types?** Yes
2. **Is all of the user data collected encrypted in transit?** Yes
3. **Do you provide a way for users to request data deletion?** Yes (Settings > Delete Account)
4. **Data collected:** Personal info (name, email, phone), Location, Photos, App activity
5. **Data shared:** Name shared with restaurant merchants for order fulfillment only
6. **Data used for:** App functionality, personalization, account management

## Export Compliance (iOS)

- **Does your app use encryption?** Yes
- **Does your app qualify for any encryption exemptions?** Yes
- **Which exemption?** Uses only standard HTTPS/TLS for network communication
- Set `ITSAppUsesNonExemptEncryption` to `false` in Info.plist (already configured in app.json)
