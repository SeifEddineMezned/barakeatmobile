/**
 * Maps backend error messages/keys to i18n translation keys.
 * Falls back to the raw message if no mapping exists.
 */
const ERROR_MAP: Record<string, string> = {
  // Auth errors
  'Invalid email format': 'errors.invalidEmail',
  'Invalid email or password': 'errors.invalidCredentials',
  'Email already exists': 'errors.emailExists',
  'Phone already exists': 'errors.phoneExists',
  'User not found': 'errors.userNotFound',
  'Invalid password': 'errors.invalidPassword',
  'Invalid or expired token': 'errors.invalidToken',
  'Invalid OTP': 'errors.invalidOtp',
  'OTP expired': 'errors.otpExpired',
  'Password too short': 'errors.passwordTooShort',
  'Email not verified': 'errors.emailNotVerified',
  // Reservation errors
  'Restaurant is paused': 'errors.restaurantPaused',
  'No baskets available': 'errors.noBaskets',
  'Already reserved today': 'errors.alreadyReserved',
  'Pickup time expired': 'errors.pickupExpired',
  'Reservation not found': 'errors.reservationNotFound',
  // Generic
  'Unauthorized': 'errors.unauthorized',
  'Forbidden': 'errors.forbidden',
  'Not found': 'errors.notFound',
  'Internal server error': 'errors.serverError',
  'Network Error': 'errors.networkError',
  'timeout of 15000ms exceeded': 'errors.timeout',
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
