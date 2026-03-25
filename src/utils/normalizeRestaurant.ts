import type { Basket } from '@/src/types';
import type { RestaurantFromAPI } from '@/src/services/restaurants';

// Raw shape returned by GET /api/baskets/:id and GET /api/baskets/location/:id
export interface RawBasketFromAPI {
  id: number | string;
  restaurant_id?: number | string;
  location_id?: number | string | null;
  name?: string | null;
  description?: string | null;
  original_price?: number | string | null;
  selling_price?: number | string | null;
  quantity?: number | null;
  daily_reinitialization_quantity?: number | null;
  pickup_start_time?: string | null;
  pickup_end_time?: string | null;
  status?: string | null;
  category?: string | null;
  image_url?: string | null;
  restaurant_name?: string | null;
  restaurant_address?: string | null;
  restaurant_image?: string | null;
  // Organization/location fields (new model)
  org_name?: string | null;
  org_image_url?: string | null;
  location_address?: string | null;
  [key: string]: unknown;
}

export function normalizeRawBasketToBasket(b: RawBasketFromAPI, fallbackRestaurantName?: string): Basket {
  const originalPrice = Number(b.original_price ?? 0);
  const discountedPrice = Number(b.selling_price ?? 0);
  const discountPercentage = originalPrice > 0
    ? Math.round(((originalPrice - discountedPrice) / originalPrice) * 100)
    : 0;

  const quantityLeft = Number(b.quantity ?? 0);
  const quantityTotal = Number(b.daily_reinitialization_quantity ?? 0);

  return {
    id: String(b.id),
    merchantId: String(b.location_id ?? b.restaurant_id ?? ''),
    merchantName: b.org_name ?? b.restaurant_name ?? fallbackRestaurantName ?? 'Unknown',
    merchantLogo: b.org_image_url ?? b.restaurant_image ?? undefined,
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
    address: b.location_address ?? b.restaurant_address ?? '',
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

  const availableLeft = Number(r.available_left ?? r.available_quantity ?? 0);
  const quantityTotal = Number(r.available_quantity || r.default_daily_quantity || 0);

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
  if (!cat || typeof cat !== 'string') return 'Tous';
  switch (cat.toLowerCase().trim()) {
    // Bakery
    case 'bakery':
    case 'boulangerie':
    case 'patisserie':
    case 'pastry':
    case 'baked_goods':
    case 'baked goods':
      return 'Patisseries/Boulangeries';
    // Restaurants / meals
    case 'meals':
    case 'restaurant':
    case 'restaurants':
    case 'meal':
    case 'food':
    case 'traiteur':
      return 'Restaurants';
    // Supermarket / grocery
    case 'supermarket':
    case 'grocery':
    case 'groceries':
    case 'supermarche':
    case 'supermarché':
    case 'epicerie':
    case 'épicerie':
      return 'Supermarché';
    // Fresh produce
    case 'fresh':
    case 'produits frais':
    case 'fresh_produce':
    case 'fruits':
    case 'legumes':
    case 'légumes':
      return 'Produits frais';
    // Café / drinks
    case 'cafe':
    case 'café':
    case 'coffee':
    case 'drinks':
    case 'beverages':
      return 'Café';
    // Fast food
    case 'fast_food':
    case 'fast food':
    case 'fastfood':
    case 'snack':
    case 'sandwich':
      return 'Fast Food';
    default:
      // Capitalize first letter for any unrecognized backend value
      return cat.charAt(0).toUpperCase() + cat.slice(1);
  }
}

function parseBagDescription(desc: string): string[] {
  if (!desc) return [];
  const items = desc.split(/[,،;/\n]+/).map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : [];
}
