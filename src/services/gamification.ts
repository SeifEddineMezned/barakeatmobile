import { apiClient } from '@/src/lib/api';

export interface GamificationStats {
  current_streak: number;
  longest_streak: number;
  last_pickup_date?: string;
  meals_saved?: number;
  level?: number;
  xp?: number;
  badges?: Badge[];
}

export interface Badge {
  id: string;
  badge_id: string;
  name?: string;
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
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'leaderboard' in data) return (data as any).leaderboard;
  if (data && typeof data === 'object' && 'data' in data) return (data as any).data;
  return [];
}

export async function fetchCommunityStats(): Promise<{ donations: CommunityDonation[]; total: number }> {
  console.log('[Gamification] Fetching community stats');
  const res = await apiClient.get<{ donations: CommunityDonation[]; total: number } | { data: any }>('/api/gamification/community');
  const data = res.data;
  if (data && typeof data === 'object' && 'data' in data && !('donations' in data)) return (data as any).data;
  return data as any;
}

export async function submitDonation(amount: number, message?: string): Promise<void> {
  console.log('[Gamification] Submitting donation:', amount);
  await apiClient.post('/api/gamification/donate', { amount, message });
}
