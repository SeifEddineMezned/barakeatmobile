import { apiClient } from '@/src/lib/api';

export interface SubmitReviewRequest {
  location_id: number;        // backend expects location_id (not restaurant_id)
  reservation_id?: number;
  rating: number;
  rating_service: number;
  rating_quantity: number;
  rating_quality: number;
  rating_variety: number;
  comment?: string;
  /** Data URL (data:image/…;base64,…). The backend uploads to Cloudinary and
   *  stores the resulting URL on reviews.image_url. Do NOT send a local file URI. */
  image_data_url?: string;
}

export interface ReviewFromAPI {
  id: number;
  location_id?: number;       // canonical field returned by backend
  restaurant_id?: number;     // legacy alias, may also appear in response
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
  console.log('[Reviews] Submitting review for location:', data.location_id);
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

/** Aggregate map keyed by location_id → {avg, count}. Used by the search
 *  tab to render rating chips on every location card.
 *
 *  Implementation note: the backend only exposes /api/reviews/restaurant/:id
 *  (the platform-wide /api/reviews 404s), so we fan out one request per
 *  visible location. Concurrency is capped at 3 to stay below the per-IP
 *  rate limit — previous attempts to fire all N requests in parallel tripped
 *  429s once the location set grew past ~5. Both the root layout's boot
 *  prefetch and the search-tab live query call this function with the same
 *  id list so cache lookups share a single key. */
export type ReviewMap = Record<string, { avg: number; count: number }>;

const REVIEW_FETCH_CONCURRENCY = 3;

export async function fetchReviewMap(ids: Array<string | number>): Promise<ReviewMap> {
  const map: ReviewMap = {};
  const queue = ids.map((id) => String(id));

  const summariseReviews = (reviews: ReviewFromAPI[]): { avg: number; count: number } | null => {
    const catAvgs = reviews
      .map((rev) => {
        const cats = [
          Number(rev.rating_service) || 0,
          Number(rev.rating_quality) || 0,
          Number(rev.rating_quantity) || 0,
          Number(rev.rating_variety) || 0,
        ].filter((v) => v > 0);
        if (cats.length > 0) return cats.reduce((a, b) => a + b, 0) / cats.length;
        return Number(rev.rating) || 0;
      })
      .filter((v) => v > 0);
    if (catAvgs.length === 0) return null;
    return {
      avg: catAvgs.reduce((a, b) => a + b, 0) / catAvgs.length,
      count: reviews.length,
    };
  };

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const id = queue.shift();
      if (id == null) return;
      try {
        const reviews = await fetchReviewsByRestaurant(id);
        if (reviews.length === 0) continue;
        const summary = summariseReviews(reviews);
        if (summary) map[id] = summary;
      } catch (err) {
        console.log('[ReviewMap] fetch failed for location', id, err);
      }
    }
  }

  const workerCount = Math.min(REVIEW_FETCH_CONCURRENCY, queue.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return map;
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
