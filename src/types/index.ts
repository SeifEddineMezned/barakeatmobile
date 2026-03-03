export type UserRole = 'customer' | 'business';

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
  latitude: number;
  longitude: number;
  exampleItems: string[];
  imageUrl?: string;
  isActive: boolean;
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
  email: string;
  phone?: string;
  role: UserRole;
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
  hours?: string;
  latitude: number;
  longitude: number;
}

export interface BusinessStats {
  totalBasketsSold: number;
  totalRevenue: number;
  activeBaskets: number;
  pendingOrders: number;
  mealsRescued: number;
  averageRating: number;
}

export interface Partner {
  id: string;
  name: string;
  logo?: string;
}
