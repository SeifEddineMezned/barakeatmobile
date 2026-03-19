import { create } from 'zustand';

interface OrdersState {
  _deprecated: boolean;
}

export const useOrdersStore = create<OrdersState>(() => ({
  _deprecated: true,
}));
