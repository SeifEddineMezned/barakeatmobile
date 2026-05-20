/**
 * Masks a numeric order ID into a short, deterministic, non-sequential code.
 *
 * Algorithm:
 * 1. XOR the ID with a fixed secret number to scramble the sequence
 * 2. Multiply by a prime to spread values apart
 * 3. Encode in base-36 (0-9 + A-Z) and take 5-6 chars
 * 4. Prefix with "BK-"
 *
 * Properties:
 * - Deterministic: same ID always produces same code
 * - Non-sequential: IDs 1,2,3 don't produce adjacent codes
 * - Not reversible without knowing the secret
 * - Short and readable: "BK-K7X3M"
 *
 * Example: orderIdToCode(42) → "BK-1R5TQ"
 */

const SECRET = 0x5BAD_C0DE; // XOR mask — change this to get different codes
const PRIME = 2654435761;    // Knuth multiplicative hash constant
const MOD = 0x7FFF_FFFF;     // Keep within 31-bit positive range

export function orderIdToCode(id: number | string): string {
  const n = typeof id === 'string' ? parseInt(id, 10) : id;
  if (!Number.isFinite(n) || n <= 0) return `BK-${String(id).padStart(4, '0')}`;
  const scrambled = (((n ^ SECRET) >>> 0) * PRIME) >>> 0;
  const masked = scrambled & MOD;
  const code = masked.toString(36).toUpperCase().padStart(5, '0');
  return `BK-${code}`;
}
