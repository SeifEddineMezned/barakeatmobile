/**
 * Derive two-letter initials from a full name, used by every avatar circle
 * in the app (Settings identity card, Leaderboard rows, Conversations rows…).
 *
 * Rules:
 *   - Empty / unknown → "?"
 *   - One name part        → first letter only         ("Sami"              → "S")
 *   - Two+ name parts      → first letter of FIRST + first letter of LAST
 *                            ("Mohamed Ali Gharbi"    → "MG", not "MA" / "MAG")
 *   - Uppercased
 *
 * The "first + last" rule (skipping middle names) is deliberate: in Tunisian
 * naming a middle name is almost always a patronymic ("Mohamed Ali Gharbi" →
 * "Mohamed son-of-Ali, family Gharbi"). The family name carries the identity,
 * so the initials avatar should highlight that, not the middle middle.
 */
export function deriveInitials(name?: string | null): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}
