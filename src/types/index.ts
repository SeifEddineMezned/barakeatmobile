export interface Basket {
  id: string;
  merchantId: string;
  merchantName: string;
  merchantLogo?: string;
  merchantRating?: number;
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
  distance: number;
  address: string;
  latitude: number;
  longitude: number;
  exampleItems: string[];
  imageUrl?: string;
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
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

export interface Partner {
  id: string;
  name: string;
  logo?: string;
}
