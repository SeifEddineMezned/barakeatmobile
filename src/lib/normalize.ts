import type { Basket } from '@/src/types';
import type { RestaurantFromAPI } from '@/src/services/restaurants';

const CATEGORY_MAP: Record<string, string> = {
  bakery: 'Pâtisseries/Boulangeries',
  meals: 'Restaurants',
  grocery: 'Produits frais',
  fresh: 'Produits frais',
  supermarket: 'Produits frais',
};

function formatTime(timeStr?: string | null): string {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length >= 2) {
    return `${parts[0]}:${parts[1]}`;
  }
  return timeStr;
}

export function normalizeRestaurantToBasket(r: RestaurantFromAPI): Basket {
  const originalPrice = Number(r.original_price ?? 0);
  const discountedPrice = Number(r.price_tier ?? 0);
  const discountPercentage = originalPrice > 0
    ? Math.round(((originalPrice - discountedPrice) / originalPrice) * 100)
    : 50;

  const isActive = !r.is_paused
    && r.availability_status !== 'paused'
    && !r.pickup_expired
    && (r.available_left ?? r.available_quantity ?? 0) > 0;

  const category = CATEGORY_MAP[r.category ?? ''] ?? r.category ?? 'Tous';

  const isSupermarket = (r.category ?? '').toLowerCase() === 'supermarket'
    || (r.category ?? '').toLowerCase() === 'grocery';

  return {
    id: String(r.id),
    merchantId: String(r.id),
    merchantName: r.name ?? 'Unknown',
    merchantLogo: r.image_url ?? undefined,
    merchantRating: undefined,
    reviewCount: undefined,
    reviews: undefined,
    description: r.bag_description || r.description || undefined,
    name: r.bag_description
      ? r.name
      : r.name ?? 'Panier Surprise',
    category,
    originalPrice,
    discountedPrice,
    discountPercentage,
    pickupWindow: {
      start: formatTime(r.pickup_start_time) || '18:00',
      end: formatTime(r.pickup_end_time) || '19:00',
    },
    quantityLeft: r.available_left ?? r.available_quantity ?? 0,
    quantityTotal: r.default_daily_quantity ?? r.available_quantity ?? 0,
    distance: 0,
    address: r.address ?? '',
    latitude: r.latitude ?? 36.8065,
    longitude: r.longitude ?? 10.1815,
    exampleItems: [],
    imageUrl: r.image_url ?? undefined,
    isActive,
    isSupermarket,
  };
}
