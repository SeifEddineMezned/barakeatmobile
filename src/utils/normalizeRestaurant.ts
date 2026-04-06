import type { Basket } from '@/src/types';
import type { RestaurantFromAPI, LocationFromAPI } from '@/src/services/restaurants';

// ── Tunisia coordinate lookup table ──────────────────────────────────────────
// Used as a fallback when the API does not return GPS coordinates.
// Keys are lowercase substrings; the FIRST match wins (most-specific first).
const TN_COORDS: Array<[string, { lat: number; lng: number }]> = [
  // ── Tunis districts ──────────────────────────────────────
  ['menzah 9',          { lat: 36.8542, lng: 10.1861 }],
  ['menzah 8',          { lat: 36.8558, lng: 10.1903 }],
  ['menzah 7',          { lat: 36.8567, lng: 10.1917 }],
  ['menzah 6',          { lat: 36.8594, lng: 10.1883 }],
  ['menzah 5',          { lat: 36.8581, lng: 10.1875 }],
  ['menzah',            { lat: 36.8581, lng: 10.1875 }],
  ['el menzah',         { lat: 36.8581, lng: 10.1875 }],
  ['centre urbain nord',{ lat: 36.8508, lng: 10.2044 }],
  ['berges du lac',     { lat: 36.8333, lng: 10.2333 }],
  ['lac 2',             { lat: 36.8400, lng: 10.2500 }],
  ['lac 1',             { lat: 36.8333, lng: 10.2333 }],
  ['lac',               { lat: 36.8333, lng: 10.2333 }],
  ['ennasr',            { lat: 36.8783, lng: 10.2056 }],
  ['mutuelleville',     { lat: 36.8167, lng: 10.2031 }],
  ['montplaisir',       { lat: 36.8094, lng: 10.1717 }],
  ['el manar',          { lat: 36.8419, lng: 10.1986 }],
  ['el bardo',          { lat: 36.8083, lng: 10.1333 }],
  ['bardo',             { lat: 36.8083, lng: 10.1333 }],
  ['tunis',             { lat: 36.8065, lng: 10.1815 }],
  // ── Greater Tunis suburbs ──────────────────────────────────
  ['halk el wed',       { lat: 36.7200, lng: 10.3500 }],
  ['halk elwed',        { lat: 36.7200, lng: 10.3500 }],
  ['halkelwed',         { lat: 36.7200, lng: 10.3500 }],
  ['sidi daoud',        { lat: 36.8908, lng: 10.3272 }],
  ['sidi bou said',     { lat: 36.8706, lng: 10.3403 }],
  ['gammarth',          { lat: 36.9319, lng: 10.2775 }],
  ['la marsa',          { lat: 36.8783, lng: 10.3237 }],
  ['marsa',             { lat: 36.8783, lng: 10.3237 }],
  ['carthage',          { lat: 36.8528, lng: 10.3244 }],
  ['la goulette',       { lat: 36.8189, lng: 10.3058 }],
  ['goulette',          { lat: 36.8189, lng: 10.3058 }],
  ['el aouina',         { lat: 36.8903, lng: 10.2394 }],
  ['aouina',            { lat: 36.8903, lng: 10.2394 }],
  ['soukra',            { lat: 36.9056, lng: 10.2044 }],
  ['ariana',            { lat: 36.8767, lng: 10.1838 }],
  ['rades',             { lat: 36.7625, lng: 10.2736 }],
  ['radès',             { lat: 36.7625, lng: 10.2736 }],
  ['megrine',           { lat: 36.7614, lng: 10.2239 }],
  ['mégrine',           { lat: 36.7614, lng: 10.2239 }],
  ['hammam lif',        { lat: 36.7256, lng: 10.3425 }],
  ['hammam-lif',        { lat: 36.7256, lng: 10.3425 }],
  ['ben arous',         { lat: 36.7531, lng: 10.2286 }],
  ['el mourouj',        { lat: 36.7283, lng: 10.2036 }],
  ['mourouj',           { lat: 36.7283, lng: 10.2036 }],
  // ── Other governorates ─────────────────────────────────────
  ['bizerte',           { lat: 37.2746, lng: 9.8739 }],
  ['nabeul',            { lat: 36.4678, lng: 10.7347 }],
  ['hammamet',          { lat: 36.3989, lng: 10.6142 }],
  ['sousse',            { lat: 35.8256, lng: 10.6400 }],
  ['monastir',          { lat: 35.7643, lng: 10.8113 }],
  ['sfax',              { lat: 34.7478, lng: 10.7661 }],
  ['kairouan',          { lat: 35.6781, lng: 10.0961 }],
  ['gabes',             { lat: 33.8833, lng: 10.0972 }],
  ['gabès',             { lat: 33.8833, lng: 10.0972 }],
  ['gafsa',             { lat: 34.4311, lng: 8.7842 }],
  ['tozeur',            { lat: 33.9197, lng: 8.1331 }],
];

/** Extract approximate GPS coordinates from a free-text Tunisian address. */
function geocodeFromAddress(address: string): { lat: number; lng: number } | null {
  if (!address) return null;
  const lower = address.toLowerCase();
  for (const [key, coords] of TN_COORDS) {
    if (lower.includes(key)) return coords;
  }
  return null;
}

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

/**
 * Normalize a location from GET /api/locations into a Basket card for the search tab.
 * Locations join with organizations so brand data (name, image, cover) comes from org.
 */
export function normalizeLocationToBasket(loc: LocationFromAPI): Basket {
  // Prices: prefer basket-level min price, fall back to location-level price_tier
  const minBasketPrice = loc.min_basket_price != null ? Number(loc.min_basket_price) : 0;
  const priceTier = Number(loc.price_tier ?? 0);
  // Use whichever is available and > 0; basket-level takes priority
  const minPrice = minBasketPrice > 0 ? minBasketPrice : priceTier;
  // For original price: use max_original_price from baskets if available, else location-level
  const maxOriginal = (loc as any).max_original_price != null ? Number((loc as any).max_original_price) : 0;
  const locOriginal = Number(loc.original_price ?? 0);
  const originalPrice = maxOriginal > 0 ? maxOriginal : locOriginal;
  const discountedPrice = minPrice;
  const discountPercentage = originalPrice > 0
    ? Math.round(((originalPrice - discountedPrice) / originalPrice) * 100)
    : 0;

  // Quantity = total basket quantity from baskets table (not adjusted for reservations/expiry)
  const totalBasketQty = Number(loc.total_basket_quantity ?? loc.available_quantity ?? 0);
  // For the card display, always use the raw basket quantity — don't zero out for pickup expiry
  const availableLeft = totalBasketQty;

  // Don't use loc.pickup_expired here — individual baskets may have different
  // pickup windows than the location. BasketCard handles per-card expiry checks.
  const isActive = !loc.is_paused
    && loc.availability_status !== 'paused'
    && totalBasketQty > 0;

  const bagDesc = loc.bag_description?.trim();
  const description = loc.description?.trim();

  const rawLat = Number(loc.latitude);
  const rawLng = Number(loc.longitude);
  const hasCoords =
    loc.latitude != null && loc.longitude != null &&
    isFinite(rawLat) && isFinite(rawLng) &&
    (rawLat !== 0 || rawLng !== 0); // (0,0) = Gulf of Guinea, not valid

  if (!hasCoords && loc.latitude != null) {
    console.log(`[Normalize] "${loc.display_name ?? loc.name}" has lat=${loc.latitude} lng=${loc.longitude} but hasCoords=false`);
  }

  // Fallback: derive approximate coordinates from address text
  const fallbackCoords = hasCoords ? null : geocodeFromAddress(loc.address ?? '');
  const finalHasCoords = hasCoords || fallbackCoords !== null;
  const finalLat = hasCoords ? Number(loc.latitude) : (fallbackCoords?.lat ?? null as unknown as number);
  const finalLng = hasCoords ? Number(loc.longitude) : (fallbackCoords?.lng ?? null as unknown as number);

  if (!hasCoords && fallbackCoords) {
    console.log(`[Geo] Approximated coords for "${loc.display_name ?? loc.name}" from address "${loc.address}":`, fallbackCoords);
  }

  const basketCount = loc.basket_count ?? 0;

  return {
    id: String(loc.id),
    merchantId: String(loc.id),
    merchantName: loc.display_name ?? loc.name ?? 'Unknown',
    merchantLogo: loc.image_url ?? undefined,
    merchantRating: undefined,
    reviewCount: undefined,
    reviews: undefined,
    description: bagDesc || description || undefined,
    name: loc.display_name ?? loc.name ?? 'Surprise Bag',
    category: mapCategory(loc.category),
    originalPrice,
    discountedPrice,
    discountPercentage,
    pickupWindow: {
      start: formatTime(loc.pickup_start_time) || '18:00',
      end: formatTime(loc.pickup_end_time) || '19:00',
    },
    quantityLeft: availableLeft,
    quantityTotal: totalBasketQty,
    distance: 0,
    address: loc.address ?? '',
    latitude: finalLat,
    longitude: finalLng,
    hasCoords: finalHasCoords,
    exampleItems: bagDesc ? parseBagDescription(bagDesc) : [],
    coverImageUrl: loc.cover_image_url ?? loc.image_url ?? undefined,
    imageUrl: loc.cover_image_url ?? loc.image_url ?? undefined,
    isActive,
    isSupermarket: loc.category === 'supermarket',
    basketTypeCount: basketCount > 1 ? basketCount : undefined,
  };
}

/**
 * Maps any backend category string to a locale-neutral enum key.
 * These keys MUST exist in all three locale files under home.categories.*
 * UI components call t(`home.categories.${basket.category}`) to render the label.
 *
 * Returned keys: 'all' | 'bakery' | 'restaurant' | 'supermarket' | 'fresh' | 'cafe' | 'fastfood'
 *
 * IMPORTANT: this function is exported so the home screen can use it for
 * the "all" sentinel without hardcoding French.
 */
export function mapCategory(cat: string | null | undefined): string {
  if (!cat || typeof cat !== 'string') return 'all';
  switch (cat.toLowerCase().trim()) {
    // Bakery / pastry
    case 'bakery':
    case 'boulangerie':
    case 'patisserie':
    case 'pâtisserie':
    case 'patisseries/boulangeries': // guard already-mapped legacy French
    case 'pâtisseries/boulangeries':
    case 'pastry':
    case 'baked_goods':
    case 'baked goods':
      return 'bakery';
    // Restaurants / meals (includes French backend values like "Plats Préparés")
    case 'meals':
    case 'restaurant':
    case 'restaurants':
    case 'meal':
    case 'food':
    case 'traiteur':
    case 'plats préparés':  // French backend label → enum key
    case 'plats prepares':
      return 'restaurant';
    // Supermarket / grocery
    case 'supermarket':
    case 'grocery':
    case 'groceries':
    case 'supermarche':
    case 'supermarché':
    case 'epicerie':
    case 'épicerie':
      return 'supermarket';
    // Fresh produce
    case 'fresh':
    case 'produits frais':
    case 'fresh_produce':
    case 'fruits':
    case 'legumes':
    case 'légumes':
      return 'fresh';
    // Café / drinks
    case 'cafe':
    case 'café':
    case 'coffee':
    case 'drinks':
    case 'beverages':
      return 'cafe';
    // Fast food
    case 'fast_food':
    case 'fast food':
    case 'fastfood':
    case 'snack':
    case 'sandwich':
      return 'fastfood';
    default:
      // Unknown backend category — treat as restaurant (safe, visible)
      return 'restaurant';
  }
}

function parseBagDescription(desc: string): string[] {
  if (!desc) return [];
  const items = desc.split(/[,،;/\n]+/).map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : [];
}
