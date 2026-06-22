import { create } from 'zustand';

export interface CelebrationData {
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
  /** 0-1 progress within the previous level (before this reservation) */
  xpProgressBefore: number;
  /** 0-1 progress within the new level */
  xpProgress: number;
  xpInLevel: number;
  xpBandSize: number;
  streakChanged: boolean;
  newStreak: number;
  /** Order confirmation data — shown as notification popup after XP animation */
  confirmData?: {
    /** Reservation id. Wired through so "Voir la commande" in the
     *  order-confirmed popup can scroll/highlight the exact card in
     *  the orders list instead of just closing the popup. */
    reservationId?: string;
    pickupCode: string;
    pickupStart: string;
    pickupEnd: string;
    address: string;
    locationName?: string;
    basketName?: string;
    basketImage?: string;
    quantity?: number;
    price?: number;
    qrCodeUrl?: string;
    // Payment context — used by the order-confirmed popup's combined
    // Paiement row (cash/card label + "À payer à la récupération" /
    // "Réglée entièrement par crédits" toDoLine). Optional so older
    // callers (and the recovery path that doesn't have the originating
    // reserve.tsx state) still construct valid CelebrationData.
    paymentMethod?: 'cash' | 'card' | 'credits';
    creditAmount?: number;
  };
}

export type OrderConfirmData = NonNullable<CelebrationData['confirmData']>;

interface CelebrationStore {
  pending: CelebrationData | null;
  setPending: (data: CelebrationData) => void;
  clearPending: () => void;
  /** True for the whole new-order animation (reserve success Phase 1/2 → XP
   *  celebration). Notification popups AND foreground push banners are held
   *  while it's true so the "order confirmed" notification never pops OVER the
   *  animation. `pending` only covers the celebration modal; this also covers
   *  the earlier reserve-success phases that run before `pending` is set. */
  orderFlowActive: boolean;
  setOrderFlowActive: (v: boolean) => void;
  /** Set by the (global) celebration modal once the user dismisses Bien joué.
   *  The tabs layout watches this and surfaces the order-confirmed popup on
   *  /(tabs)/orders. Kept in the store (not local state) so the post-reservation
   *  celebration modal can live in app/_layout.tsx and survive the
   *  reserve → /(tabs)/orders navigation transition without a black/white
   *  flash between the two modals. */
  pendingOrderConfirm: OrderConfirmData | null;
  setPendingOrderConfirm: (data: OrderConfirmData) => void;
  clearPendingOrderConfirm: () => void;
  /** Whether the global "Commande confirmée !" detail popup is currently on
   *  screen. Mirrors local state in (tabs)/_layout.tsx so app/_layout.tsx's
   *  badge / streak / address-prompt popups can gate themselves and refuse to
   *  surface while the order popup owns the foreground. Without this gate, a
   *  newly-unlocked badge (the reservation just earned the buyer XP that
   *  crossed a badge threshold) would render a second modal ON TOP of the
   *  order popup — the user reported this as a "duplicate popup" right after
   *  tapping "Voir la commande". */
  orderConfirmActive: boolean;
  setOrderConfirmActive: (v: boolean) => void;
  /** The currently-visible order-confirmed popup payload. Lives in the
   *  store (not local React state inside (tabs)/_layout.tsx) because the
   *  user kept reporting that "Voir la commande" failed to close the popup
   *  on first tap — the most reliable diagnosis was a re-render / state
   *  drift between the setOrderConfirmPopup(null) call and the Modal's
   *  next commit. Making this the single source of truth and dismissing
   *  by mutating the store synchronously removes that whole class of bug. */
  orderConfirmPopupData: OrderConfirmData | null;
  /** Shows the order-confirmed popup. Atomic: data + orderConfirmActive
   *  + a key bump are written in one store update so subscribers see a
   *  consistent snapshot. The key forces React to remount the Modal tree
   *  on every fresh show, defeating any lingering instance from a
   *  previous reservation in the same session. */
  showOrderConfirmPopup: (data: OrderConfirmData) => void;
  /** Hides the order-confirmed popup. Clears the data, clears
   *  orderConfirmActive, AND defensively clears pendingOrderConfirm so
   *  even a stale write to that field can't re-open the popup. Atomic. */
  hideOrderConfirmPopup: () => void;
  /** Increments every time showOrderConfirmPopup runs — used as React key
   *  on the Modal so a brand-new tree is mounted per show. */
  orderConfirmKey: number;
  /** Monotonic counter — bumping it tells app/_layout.tsx to clear any
   *  badge/streak popup it has on screen RIGHT NOW. Used as a "kill" signal
   *  from the order-popup dismiss so that even if a badge/streak modal
   *  already rendered (its useEffect fired before orderConfirmActive=true
   *  could gate it), "Voir la commande" tears it down on the same tap. */
  clearOverlaysSeq: number;
  signalClearOverlays: () => void;
}

export const useCelebrationStore = create<CelebrationStore>((set) => ({
  pending: null,
  setPending: (data) => set({ pending: data }),
  clearPending: () => set({ pending: null }),
  orderFlowActive: false,
  setOrderFlowActive: (v) => set({ orderFlowActive: v }),
  pendingOrderConfirm: null,
  setPendingOrderConfirm: (data) => set({ pendingOrderConfirm: data }),
  clearPendingOrderConfirm: () => set({ pendingOrderConfirm: null }),
  orderConfirmActive: false,
  setOrderConfirmActive: (v) => set({ orderConfirmActive: v }),
  orderConfirmPopupData: null,
  orderConfirmKey: 0,
  showOrderConfirmPopup: (data) => set((s) => ({
    orderConfirmPopupData: data,
    orderConfirmActive: true,
    orderConfirmKey: s.orderConfirmKey + 1,
    // Clear the pending bridge in the same write so the (tabs) useEffect
    // can't re-fire later and resurrect the popup after dismiss.
    pendingOrderConfirm: null,
  })),
  hideOrderConfirmPopup: () => set({
    orderConfirmPopupData: null,
    orderConfirmActive: false,
    pendingOrderConfirm: null,
  }),
  clearOverlaysSeq: 0,
  signalClearOverlays: () => set((s) => ({ clearOverlaysSeq: s.clearOverlaysSeq + 1 })),
}));
