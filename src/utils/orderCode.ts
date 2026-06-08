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
  let n = typeof id === 'string' ? parseInt(id, 10) : id;
  if (!Number.isFinite(n) || n <= 0) {
    // Non-numeric id (e.g. the demo order id 'demo-order-customer'). Derive a
    // stable numeric seed from the string so it still renders as a realistic
    // "BK-XXXXX" code instead of leaking the raw id text into the UI.
    const s = String(id);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (((h * 31) + s.charCodeAt(i)) >>> 0);
    n = (h % MOD) + 1; // keep it positive so the scramble below runs
  }
  const scrambled = (((n ^ SECRET) >>> 0) * PRIME) >>> 0;
  const masked = scrambled & MOD;
  const code = masked.toString(36).toUpperCase().padStart(5, '0');
  return `BK-${code}`;
}
