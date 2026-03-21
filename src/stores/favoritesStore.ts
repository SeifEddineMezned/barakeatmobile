import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'barakeat_favorites';

interface FavoritesData {
  favoriteBasketIds: string[];
  favoriteMerchantIds: string[];
}

function persistFavorites(data: FavoritesData) {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch((err) =>
    console.log('[Favorites] Failed to persist:', err)
  );
}

interface FavoritesState extends FavoritesData {
  toggleBasketFavorite: (basketId: string) => void;
  toggleMerchantFavorite: (merchantId: string) => void;
  isBasketFavorite: (basketId: string) => boolean;
  isMerchantFavorite: (merchantId: string) => boolean;
  hydrate: () => Promise<void>;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favoriteBasketIds: [],
  favoriteMerchantIds: [],

  toggleBasketFavorite: (basketId: string) =>
    set((state) => {
      const next = state.favoriteBasketIds.includes(basketId)
        ? state.favoriteBasketIds.filter((id) => id !== basketId)
        : [...state.favoriteBasketIds, basketId];
      persistFavorites({ favoriteBasketIds: next, favoriteMerchantIds: state.favoriteMerchantIds });
      return { favoriteBasketIds: next };
    }),

  toggleMerchantFavorite: (merchantId: string) =>
    set((state) => {
      const next = state.favoriteMerchantIds.includes(merchantId)
        ? state.favoriteMerchantIds.filter((id) => id !== merchantId)
        : [...state.favoriteMerchantIds, merchantId];
      persistFavorites({ favoriteBasketIds: state.favoriteBasketIds, favoriteMerchantIds: next });
      return { favoriteMerchantIds: next };
    }),

  isBasketFavorite: (basketId: string) => get().favoriteBasketIds.includes(basketId),

  isMerchantFavorite: (merchantId: string) => get().favoriteMerchantIds.includes(merchantId),

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data: FavoritesData = JSON.parse(raw);
        set({
          favoriteBasketIds: data.favoriteBasketIds ?? [],
          favoriteMerchantIds: data.favoriteMerchantIds ?? [],
        });
        console.log('[Favorites] Hydrated:', data.favoriteBasketIds.length, 'baskets,', data.favoriteMerchantIds.length, 'merchants');
      }
    } catch (err) {
      console.log('[Favorites] Failed to hydrate:', err);
    }
  },
}));
