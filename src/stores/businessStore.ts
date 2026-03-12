import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import { Basket, Order, BusinessStats, BusinessProfile, TeamMember, TeamPermission } from '@/src/types';

const initialStats: BusinessStats = {
  totalBasketsSold: 47,
  totalRevenue: 1128,
  activeBaskets: 3,
  pendingOrders: 2,
  mealsRescued: 47,
  averageRating: 4.6,
  dailySales: [5, 8, 6, 12, 9, 7, 10],
  weeklySales: [32, 41, 38, 47],
};

const defaultBusinessBaskets: Basket[] = [
  {
    id: 'b1',
    merchantId: 'biz1',
    merchantName: 'Mon Commerce',
    merchantLogo: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=100&h=100&fit=crop',
    merchantRating: 4.6,
    reviewCount: 89,
    reviews: { service: 4.7, quantite: 4.5, qualite: 4.8, variete: 4.4 },
    description: 'Un assortiment varié de nos pains et viennoiseries du jour.',
    name: 'Panier Boulangerie',
    category: 'Patisseries/Boulangeries',
    originalPrice: 20,
    discountedPrice: 10,
    discountPercentage: 50,
    pickupWindow: { start: '18:00', end: '19:00' },
    quantityLeft: 5,
    quantityTotal: 8,
    distance: 0,
    address: 'Avenue Habib Bourguiba, Tunis',
    latitude: 36.8065,
    longitude: 10.1815,
    exampleItems: ['Pain frais', 'Croissants', 'Pâtisseries'],
    imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&h=300&fit=crop',
    isActive: true,
  },
  {
    id: 'b2',
    merchantId: 'biz1',
    merchantName: 'Mon Commerce',
    merchantLogo: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=100&h=100&fit=crop',
    merchantRating: 4.6,
    reviewCount: 89,
    reviews: { service: 4.7, quantite: 4.5, qualite: 4.8, variete: 4.4 },
    description: 'Sandwiches et salades fraîches préparés le jour même.',
    name: 'Panier Déjeuner',
    category: 'Produits frais',
    originalPrice: 15,
    discountedPrice: 8,
    discountPercentage: 47,
    pickupWindow: { start: '14:00', end: '15:00' },
    quantityLeft: 3,
    quantityTotal: 6,
    distance: 0,
    address: 'Avenue Habib Bourguiba, Tunis',
    latitude: 36.8065,
    longitude: 10.1815,
    exampleItems: ['Sandwiches', 'Salades', 'Jus frais'],
    imageUrl: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=400&h=300&fit=crop',
    isActive: false,
  },
  {
    id: 'b3',
    merchantId: 'biz1',
    merchantName: 'Mon Commerce',
    merchantLogo: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=100&h=100&fit=crop',
    merchantRating: 4.6,
    reviewCount: 89,
    reviews: { service: 4.7, quantite: 4.5, qualite: 4.8, variete: 4.4 },
    description: 'Assortiment de pâtisseries orientales traditionnelles.',
    name: 'Panier Douceurs',
    category: 'Patisseries/Boulangeries',
    originalPrice: 18,
    discountedPrice: 9,
    discountPercentage: 50,
    pickupWindow: { start: '19:00', end: '20:00' },
    quantityLeft: 0,
    quantityTotal: 4,
    distance: 0,
    address: 'Avenue Habib Bourguiba, Tunis',
    latitude: 36.8065,
    longitude: 10.1815,
    exampleItems: ['Baklava', 'Makroud', 'Zlebia'],
    imageUrl: 'https://images.unsplash.com/photo-1586985289688-ca3cf47d3e6e?w=400&h=300&fit=crop',
    isActive: false,
  },
];

const defaultOrders: Order[] = [
  {
    id: 'bo1',
    basketId: 'b1',
    basket: defaultBusinessBaskets[0],
    quantity: 2,
    total: 20,
    pickupWindow: { start: '18:00', end: '19:00' },
    pickupCode: 'A3F8K2',
    status: 'reserved',
    createdAt: new Date().toISOString(),
    customerName: 'Ahmed Ben Ali',
    customerPhone: '+216 55 123 456',
  },
  {
    id: 'bo2',
    basketId: 'b2',
    basket: defaultBusinessBaskets[1],
    quantity: 1,
    total: 8,
    pickupWindow: { start: '14:00', end: '15:00' },
    pickupCode: 'X7M9P1',
    status: 'reserved',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    customerName: 'Sara Trabelsi',
    customerPhone: '+216 22 987 654',
  },
  {
    id: 'bo3',
    basketId: 'b1',
    basket: defaultBusinessBaskets[0],
    quantity: 1,
    total: 10,
    pickupWindow: { start: '18:00', end: '19:00' },
    pickupCode: 'K4L2N8',
    status: 'collected',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    customerName: 'Mohamed Jaziri',
    customerPhone: '+216 98 555 111',
  },
];

const defaultTeam: TeamMember[] = [
  {
    id: 'tm1',
    name: 'Admin Principal',
    email: 'admin@barakeat.tn',
    role: 'admin',
    permissions: { dashboard: true, baskets: true, orders: true, profile: true, team: true, financial: true },
    addedAt: new Date().toISOString(),
  },
];

const DEFAULT_PERMISSIONS: Record<string, TeamPermission> = {
  admin: { dashboard: true, baskets: true, orders: true, profile: true, team: true, financial: true },
  restricted: { dashboard: true, baskets: false, orders: true, profile: false, team: false, financial: false },
  custom: { dashboard: true, baskets: true, orders: true, profile: false, team: false, financial: false },
};

export { DEFAULT_PERMISSIONS };

export const useBusinessStore = create(
  combine(
    {
      profile: {
        id: 'biz1',
        name: 'Mon Commerce',
        email: 'commerce@barakeat.tn',
        phone: '+216 71 123 456',
        address: 'Avenue Habib Bourguiba, Tunis',
        category: 'Patisseries/Boulangeries',
        description: 'Boulangerie artisanale depuis 1998',
        logo: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=100&h=100&fit=crop',
        coverPhoto: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&h=300&fit=crop',
        hours: '07:00 - 20:00',
        latitude: 36.8065,
        longitude: 10.1815,
        isSupermarket: false,
      } as BusinessProfile | null,
      baskets: defaultBusinessBaskets as Basket[],
      orders: defaultOrders as Order[],
      stats: initialStats as BusinessStats,
      team: defaultTeam as TeamMember[],
    },
    (set) => ({
      setProfile: (profile: BusinessProfile) => set({ profile }),
      addBasket: (basket: Basket) =>
        set((state) => ({
          baskets: [basket, ...state.baskets],
          stats: { ...state.stats, activeBaskets: state.stats.activeBaskets + 1 },
        })),
      updateBasket: (id: string, updates: Partial<Basket>) =>
        set((state) => ({
          baskets: state.baskets.map((b) => (b.id === id ? { ...b, ...updates } : b)),
        })),
      deleteBasket: (id: string) =>
        set((state) => ({
          baskets: state.baskets.filter((b) => b.id !== id),
        })),
      toggleBasketActive: (id: string) =>
        set((state) => {
          const target = state.baskets.find((b) => b.id === id);
          if (!target) return state;
          const willBeActive = !target.isActive;
          const isSupermarket = state.profile?.isSupermarket ?? false;

          if (willBeActive && !isSupermarket) {
            return {
              baskets: state.baskets.map((b) =>
                b.id === id ? { ...b, isActive: true } : { ...b, isActive: false }
              ),
            };
          }
          return {
            baskets: state.baskets.map((b) =>
              b.id === id ? { ...b, isActive: willBeActive } : b
            ),
          };
        }),
      addIncomingOrder: (order: Order) =>
        set((state) => ({
          orders: [order, ...state.orders],
          stats: { ...state.stats, pendingOrders: state.stats.pendingOrders + 1 },
        })),
      updateOrderStatus: (orderId: string, status: Order['status']) =>
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId ? { ...o, status } : o
          ),
          stats: {
            ...state.stats,
            pendingOrders:
              status === 'collected' || status === 'cancelled'
                ? Math.max(0, state.stats.pendingOrders - 1)
                : state.stats.pendingOrders,
            totalBasketsSold:
              status === 'collected'
                ? state.stats.totalBasketsSold + 1
                : state.stats.totalBasketsSold,
            mealsRescued:
              status === 'collected'
                ? state.stats.mealsRescued + 1
                : state.stats.mealsRescued,
          },
        })),
      addTeamMember: (member: TeamMember) =>
        set((state) => ({
          team: [...state.team, member],
        })),
      removeTeamMember: (memberId: string) =>
        set((state) => ({
          team: state.team.filter((m) => m.id !== memberId),
        })),
      updateTeamMemberRole: (memberId: string, role: TeamMember['role'], permissions: TeamPermission) =>
        set((state) => ({
          team: state.team.map((m) =>
            m.id === memberId ? { ...m, role, permissions } : m
          ),
        })),
    })
  )
);
