import { create } from 'zustand';

interface FavoritesState {
  favoriteBasketIds: string[];
  favoriteMerchantIds: string[];
  toggleBasketFavorite: (basketId: string) => void;
  toggleMerchantFavorite: (merchantId: string) => void;
  isBasketFavorite: (basketId: string) => boolean;
  isMerchantFavorite: (merchantId: string) => boolean;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favoriteBasketIds: [],
  favoriteMerchantIds: [],
  
  toggleBasketFavorite: (basketId: string) =>
    set((state) => ({
      favoriteBasketIds: state.favoriteBasketIds.includes(basketId)
        ? state.favoriteBasketIds.filter((id) => id !== basketId)
        : [...state.favoriteBasketIds, basketId],
    })),
  
  toggleMerchantFavorite: (merchantId: string) =>
    set((state) => ({
      favoriteMerchantIds: state.favoriteMerchantIds.includes(merchantId)
        ? state.favoriteMerchantIds.filter((id) => id !== merchantId)
        : [...state.favoriteMerchantIds, merchantId],
    })),
  
  isBasketFavorite: (basketId: string) => get().favoriteBasketIds.includes(basketId),
  
  isMerchantFavorite: (merchantId: string) => get().favoriteMerchantIds.includes(merchantId),
}));
