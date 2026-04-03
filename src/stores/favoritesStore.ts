import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'barakeat_favorites';

interface FavoritesData {
  favoriteBasketIds: string[];
  favoriteMerchantIds: string[];
  starredBasketTypeIds: string[];
}

function persistFavorites(data: FavoritesData) {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch((err) =>
    console.log('[Favorites] Failed to persist:', err)
  );
}

interface FavoritesState extends FavoritesData {
  toggleBasketFavorite: (basketId: string) => void;
  toggleMerchantFavorite: (merchantId: string) => void;
  toggleStarredBasketType: (basketTypeId: string) => void;
  isBasketFavorite: (basketId: string) => boolean;
  isMerchantFavorite: (merchantId: string) => boolean;
  isBasketTypeStarred: (basketTypeId: string) => boolean;
  hydrate: () => Promise<void>;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favoriteBasketIds: [],
  favoriteMerchantIds: [],
  starredBasketTypeIds: [],

  toggleBasketFavorite: (basketId: string) =>
    set((state) => {
      const next = state.favoriteBasketIds.includes(basketId)
        ? state.favoriteBasketIds.filter((id) => id !== basketId)
        : [...state.favoriteBasketIds, basketId];
      persistFavorites({ favoriteBasketIds: next, favoriteMerchantIds: state.favoriteMerchantIds, starredBasketTypeIds: state.starredBasketTypeIds });
      return { favoriteBasketIds: next };
    }),

  toggleMerchantFavorite: (merchantId: string) =>
    set((state) => {
      const next = state.favoriteMerchantIds.includes(merchantId)
        ? state.favoriteMerchantIds.filter((id) => id !== merchantId)
        : [...state.favoriteMerchantIds, merchantId];
      persistFavorites({ favoriteBasketIds: state.favoriteBasketIds, favoriteMerchantIds: next, starredBasketTypeIds: state.starredBasketTypeIds });
      return { favoriteMerchantIds: next };
    }),

  toggleStarredBasketType: (basketTypeId: string) =>
    set((state) => {
      const next = state.starredBasketTypeIds.includes(basketTypeId)
        ? state.starredBasketTypeIds.filter((id) => id !== basketTypeId)
        : [...state.starredBasketTypeIds, basketTypeId];
      persistFavorites({ favoriteBasketIds: state.favoriteBasketIds, favoriteMerchantIds: state.favoriteMerchantIds, starredBasketTypeIds: next });
      return { starredBasketTypeIds: next };
    }),

  isBasketFavorite: (basketId: string) => get().favoriteBasketIds.includes(basketId),
  isMerchantFavorite: (merchantId: string) => get().favoriteMerchantIds.includes(merchantId),
  isBasketTypeStarred: (basketTypeId: string) => get().starredBasketTypeIds.includes(basketTypeId),

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data: FavoritesData = JSON.parse(raw);
        set({
          favoriteBasketIds: data.favoriteBasketIds ?? [],
          favoriteMerchantIds: data.favoriteMerchantIds ?? [],
          starredBasketTypeIds: data.starredBasketTypeIds ?? [],
        });
      }
    } catch (err) {
      console.log('[Favorites] Failed to hydrate:', err);
    }
  },
}));
