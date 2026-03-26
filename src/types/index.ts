export type UserRole = 'customer' | 'business';

export type TeamRole = 'admin' | 'restricted' | 'custom';

export interface TeamPermission {
  dashboard: boolean;
  baskets: boolean;
  orders: boolean;
  profile: boolean;
  team: boolean;
  financial: boolean;
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
