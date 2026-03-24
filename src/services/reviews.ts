import { apiClient } from '@/src/lib/api';

export interface SubmitReviewRequest {
  restaurant_id: number;
  reservation_id?: number;
  rating: number;
  rating_service: number;
  rating_quantity: number;
  rating_quality: number;
  rating_variety: number;
  comment?: string;
}

export interface ReviewFromAPI {
  id: number;
  restaurant_id: number;
  buyer_id: number;
  reservation_id?: number;
  rating: number;
  rating_service: number;
  rating_quantity: number;
  rating_quality: number;
  rating_variety: number;
  comment?: string;
  image_url?: string;
  created_at?: string;
}

export async function submitReview(data: SubmitReviewRequest): Promise<ReviewFromAPI> {
  console.log('[Reviews] Submitting review for restaurant:', data.restaurant_id);
  const res = await apiClient.post<ReviewFromAPI | { review: ReviewFromAPI }>('/api/reviews', data);
  const resData = res.data;
  if (resData && typeof resData === 'object' && 'review' in resData) return (resData as any).review;
  return resData as ReviewFromAPI;
}

export async function fetchMyReviews(): Promise<ReviewFromAPI[]> {
  console.log('[Reviews] Fetching my reviews');
  const res = await apiClient.get<ReviewFromAPI[] | { reviews: ReviewFromAPI[] }>('/api/reviews/my');
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'reviews' in data) return (data as any).reviews;
  return [];
}

/** Fetch all public reviews (used to compute per-restaurant averages on the list page). */
export async function fetchAllReviews(): Promise<ReviewFromAPI[]> {
  console.log('[Reviews] Fetching all reviews');
  try {
    const res = await apiClient.get<ReviewFromAPI[] | { reviews: ReviewFromAPI[] }>('/api/reviews');
    const data = res.data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object' && 'reviews' in data && Array.isArray((data as any).reviews)) {
      return (data as any).reviews;
    }
    return [];
  } catch (e) {
    console.log('[Reviews] fetchAllReviews error (non-critical):', e);
    return [];
  }
}

export async function canReview(restaurantId: number | string): Promise<boolean> {
  console.log('[Reviews] Checking can review:', restaurantId);
  try {
    const res = await apiClient.get<{ canReview: boolean } | { can_review: boolean }>(`/api/reviews/can-review/${restaurantId}`);
    const data = res.data;
    if (data && typeof data === 'object' && 'canReview' in data) return (data as any).canReview;
    if (data && typeof data === 'object' && 'can_review' in data) return (data as any).can_review;
    return false;
  } catch {
    return false;
  }
}

export async function fetchReviewsByRestaurant(restaurantId: number | string): Promise<ReviewFromAPI[]> {
  console.log('[Reviews] Fetching reviews for restaurant:', restaurantId);
  try {
    const res = await apiClient.get<ReviewFromAPI[] | { reviews: ReviewFromAPI[] }>(
      `/api/reviews/restaurant/${restaurantId}`
    );
    const data = res.data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object' && 'reviews' in data && Array.isArray((data as any).reviews)) {
      return (data as any).reviews;
    }
    return [];
  } catch (e) {
    console.log('[Reviews] fetchReviewsByRestaurant error:', e);
    return [];
  }
}
