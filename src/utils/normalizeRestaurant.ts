import type { Basket } from '@/src/types';
import type { RestaurantFromAPI } from '@/src/services/restaurants';

// Raw shape returned by GET /api/baskets/:id and GET /api/baskets/location/:id
export interface RawBasketFromAPI {
  id: number | string;
  restaurant_id?: number | string;
  name?: string | null;
  description?: string | null;
  original_price?: number | string | null;
  selling_price?: number | string | null;
  quantity?: number | null;
  available_quantity?: number | null;
  pickup_start_time?: string | null;
  pickup_end_time?: string | null;
  status?: string | null;
  category?: string | null;
  image_url?: string | null;
  restaurant_name?: string | null;
  restaurant_address?: string | null;
  restaurant_image?: string | null;
  [key: string]: unknown;
}

export function normalizeRawBasketToBasket(b: RawBasketFromAPI, fallbackRestaurantName?: string): Basket {
  const originalPrice = Number(b.original_price ?? 0);
  const discountedPrice = Number(b.selling_price ?? 0);
  const discountPercentage = originalPrice > 0
    ? Math.round(((originalPrice - discountedPrice) / originalPrice) * 100)
    : 0;

  const quantityLeft = Number(b.available_quantity ?? b.quantity ?? 0);
  const quantityTotal = Number(b.quantity ?? 0);

  return {
    id: String(b.id),
    merchantId: String(b.restaurant_id ?? ''),
    merchantName: b.restaurant_name ?? fallbackRestaurantName ?? 'Unknown',
    merchantLogo: b.restaurant_image ?? undefined,
    merchantRating: undefined,
    reviewCount: undefined,
    reviews: undefined,
    description: b.description ?? undefined,
    name: b.name ?? 'Surprise Bag',
    category: mapCategory(typeof b.category === 'string' ? b.category : null),
    originalPrice,
    discountedPrice,
    discountPercentage,
    pickupWindow: {
      start: formatTime(b.pickup_start_time) || '18:00',
      end: formatTime(b.pickup_end_time) || '19:00',
    },
    quantityLeft,
    quantityTotal: Math.max(quantityTotal, quantityLeft),
    distance: 0,
    address: b.restaurant_address ?? '',
    latitude: null as unknown as number,
    longitude: null as unknown as number,
    hasCoords: false,
    exampleItems: b.description ? parseBagDescription(b.description) : [],
    imageUrl: b.image_url ?? undefined,
    isActive: b.status === 'available',
    isSupermarket: b.category === 'supermarket',
  };
}

function formatTime(timeStr: string | null | undefined): string {
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
    : 0;

  const availableLeft = r.available_left ?? r.available_quantity ?? 0;
  const quantityTotal = r.available_quantity ?? r.default_daily_quantity ?? 0;

  const isActive = !r.is_paused
    && r.availability_status !== 'paused'
    && !r.pickup_expired;

  const bagDesc = r.bag_description?.trim();
  const description = r.description?.trim();

  const hasCoords =
    r.latitude != null && r.longitude != null &&
    isFinite(Number(r.latitude)) && isFinite(Number(r.longitude));

  return {
    id: String(r.id),
    merchantId: String(r.id),
    merchantName: r.name ?? 'Unknown',
    merchantLogo: r.image_url ?? undefined,
    merchantRating: r.avg_rating != null ? Number(r.avg_rating) : undefined,
    reviewCount: undefined,
    reviews: undefined,
    description: bagDesc || description || undefined,
    name: r.name ?? 'Surprise Bag',
    category: mapCategory(r.category),
    originalPrice,
    discountedPrice,
    discountPercentage,
    pickupWindow: {
      start: formatTime(r.pickup_start_time) || '18:00',
      end: formatTime(r.pickup_end_time) || '19:00',
    },
    quantityLeft: availableLeft,
    quantityTotal: Math.max(quantityTotal, availableLeft),
    distance: 0,
    address: r.address ?? '',
    // Preserve real coordinates exactly as the backend sends them.
    // DO NOT inject fake/default coordinates — callers must check hasCoords.
    latitude: hasCoords ? Number(r.latitude) : null as unknown as number,
    longitude: hasCoords ? Number(r.longitude) : null as unknown as number,
    hasCoords,
    exampleItems: bagDesc ? parseBagDescription(bagDesc) : [],
    imageUrl: r.image_url ?? undefined,
    isActive,
    isSupermarket: r.category === 'supermarket',
    maxPerCustomer: (r as any).max_per_customer ?? undefined,
  };
}

function mapCategory(cat: string | null | undefined): string {
  if (!cat) return 'Tous';
  switch (cat.toLowerCase()) {
    case 'bakery':
      return 'Patisseries/Boulangeries';
    case 'meals':
    case 'restaurant':
    case 'restaurants':
      return 'Restaurants';
    case 'supermarket':
    case 'grocery':
      return 'Supermarché';
    case 'fresh':
    case 'produits frais':
      return 'Produits frais';
    default:
      return cat;
  }
}

function parseBagDescription(desc: string): string[] {
  if (!desc) return [];
  const items = desc.split(/[,،;/\n]+/).map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : [];
}
