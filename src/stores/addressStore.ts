import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '@/src/lib/api';

export interface SavedAddress {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

interface AddressState {
  addresses: SavedAddress[];
  selectedId: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addAddress: (addr: Omit<SavedAddress, 'id'>) => Promise<void>;
  updateAddress: (id: string, update: Partial<Omit<SavedAddress, 'id'>>) => Promise<void>;
  removeAddress: (id: string) => Promise<void>;
  selectAddress: (id: string | null) => void;
}

const STORAGE_KEY = '@barakeat_addresses';
const SELECTED_KEY = '@barakeat_selected_address';

/** Save to local cache for fast offline access */
function cacheLocally(addresses: SavedAddress[], selectedId: string | null) {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(addresses));
  void AsyncStorage.setItem(SELECTED_KEY, selectedId ?? '');
}

export const useAddressStore = create<AddressState>((set, get) => ({
  addresses: [],
  selectedId: null,
  hydrated: false,

  hydrate: async () => {
    // 1. Load from local cache first (instant)
    try {
      const [addrJson, selectedId] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(SELECTED_KEY),
      ]);
      const local = addrJson ? (JSON.parse(addrJson) as SavedAddress[]) : [];
      set({ addresses: local, selectedId: selectedId || null, hydrated: true });
    } catch {
      set({ hydrated: true });
    }

    // 2. Sync from API in background (source of truth)
    try {
      const res = await apiClient.get<any[]>('/api/users/addresses');
      const remote = (res.data ?? []).map((a: any) => ({
        id: String(a.id),
        label: a.label,
        lat: a.lat,
        lng: a.lng,
      }));
      const selectedRemote = (res.data ?? []).find((a: any) => a.is_selected);
      const selId = selectedRemote ? String(selectedRemote.id) : (remote[0]?.id ?? null);
      set({ addresses: remote, selectedId: selId });
      cacheLocally(remote, selId);
    } catch {
      // API unavailable — keep local cache
    }
  },

  addAddress: async (addr) => {
    // Optimistic local update
    const tempId = Date.now().toString();
    const tempAddr: SavedAddress = { ...addr, id: tempId };
    const updated = [...get().addresses, tempAddr];
    set({ addresses: updated, selectedId: tempId });
    cacheLocally(updated, tempId);

    // Persist to API
    try {
      const res = await apiClient.post<any>('/api/users/addresses', { label: addr.label, lat: addr.lat, lng: addr.lng });
      const realId = String(res.data.id);
      const final = get().addresses.map((a) => a.id === tempId ? { ...a, id: realId } : a);
      set({ addresses: final, selectedId: realId });
      cacheLocally(final, realId);
    } catch {
      // API failed — keep local version with temp ID
    }
  },

  updateAddress: async (id, update) => {
    const updated = get().addresses.map((a) => (a.id === id ? { ...a, ...update } : a));
    set({ addresses: updated });
    cacheLocally(updated, get().selectedId);

    try {
      await apiClient.put(`/api/users/addresses/${id}`, update);
    } catch {
      // API failed — local update persists
    }
  },

  removeAddress: async (id) => {
    const updated = get().addresses.filter((a) => a.id !== id);
    const newSelected = get().selectedId === id ? (updated[0]?.id ?? null) : get().selectedId;
    set({ addresses: updated, selectedId: newSelected });
    cacheLocally(updated, newSelected);

    try {
      await apiClient.delete(`/api/users/addresses/${id}`);
    } catch {
      // API failed — local removal persists
    }
  },

  selectAddress: (id) => {
    set({ selectedId: id });
    void AsyncStorage.setItem(SELECTED_KEY, id ?? '');

    if (id) {
      void apiClient.put(`/api/users/addresses/${id}/select`).catch(() => {});
    }
  },
}));
