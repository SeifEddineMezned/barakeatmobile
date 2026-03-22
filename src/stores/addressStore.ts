import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  removeAddress: (id: string) => Promise<void>;
  selectAddress: (id: string | null) => void;
}

const STORAGE_KEY = '@barakeat_addresses';
const SELECTED_KEY = '@barakeat_selected_address';

export const useAddressStore = create<AddressState>((set, get) => ({
  addresses: [],
  selectedId: null,
  hydrated: false,

  hydrate: async () => {
    try {
      const [addrJson, selectedId] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(SELECTED_KEY),
      ]);
      set({
        addresses: addrJson ? (JSON.parse(addrJson) as SavedAddress[]) : [],
        selectedId: selectedId || null,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  addAddress: async (addr) => {
    const newAddr: SavedAddress = { ...addr, id: Date.now().toString() };
    const updated = [...get().addresses, newAddr];
    set({ addresses: updated, selectedId: newAddr.id });
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)),
      AsyncStorage.setItem(SELECTED_KEY, newAddr.id),
    ]);
  },

  removeAddress: async (id) => {
    const updated = get().addresses.filter((a) => a.id !== id);
    const newSelected = get().selectedId === id ? (updated[0]?.id ?? null) : get().selectedId;
    set({ addresses: updated, selectedId: newSelected });
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)),
      AsyncStorage.setItem(SELECTED_KEY, newSelected ?? ''),
    ]);
  },

  selectAddress: (id) => {
    set({ selectedId: id });
    void AsyncStorage.setItem(SELECTED_KEY, id ?? '');
  },
}));
