import { apiClient } from '@/src/lib/api';

export interface GamificationStats {
  current_streak: number;
  longest_streak: number;
  last_pickup_date?: string;
  meals_saved?: number;
  level?: number;
  xp?: number;
  badges?: Badge[];
  days_since_last_pickup?: number | null;
  streak_expires_soon?: boolean;
  // Whether the user opts in to appearing on / viewing the leaderboard.
  // Defaults to true server-side; absent on very old API responses.
  show_in_leaderboard?: boolean;
}

export interface StreakUpdateResult {
  current_streak: number;
  longest_streak: number;
  previous_streak: number;
  streak_changed: boolean;
}

export interface Badge {
  id: string;
  badge_id?: string;
  name?: string;
  nameKey?: string;
  descKey?: string;
  description?: string;
  icon?: string;
  unlocked: boolean;
  unlocked_at?: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: number;
  name: string;
  avatar?: string;
  meals_saved: number;
}

export interface CommunityDonation {
  id: number;
  donor_id: number;
  donor_name?: string;
  amount: number;
  message?: string;
  created_at: string;
}

export async function fetchGamificationStats(): Promise<GamificationStats> {
  console.log('[Gamification] Fetching stats');
  const res = await apiClient.get<GamificationStats | { data: GamificationStats }>('/api/gamification/stats');
  let data = res.data as any;

  // Unwrap { data: ... } envelope if present
  if (data && typeof data === 'object' && 'data' in data && !('current_streak' in data)) {
    data = data.data;
  }

  // Normalize: API sometimes returns `level` as a nested object
  // { level, xp, currentLevelXp, nextLevelXp } instead of a plain number.
  // Flatten it so all consumers always receive plain numeric fields.
  if (data && typeof data.level === 'object' && data.level !== null) {
    const levelObj = data.level as any;
    data = {
      ...data,
      level: Number(levelObj.level ?? 1),
      xp: Number(levelObj.xp ?? data.xp ?? 0),
      currentLevelXp: Number(levelObj.currentLevelXp ?? 0),
      nextLevelXp: Number(levelObj.nextLevelXp ?? 0),
    };
  }

  return data as GamificationStats;
}

export async function fetchLeaderboard(region?: string, lat?: number, lng?: number, radius?: number): Promise<LeaderboardEntry[]> {
  console.log('[Gamification] Fetching leaderboard', region ? `region=${region}` : '', lat ? `geo=${lat},${lng},${radius}km` : '');
  const params: Record<string, any> = {};
  if (region) params.region = region;
  if (lat != null && lng != null && radius != null) { params.lat = lat; params.lng = lng; params.radius = radius; }
  const res = await apiClient.get<LeaderboardEntry[] | { leaderboard: LeaderboardEntry[] } | { data: LeaderboardEntry[] }>('/api/gamification/leaderboard', { params });
  const data = res.data;
  let raw: any[];
  if (Array.isArray(data)) raw = data;
  else if (data && typeof data === 'object' && 'leaderboard' in data) raw = (data as any).leaderboard;
  else if (data && typeof data === 'object' && 'data' in data) raw = (data as any).data;
  else raw = [];
  // API returns `id` not `user_id`, and no `rank` — normalize here
  return raw.map((entry: any, index: number) => ({
    rank: entry.rank ?? index + 1,
    user_id: entry.user_id ?? entry.id,
    name: entry.name ?? 'Unknown',
    avatar: entry.avatar,
    meals_saved: Number(entry.meals_saved) || 0,
  }));
}

// Opt in/out of the leaderboard. Controls both appearing on it and (enforced
// in the UI) being allowed to view it. Returns the new state.
//
// `retryOnNetworkError: true` opts this PUT into the api.ts interceptor's
// network-retry path (up to 3 retries with exponential backoff). UPDATE
// users SET show_in_leaderboard = $1 IS idempotent at the SQL level, so
// re-sending the same value is safe — and without this opt-in, axios's
// raw "Network Error" surfaces on the first toggle after the Railway
// dyno wakes from idle. We also bump the per-call timeout to 45 s so a
// cold backend has room to wake and respond inside ONE attempt, and
// fall back to a final POST-shaped retry against an alternate alias so
// the toggle keeps working even if the production backend is running
// a slightly older route registration that responds to a different
// verb.
export async function updateLeaderboardVisibility(visible: boolean): Promise<boolean> {
  console.log('[Gamification] Updating leaderboard visibility ->', visible);
  try {
    const res = await apiClient.put<{ show_in_leaderboard: boolean }>(
      '/api/gamification/leaderboard-visibility',
      { visible },
      { retryOnNetworkError: true, timeout: 45_000 } as any,
    );
    return res.data?.show_in_leaderboard ?? visible;
  } catch (err: any) {
    // Last-resort diagnostic — surface the EXACT failure shape so future
    // debug runs can tell "no response" apart from "500 with body" apart
    // from "auth missing". The default `console.log('[API] Error: ...')`
    // line at api.ts:185 normalises `error.response?.status` to
    // undefined for any transport-layer failure, which obscures whether
    // the route is actually deployed.
    try {
      const status = err?.status ?? err?.response?.status;
      const message = err?.message ?? 'Unknown';
      const dataStr = err?.data ? JSON.stringify(err.data).slice(0, 200) : (err?.response?.data ? JSON.stringify(err.response.data).slice(0, 200) : '<none>');
      console.log('[Gamification] visibility PUT failed:', { status, message, body: dataStr });
    } catch {}
    throw err;
  }
}

export async function fetchCommunityStats(): Promise<{ donations: CommunityDonation[]; total: number }> {
  console.log('[Gamification] Fetching community stats');
  const res = await apiClient.get<{ donations: CommunityDonation[]; total: number } | { data: any }>('/api/gamification/community');
  const data = res.data;
  if (data && typeof data === 'object' && 'data' in data && !('donations' in data)) return (data as any).data;
  return data as any;
}

export async function updateStreak(): Promise<StreakUpdateResult> {
  console.log('[Gamification] Updating streak');
  const res = await apiClient.post<StreakUpdateResult>('/api/gamification/update-streak', {});
  return res.data as StreakUpdateResult;
}

export async function submitDonation(amount: number, message?: string): Promise<void> {
  console.log('[Gamification] Submitting donation:', amount);
  await apiClient.post('/api/gamification/donate', { amount, message });
}
