export type UserRole = 'customer' | 'business' | 'admin';

export type TeamRole = 'admin' | 'restricted' | 'custom';

export interface TeamPermission {
  confirm_pickup: boolean;
  edit_quantities: boolean;
  edit_basket_info: boolean;
  create_delete_baskets: boolean;
  view_history: boolean;
  messaging: boolean;
  cancel_order: boolean;
  [key: string]: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  permissions: TeamPermission;
  addedAt: string;
}

export interface ReviewRatings {
  service: number;
  quantite: number;
  qualite: number;
  variete: number;
}

export interface Basket {
  id: string;
  merchantId: string;
  merchantName: string;
  merchantLogo?: string;
  merchantRating?: number;
  reviewCount?: number;
  reviews?: ReviewRatings;
  description?: string;
  name: string;
  category: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercentage: number;
  pickupWindow: {
    start: string;
    end: string;
  };
  quantityLeft: number;
  quantityTotal: number;
  distance: number;
  address: string;
  latitude: number | null;
  longitude: number | null;
  /** True only when the backend returned real, finite lat/lng values. */
  hasCoords?: boolean;
  exampleItems: string[];
  imageUrl?: string;
  /** Cover photo for the food spot card */
  coverImageUrl?: string;
  isActive: boolean;
  isSupermarket?: boolean;
  maxPerCustomer?: number;
  /** Number of basket types this merchant offers (for search card display) */
  basketTypeCount?: number;
  /** True when the basket has its OWN pickup_start_time / pickup_end_time
   *  (i.e. doesn't inherit the location's default hours). Sourced from the
   *  raw basket row at normalisation time — single source of truth so the
   *  "custom pickup time" yellow chip renders consistently on the search
   *  cards, the location preview, and the basket detail page. */
  hasCustomPickup?: boolean;
  /** True when the basket's location is closed for the entire current
   *  business day (weekly_schedule for today resolves to closed). Surfaces
   *  in the UI as a "Fermé aujourd'hui" badge — search-page card swaps the
   *  "Épuisé" / "Expiré" badges for this one, location-preview swaps the
   *  pickup-time chip, basket-detail disables the Reserve CTA. */
  closedToday?: boolean;
}

export interface Merchant {
  id: string;
  name: string;
  logo?: string;
  rating?: number;
  address: string;
  phone?: string;
  hours?: string;
  latitude: number;
  longitude: number;
}

export interface Order {
  id: string;
  basketId: string;
  basket: Basket;
  quantity: number;
  total: number;
  pickupWindow: {
    start: string;
    end: string;
  };
  pickupCode: string;
  status: 'reserved' | 'ready' | 'collected' | 'cancelled';
  createdAt: string;
  customerName?: string;
  customerPhone?: string;
}

export interface User {
  id: string;
  name: string;
  firstName?: string;
  email: string;
  phone?: string;
  role: UserRole;
  gender?: 'male' | 'female' | string;
  /** Server-stored avatar URL or local silhouette token (e.g.
   *  'silhouette://male' / 'silhouette://female'). Set during OAuth
   *  first-login onboarding from the man / woman holding basket picker;
   *  may also be a real URL for users who later upload a photo. */
  avatar?: string | null;
  /** Server `onboarding_completed`: false until the user finishes the
   *  welcome-carousel / demo / address first-login flow. Drives that flow's
   *  trigger — NOT the OAuth gender screen (see `genderStepCompleted`). */
  onboardingCompleted?: boolean;
  /** OAuth-only flag: false until the user has completed (or skipped) the
   *  first-login gender screen (`/auth/onboarding`). Decoupled from
   *  `onboardingCompleted` so finishing the gender step doesn't suppress the
   *  welcome carousel / demo / address prompt. Email + restaurant sign-in
   *  flows always report this as true. */
  genderStepCompleted?: boolean;
  // How the account authenticates. 'google'/'apple' accounts sign in only via
  // their provider (no password) — the app hides email/password change for them.
  // Missing on older stored sessions → treat as 'local'.
  authProvider?: 'local' | 'google' | 'apple';
}

export interface BusinessProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  address: string;
  category: string;
  description?: string;
  logo?: string;
  coverPhoto?: string;
  hours?: string;
  latitude: number;
  longitude: number;
  iban?: string;
  isSupermarket?: boolean;
}

export interface BusinessStats {
  totalBasketsSold: number;
  totalRevenue: number;
  activeBaskets: number;
  pendingOrders: number;
  mealsRescued: number;
  averageRating: number;
  dailySales: number[];
  weeklySales: number[];
}

export interface Partner {
  id: string;
  name: string;
  logo?: string;
}
