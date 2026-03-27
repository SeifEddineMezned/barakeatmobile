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
  const data = res.data;
  if (data && typeof data === 'object' && 'data' in data && !('current_streak' in data)) return (data as any).data;
  return data as GamificationStats;
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  console.log('[Gamification] Fetching leaderboard');
  const res = await apiClient.get<LeaderboardEntry[] | { leaderboard: LeaderboardEntry[] } | { data: LeaderboardEntry[] }>('/api/gamification/leaderboard');
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
