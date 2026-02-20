import { create } from 'zustand';
import { Order } from '@/src/types';

interface OrdersState {
  orders: Order[];
  addOrder: (order: Order) => void;
  cancelOrder: (orderId: string) => void;
}

export const useOrdersStore = create<OrdersState>((set) => ({
  orders: [],
  addOrder: (order: Order) =>
    set((state) => ({
      orders: [order, ...state.orders],
    })),
  cancelOrder: (orderId: string) =>
    set((state) => ({
      orders: state.orders.map((order) =>
        order.id === orderId ? { ...order, status: 'cancelled' as const } : order
      ),
    })),
}));
