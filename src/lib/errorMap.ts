/**
 * Maps backend error messages/keys to i18n translation keys.
 * Falls back to the raw message if no mapping exists.
 *
 * Keep in sync with backend error strings in routes/auth.js & routes/reservations.js
 */
const ERROR_MAP: Record<string, string> = {
  // ── Auth errors ────────────────────────────────────────────────────────────
  'Invalid credentials': 'errors.invalidCredentials',
  'Invalid email or password': 'errors.invalidCredentials',
  'Invalid email format': 'errors.invalidEmail',
  'Email already registered': 'errors.emailExists',
  'Email already exists': 'errors.emailExists',
  'Phone number already registered': 'errors.phoneExists',
  'Phone already exists': 'errors.phoneExists',
  'User not found': 'errors.userNotFound',
  'Account not found': 'errors.userNotFound',
  'Invalid password': 'errors.invalidPassword',
  'Invalid or expired token': 'errors.invalidToken',
  'Reset link has expired': 'errors.invalidToken',
  'Invalid reset token': 'errors.invalidToken',
  'Invalid code': 'errors.invalidOtp',
  'Invalid OTP': 'errors.invalidOtp',
  'Code expired or not found': 'errors.otpExpired',
  'OTP expired': 'errors.otpExpired',
  'Too many failed attempts': 'errors.tooManyAttempts',
  'Please wait a minute before requesting another code': 'errors.rateLimited',
  // ── Rate-limit (429) from any endpoint ─────────────────────────────────────
  // Substring match (case-insensitive) catches the backend's full string
  // "too many requests please slow down" and its variations.
  'too many requests': 'errors.rateLimited',
  'rate limit exceeded': 'errors.rateLimited',
  'slow down': 'errors.rateLimited',
  'Password too short': 'errors.passwordTooShort',
  'Email not verified': 'errors.emailNotVerified',
  'Missing required fields': 'errors.missingFields',
  'Email/phone and password required': 'errors.missingFields',
  'Phone number is required for buyer accounts': 'errors.phoneRequired',
  'Invalid Tunisian phone number format': 'errors.invalidPhone',
  'Invalid user type': 'errors.invalidUserType',
  'Registration failed': 'errors.registrationFailed',
  'Login failed': 'errors.loginFailed',
  // Role mismatch (backend sends these for requested_type enforcement)
  'This account is registered as a business. Please switch to business mode.': 'errors.accountIsBusiness',
  'This account is registered as a customer. Please switch to customer mode.': 'errors.accountIsCustomer',
  // ── Password-reset: account existence revealed (forgot-password) ───────────
  // routes/auth.js /forgot-password now returns a French sentence + a `code`
  // when no matching account exists (or the account is OAuth-only). These
  // substring keys are mutually exclusive ("commerçant"/"client" sit between
  // "compte" and "n'est associé", so the generic key can't match a typed one)
  // and map to typed, localized messages so the modal names the account type.
  'Aucun compte commerçant': 'errors.noBusinessAccount',
  'Aucun compte client': 'errors.noCustomerAccount',
  "Aucun compte n'est associé": 'errors.noAccountFound',
  'connexion Google': 'errors.oauthGoogle',
  'connexion Apple': 'errors.oauthApple',
  // Google / Apple auth
  'Google did not return an id_token': 'errors.googleAuthFailed',
  'Token exchange failed': 'errors.googleAuthFailed',

  // ── Basket / price errors ───────────────────────────────────────────────────
  'Selling price must be at least 50%': 'errors.priceDiscount',
  'Le prix réduit doit être': 'errors.priceDiscount',
  // Custom pickup-window validation (basket PUT route). Surface the typed
  // codes so the merchant sees the actual reason instead of "connexion".
  'invalid_pickup_format': 'errors.invalidPickupFormat',
  'pickup_start_after_end': 'errors.pickupStartAfterEnd',
  'pickup_window_too_short': 'errors.pickupWindowTooShort',
  // api.ts prefers backend `message` over `error` when building err.message,
  // so the substring matcher needs to recognise the French sentence itself —
  // not just the snake_case code. Without these the validation messages from
  // routes/baskets.js fell through to the generic "Une erreur est survenue".
  "L'heure de début du retrait": 'errors.pickupStartAfterEnd',
  "L'heure de retrait personnalisée": 'errors.invalidPickupFormat',
  'Le créneau de retrait doit durer': 'errors.pickupWindowTooShort',
  // Location-hours change blocked because today's orders would have their
  // pickup window shortened. The availability.tsx onError handler renders a
  // detailed list of affected orders — this mapping is the fallback when a
  // different caller surfaces the same error through the shared helper.
  'ordered_basket_window_shortened': 'errors.locationHoursOrderConflict',

  // ── Team / multi-org errors ───────────────────────────────────────────────
  // Backend rejects a partner add when the email is already enrolled in a
  // different org. The add-member form has its own specialized alert that
  // also surfaces the conflicting org name; this entry is the fallback for
  // any other caller that surfaces backend errors through the shared map.
  'email_already_partner_elsewhere': 'errors.emailAlreadyPartnerElsewhere',
  'Cet email est déjà associé à un autre commerce': 'errors.emailAlreadyPartnerElsewhere',
  // Same-org / same-email-elsewhere edge cases — the users-table unique
  // constraint fires for an email that already exists as ANY type, and the
  // location-membership uniqueness fires when the same person is re-added
  // to the same location. Both surfaced as generic before this mapping.
  'Un utilisateur avec cet email ou téléphone existe déjà': 'errors.addMemberAccountExists',
  'Cet utilisateur est déjà membre de cet emplacement': 'errors.alreadyMemberHere',
  "Échec de l'ajout du membre": 'errors.addMemberFailed',

  // ── Reservation errors ─────────────────────────────────────────────────────
  'Restaurant is paused': 'errors.restaurantPaused',
  'No baskets available': 'errors.noBaskets',
  'Not enough baskets available': 'errors.noBaskets',
  'Already reserved today': 'errors.alreadyReserved',
  'Pickup time expired': 'errors.pickupExpired',
  'Pickup time has expired for today': 'errors.pickupExpired',
  'Reservation not found': 'errors.reservationNotFound',
  'Not authorized to view this reservation': 'errors.forbidden',
  'Maximum 20 baskets per order': 'errors.maxQuantity',
  'Invalid or expired code': 'errors.otpExpired',
  'Solde insuffisant': 'errors.insufficientCredits',
  'Prix du panier indisponible': 'errors.basketPriceUnavailable',
  'This location is paused today': 'errors.locationPaused',
  'This location is closed today': 'errors.locationClosed',
  'Code de retrait invalide': 'errors.invalidPickupCode',

  // ── Generic / network ──────────────────────────────────────────────────────
  'Unauthorized': 'errors.unauthorized',
  'Authorization required': 'errors.unauthorized',
  'No token': 'errors.unauthorized',
  'Forbidden': 'errors.forbidden',
  'Not found': 'errors.notFound',
  'Internal server error': 'errors.serverError',
  'Network Error': 'errors.networkError',
  'timeout of 15000ms exceeded': 'errors.timeout',
  'An unexpected error occurred': 'errors.serverError',

  // ── Technical / infrastructure (substring matches, case-insensitive) ───────
  // These should NEVER reach the user as-is — they read like the app is broken.
  // Map them to friendly "session expired" / "unavailable" / "network" copy.
  'jwt': 'errors.sessionExpired',
  'session expired': 'errors.sessionExpired',
  'invalid signature': 'errors.sessionExpired',
  'malformed': 'errors.sessionExpired',
  'token not authorized': 'errors.unavailable',
  'not authorized for this app': 'errors.unavailable',
  'token expired': 'errors.sessionExpired',
  'invalid token': 'errors.sessionExpired',
  'service unavailable': 'errors.unavailable',
  'temporarily unavailable': 'errors.unavailable',
  'endpoint not found': 'errors.unavailable',
  'network request failed': 'errors.networkError',
  'failed to fetch': 'errors.networkError',
  'econnaborted': 'errors.timeout',
  'econnrefused': 'errors.networkError',
  'timeout': 'errors.timeout',
  'request failed with status code 5': 'errors.serverError',
  'internal server': 'errors.serverError',

  // ── Profile errors ─────────────────────────────────────────────────────────
  // 'Phone number already registered' is also surfaced by PUT /api/users/profile
  // when the unique users_phone_key index fires — it's already mapped above
  // alongside the auth-side phone-conflict entries.
  'Failed to update user profile': 'errors.profileUpdateFailed',

  // ── Location / team management ────────────────────────────────────────────
  'Failed to update location': 'errors.locationUpdateFailed',
  'Failed to add location': 'errors.locationAddFailed',
  'Failed to remove location': 'errors.locationDeleteFailed',
  'Non autorisé à modifier cet emplacement': 'errors.forbidden',
  'Only the owner can remove locations': 'errors.forbidden',
  "Seul l'admin de l'organisation peut ajouter un emplacement": 'errors.forbidden',
};

export function mapErrorToI18nKey(message: string): string | null {
  // Direct match
  if (ERROR_MAP[message]) return ERROR_MAP[message];
  // Case-insensitive partial match
  const lowerMsg = message.toLowerCase();
  for (const [key, value] of Object.entries(ERROR_MAP)) {
    if (lowerMsg.includes(key.toLowerCase())) return value;
  }
  return null;
}
