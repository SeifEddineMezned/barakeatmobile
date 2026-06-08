/**
 * Shared mock data used by the customer-side walkthrough demo.
 *
 * The discover list, map list, and the /restaurant/[id] / /basket/[id] /
 * /reserve / (tabs)/orders screens all check `useWalkthroughStore()` flags
 * before deciding whether to inject (or short-circuit to) these fixtures.
 * Keeping the constants here means every screen sees the same id/name/price
 * and we never have to thread a payload through the store.
 *
 * Images: bundled in `assets/demo/`. We resolve each `require()` to a URI
 * string via `Image.resolveAssetSource` so existing image rendering callsites
 * (`<Image source={{ uri: ... }}>`) work unchanged on iOS and Android.
 */
import { Image } from 'react-native';
import type { Basket } from '@/src/types';
import type { ReservationFromAPI } from '@/src/services/reservations';
import { getNowInBusinessTz, toBizDayMinutes } from '@/src/utils/timezone';

// ── Asset URIs (resolved once at module load) ───────────────────────────────
export const DEMO_COVER_URL = Image.resolveAssetSource(require('../../assets/demo/meal-img1.jpeg')).uri;
export const DEMO_LOGO_URL = Image.resolveAssetSource(require('../../assets/demo/demo-logo.png')).uri;
export const DEMO_BASKET_PHOTOS = [
  Image.resolveAssetSource(require('../../assets/demo/meal-img2.jpeg')).uri,
  Image.resolveAssetSource(require('../../assets/demo/meal-img3.jpeg')).uri,
  Image.resolveAssetSource(require('../../assets/demo/meal-img4.jpeg')).uri,
];

// ── Identity ────────────────────────────────────────────────────────────────
export const DEMO_LOCATION_ID = 'demo';
export const DEMO_BASKET_ID = 'demo-basket';
export const DEMO_BASKET_IDS = ['demo-basket', 'demo-basket-2', 'demo-basket-3'] as const;
export const DEMO_ORDER_ID = 'demo-order-customer';

// Stable display values. The i18n keys are resolved on demand inside each
// screen — these statics are fallbacks for places that don't have a translator
// handy (markers etc.).
export const DEMO_LOCATION_NAME = 'Chez Joe (démo)';
export const DEMO_BASKET_NAME = 'Panier Surprise';
export const DEMO_LOCATION_ADDRESS = '15 Avenue Habib Bourguiba, Tunis';
export const DEMO_LOCATION_CATEGORY = 'restaurant';
// Static fallbacks kept for places that can't call the helper (markers, etc.).
// The dynamic times below are what every demo basket / order / location
// actually uses, so the demo never "expires" while the user is exploring.
export const DEMO_PICKUP_START = '18:00';
export const DEMO_PICKUP_END = '19:30';

/**
 * Return a pickup window that is guaranteed to contain "now" in BUSINESS
 * timezone (Africa/Tunis) — the same space `isPickupExpiredInTz` uses. The
 * previous implementation worked only on raw clock hours, which broke
 * across the 03:30 business-day rollover (e.g. now=02:00 produced
 * 03:00–05:00, mapping to "yesterday's tail" vs "today's morning" and
 * flagging baskets as already expired).
 *
 * We work in business-day-minute space (0 = 03:30, 1439 = 03:29 next day),
 * place the window as `nowBiz − 30 min` → `nowBiz + 3 h`, clamp to
 * [0, 1439], then map back to clock time. Because the expiry check is
 * `nowBiz > endBiz` and we always set `endBiz >= nowBiz`, demo baskets can
 * never appear expired no matter the device time or how long the user
 * spends exploring.
 *
 * Recomputed on every call — callers invoke it from inside their builder
 * functions so freshness is established at render time, not at module load.
 */
export function getDemoPickupWindow(): { start: string; end: string } {
  const { hours, minutes } = getNowInBusinessTz();
  const nowClock = hours * 60 + minutes;
  const nowBiz = toBizDayMinutes(nowClock);
  const startBiz = Math.max(0, nowBiz - 30);
  const endBiz = Math.min(1439, nowBiz + 180);
  const RESET = 3 * 60 + 30; // 210, the daily reset offset
  const bizToClock = (b: number) => (b < 24 * 60 - RESET ? b + RESET : b - (24 * 60 - RESET));
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  return { start: fmt(bizToClock(startBiz)), end: fmt(bizToClock(endBiz)) };
}

export const DEMO_LATITUDE = 36.8005;
export const DEMO_LONGITUDE = 10.1825;
export const DEMO_PICKUP_CODE = 'DEMO1';

// Per-basket pricing/qty — basket #1 keeps the original numbers so the rest
// of the walkthrough (which targets basket #1) reads the same totals as
// before.
export const DEMO_ORIGINAL_PRICE = 12;
export const DEMO_DISCOUNTED_PRICE = 5;
export const DEMO_QTY_LEFT = 3;

interface DemoBasketSpec {
  id: string;
  name: string;
  description: string;
  originalPrice: number;
  discountedPrice: number;
  quantityLeft: number;
  imageUrl: string;
}

function demoSpecs(): DemoBasketSpec[] {
  return [
    {
      id: DEMO_BASKET_IDS[0],
      name: DEMO_BASKET_NAME,
      description: 'Panier surprise du jour — démo, aucune commande réelle.',
      originalPrice: DEMO_ORIGINAL_PRICE,
      discountedPrice: DEMO_DISCOUNTED_PRICE,
      quantityLeft: DEMO_QTY_LEFT,
      imageUrl: DEMO_BASKET_PHOTOS[0],
    },
    {
      id: DEMO_BASKET_IDS[1],
      name: 'Panier Boulangerie',
      description: 'Pains et viennoiseries de la journée — démo.',
      originalPrice: 8,
      discountedPrice: 3,
      quantityLeft: 5,
      imageUrl: DEMO_BASKET_PHOTOS[1],
    },
    {
      id: DEMO_BASKET_IDS[2],
      name: 'Panier Famille',
      description: 'Grande portion pour partager — démo.',
      originalPrice: 20,
      discountedPrice: 9,
      quantityLeft: 2,
      imageUrl: DEMO_BASKET_PHOTOS[2],
    },
  ];
}

function specToBasket(spec: DemoBasketSpec, overrides?: { merchantName?: string; description?: string }): Basket {
  const pickup = getDemoPickupWindow();
  return {
    id: spec.id,
    merchantId: DEMO_LOCATION_ID,
    merchantName: overrides?.merchantName ?? DEMO_LOCATION_NAME,
    merchantLogo: DEMO_LOGO_URL,
    name: spec.name,
    description: overrides?.description ?? spec.description,
    category: DEMO_LOCATION_CATEGORY,
    originalPrice: spec.originalPrice,
    discountedPrice: spec.discountedPrice,
    discountPercentage: Math.round(((spec.originalPrice - spec.discountedPrice) / spec.originalPrice) * 100),
    pickupWindow: { start: pickup.start, end: pickup.end },
    quantityLeft: spec.quantityLeft,
    quantityTotal: spec.quantityLeft,
    distance: 0.4,
    address: DEMO_LOCATION_ADDRESS,
    latitude: DEMO_LATITUDE,
    longitude: DEMO_LONGITUDE,
    hasCoords: true,
    exampleItems: [],
    isActive: true,
    basketTypeCount: 3,
    merchantRating: 4.8,
    reviewCount: 42,
    imageUrl: spec.imageUrl,
    coverImageUrl: DEMO_COVER_URL,
  };
}

/**
 * Return all three demo baskets for the restaurant detail page. The
 * walkthrough still funnels through basket #1 (`DEMO_BASKET_ID`); baskets #2
 * and #3 are visible on the location page as additional options.
 */
export function buildDemoBaskets(): Basket[] {
  return demoSpecs().map((s) => specToBasket(s));
}

/**
 * Return ONLY basket #1, shaped for list views (Discover / Map). One card
 * per location is the correct list-view representation.
 */
export function buildDemoListingBasket(opts?: { name?: string; merchantName?: string; description?: string }): Basket {
  const spec = demoSpecs()[0];
  const basket = specToBasket(spec, { merchantName: opts?.merchantName, description: opts?.description });
  if (opts?.name) basket.name = opts.name;
  return basket;
}

/**
 * Raw API-shaped basket object for the restaurant-detail / basket-detail
 * short-circuits. These pages normalize via `normalizeRawBasketToBasket()`
 * so they expect snake_case fields, not the camelCase `Basket` shape.
 */
export function buildDemoRawBasketById(basketId: string, opts?: { restaurantName?: string }): any | null {
  const spec = demoSpecs().find((s) => s.id === basketId);
  if (!spec) return null;
  const merchantName = opts?.restaurantName ?? DEMO_LOCATION_NAME;
  const pickup = getDemoPickupWindow();
  return {
    id: spec.id,
    location_id: DEMO_LOCATION_ID,
    restaurant_id: DEMO_LOCATION_ID,
    name: spec.name,
    description: spec.description,
    category: DEMO_LOCATION_CATEGORY,
    original_price: spec.originalPrice,
    selling_price: spec.discountedPrice,
    quantity: spec.quantityLeft,
    is_active: true,
    pickup_start_time: pickup.start,
    pickup_end_time: pickup.end,
    image_url: spec.imageUrl,
    restaurant_name: merchantName,
    location_name: merchantName,
    restaurant_address: DEMO_LOCATION_ADDRESS,
    latitude: DEMO_LATITUDE,
    longitude: DEMO_LONGITUDE,
    avg_rating: 4.8,
    merchantLogo: DEMO_LOGO_URL,
  };
}

export function buildDemoRawBaskets(opts?: { restaurantName?: string }): any[] {
  return demoSpecs().map((s) => buildDemoRawBasketById(s.id, opts)!);
}

/**
 * Build a customer-side demo order (Reservation-shaped) for injection into
 * the (tabs)/orders list when `demoOrderActive` is true. Pickup window is
 * anchored to roughly `now + 1h` so the countdown card looks realistic.
 *
 * Mirrors the business-side inline builder at
 * `app/(business)/incoming-orders.tsx:271-300` but produces the customer
 * `ReservationFromAPI` shape that `ReservationCard` consumes.
 */
export function buildDemoOrder(opts?: { basketName?: string; locationName?: string }): ReservationFromAPI {
  const now = new Date();
  const { start: pickupStart, end: pickupEnd } = getDemoPickupWindow();
  const primary = demoSpecs()[0];
  const basketName = opts?.basketName ?? primary.name;
  const locationName = opts?.locationName ?? DEMO_LOCATION_NAME;

  return {
    id: DEMO_ORDER_ID,
    restaurant_id: -1, // sentinel so real restaurant lookups skip this
    basketId: primary.id,
    basket_name: basketName,
    basket: {
      id: primary.id,
      name: basketName,
      merchantName: locationName,
      merchant_name: locationName,
      merchantLogo: DEMO_LOGO_URL,
      image_url: primary.imageUrl,
      imageUrl: primary.imageUrl,
      originalPrice: primary.originalPrice,
      discountedPrice: primary.discountedPrice,
      pickupWindow: { start: pickupStart, end: pickupEnd },
      pickup_start_time: pickupStart,
      pickup_end_time: pickupEnd,
      address: DEMO_LOCATION_ADDRESS,
      latitude: DEMO_LATITUDE,
      longitude: DEMO_LONGITUDE,
    },
    restaurant: {
      id: -1,
      name: locationName,
      address: DEMO_LOCATION_ADDRESS,
      image_url: DEMO_LOGO_URL,
      pickup_start_time: pickupStart,
      pickup_end_time: pickupEnd,
      latitude: DEMO_LATITUDE,
      longitude: DEMO_LONGITUDE,
    },
    quantity: 1,
    total: primary.discountedPrice,
    total_price: String(primary.discountedPrice),
    pickupWindow: { start: pickupStart, end: pickupEnd },
    pickupCode: DEMO_PICKUP_CODE,
    pickup_code: DEMO_PICKUP_CODE,
    status: 'confirmed',
    createdAt: now.toISOString(),
    created_at: now.toISOString(),
  };
}
