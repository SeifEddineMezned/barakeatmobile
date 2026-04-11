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
  // Google / Apple auth
  'Google did not return an id_token': 'errors.googleAuthFailed',
  'Token exchange failed': 'errors.googleAuthFailed',

  // ── Basket / price errors ───────────────────────────────────────────────────
  'Selling price must be at least 50%': 'errors.priceDiscount',
  'Le prix réduit doit être': 'errors.priceDiscount',

  // ── Reservation errors ─────────────────────────────────────────────────────
  'Restaurant is paused': 'errors.restaurantPaused',
  'No baskets available': 'errors.noBaskets',
  'Already reserved today': 'errors.alreadyReserved',
  'Pickup time expired': 'errors.pickupExpired',
  'Reservation not found': 'errors.reservationNotFound',

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
