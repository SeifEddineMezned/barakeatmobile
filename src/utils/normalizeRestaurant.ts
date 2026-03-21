import type { Basket } from '@/src/types';
import type { RestaurantFromAPI } from '@/src/services/restaurants';

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

  return {
    id: String(r.id),
    merchantId: String(r.id),
    merchantName: r.name ?? 'Unknown',
    merchantLogo: r.image_url ?? undefined,
    merchantRating: undefined,
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
    latitude: r.latitude ?? 36.8065,
    longitude: r.longitude ?? 10.1815,
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
