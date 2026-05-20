import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ElementRect = { x: number; y: number; w: number; h: number };

// Every spotlightable surface gets a stable key here. Screens push their
// measured rect into `measuredRects[key]` on layout; the overlay reads from
// that map. New keys can be added without changing store shape elsewhere.
export type MeasuredKey =
  // ── business
  | 'addBasket'
  | 'qrFab'
  | 'formPickupTime'
  | 'formDailyReset'
  | 'formConfirmBtn'
  | 'demoBasketCard'
  | 'demoBasketQty'
  | 'demoBasketCardQty'
  // Sub-step sentinels for the availability-modal sequential halos.
  // No rect is published for these — the modal renders the halo + tooltip
  // inline because it sits above the layout overlay's z-index.
  | 'modalQtyMinus'
  | 'modalQtyPlus'
  | 'modalSave'
  | 'demoOrderCard'
  | 'orderArrives'
  | 'orderCardChat'
  | 'chatBack'
  | 'orderCardConfirmBtn'
  | 'verifyModalScanBtn'
  | 'verifyModalInput'
  | 'verifyConfirmBtn'
  | 'scanManualToggle'
  | 'scanQrBack'
  | 'profileTeamCard'
  | 'profileBusinessInfo'
  | 'teamOrgCard'
  | 'teamLocationsSection'
  | 'teamAddLocationBtn'
  | 'teamAddMemberBtn'
  | 'teamMembersSection'
  | 'addLocationCta'
  // ── customer
  | 'firstBasketCard'
  | 'favoriteHeart'
  | 'walletBalance'
  | 'walletRecharge'
  | 'notifBell'
  | 'mapButton'
  | 'mapRadiusPill'
  | 'mapCategoryRow'
  | 'reserveCashWarning'
  | 'pickupCodeBlock';

interface WalkthroughState {
  step: number | null;
  // Persisted across app reloads — once true, the walkthrough never auto-fires
  // again (until reset by the manual "Mode démo" entry in Settings). Without
  // this flag the walkthrough would re-launch on every cold start because the
  // server-side onboarding flag races with the no-location nudge.
  hasCompletedWalkthrough: boolean;
  showSettingsOverlay: boolean;
  // Single keyed map of measured rects. Screens write their rect on
  // onLayout via setMeasuredRect; the walkthrough overlay reads on render.
  measuredRects: Partial<Record<MeasuredKey, ElementRect>>;

  // ── Demo-mode flags
  // True between when the user enters the basket-creation tour and when the
  // walkthrough ends. Drives demo basket injection on my-baskets and
  // demo pre-fill on the create-basket form.
  demoBasketActive: boolean;
  // True for the orders portion of the tour. Drives the fake reservation +
  // demo order card in incoming-orders.tsx.
  demoOrderActive: boolean;
  // When set, scan-qr.tsx pre-fills this code, mocks the success state,
  // and renders "Sami (démo)" as the customer name.
  demoScanCode: string | null;

  // ── Cross-screen flags used by 'modal' / 'expand' advance triggers.
  // incoming-orders writes these so the business overlay can advance when
  // the user opens the Verify modal or expands the demo card.
  verifyModalOpen: boolean;
  expandedDemoCard: boolean;

  // The currently-active step's measureKey + tooltip position + i18n keys,
  // written by the layout-level overlay on every step change so sub-screen
  // overlays (mounted on pushed Stack screens) can render the same highlight
  // without needing access to the step list.
  // `radius` is the step's `target.radius` from the step config — sub-screen
  // overlays use it for cutout corner-rounding (e.g. pill-shaped buttons
  // need a larger radius than rectangular cards).
  currentStep: { measureKey: MeasuredKey; titleKey: string; descKey: string; tooltipPosition?: 'top' | 'bottom'; isLast: boolean; stepIndex: number; totalSteps: number; requireTap: boolean; radius?: number } | null;

  // Increments every time a blocked tap is absorbed somewhere in the demo
  // overlays. UI components subscribe and flash a "follow instructions"
  // toast so the user understands why their tap did nothing.
  tapHintTick: number;
  notifyTapHint: () => void;

  // ── Actions
  startWalkthrough: () => void;
  nextStep: (totalSteps: number) => void;
  skipWalkthrough: () => void;
  // Allows Settings → Mode démo to replay the walkthrough — flips the
  // persisted flag back to false so the next startWalkthrough() runs.
  resetWalkthroughCompletion: () => void;
  setShowSettingsOverlay: (v: boolean) => void;

  setMeasuredRect: (key: MeasuredKey, r: ElementRect | null) => void;

  setDemoBasketActive: (v: boolean) => void;
  setDemoOrderActive: (v: boolean) => void;
  setDemoScanCode: (code: string | null) => void;

  setVerifyModalOpen: (v: boolean) => void;
  setExpandedDemoCard: (v: boolean) => void;

  setCurrentStep: (s: WalkthroughState['currentStep']) => void;

  // Legacy thin wrappers — both delegate to setMeasuredRect so existing
  // call sites keep working unchanged.
  setAddBasketRect: (r: ElementRect | null) => void;
  setQrFabRect: (r: ElementRect | null) => void;
}

const clearDemoState = {
  demoBasketActive: false,
  demoOrderActive: false,
  demoScanCode: null,
  verifyModalOpen: false,
  expandedDemoCard: false,
  showSettingsOverlay: false,
  currentStep: null,
};

export const useWalkthroughStore = create<WalkthroughState>()(
  persist(
    (set, get) => ({
      step: null,
      hasCompletedWalkthrough: false,
      showSettingsOverlay: false,
      measuredRects: {},
      demoBasketActive: false,
      demoOrderActive: false,
      demoScanCode: null,
      verifyModalOpen: false,
      expandedDemoCard: false,
      currentStep: null,
      tapHintTick: 0,
      notifyTapHint: () => set((state) => ({ tapHintTick: state.tapHintTick + 1 })),

      // Reset measuredRects on every start — otherwise rects from a prior
      // run linger in-memory (the persist middleware only persists the
      // `hasCompletedWalkthrough` flag), and the new run paints a halo at
      // the previous run's measurements before the host screen re-publishes.
      startWalkthrough: () =>
        set({ step: 0, measuredRects: {}, ...clearDemoState }),

      nextStep: (totalSteps: number) =>
        set((state) => {
          if (state.step === null) return state;
          const next = state.step + 1;
          if (next >= totalSteps) {
            // Reaching the last step counts as "completed" — the persisted
            // flag stops the walkthrough from auto-relaunching on next boot.
            return { step: null, hasCompletedWalkthrough: true, ...clearDemoState };
          }
          return { step: next };
        }),

      // Skipping is the same as completing for the auto-launch gate. The user
      // explicitly opted out, so we mustn't keep nagging them on every reload —
      // they can replay the tour from Settings → Mode démo.
      skipWalkthrough: () => set({ step: null, hasCompletedWalkthrough: true, ...clearDemoState }),

      resetWalkthroughCompletion: () => set({ hasCompletedWalkthrough: false }),

      setShowSettingsOverlay: (v: boolean) => set({ showSettingsOverlay: v }),

      setMeasuredRect: (key: MeasuredKey, r: ElementRect | null) =>
        set((state) => {
          // Skip the update when the rect didn't actually change — saves
          // re-renders on every onLayout fire.
          const prev = state.measuredRects[key];
          if (r === null) {
            if (!prev) return state;
            const { [key]: _, ...rest } = state.measuredRects;
            return { measuredRects: rest };
          }
          if (prev && prev.x === r.x && prev.y === r.y && prev.w === r.w && prev.h === r.h) {
            return state;
          }
          return { measuredRects: { ...state.measuredRects, [key]: r } };
        }),

      setDemoBasketActive: (v: boolean) => set({ demoBasketActive: v }),
      setDemoOrderActive: (v: boolean) => set({ demoOrderActive: v }),
      setDemoScanCode: (code: string | null) => set({ demoScanCode: code }),

      setVerifyModalOpen: (v: boolean) => set({ verifyModalOpen: v }),
      setExpandedDemoCard: (v: boolean) => set({ expandedDemoCard: v }),

      setCurrentStep: (s) => set({ currentStep: s }),

      setAddBasketRect: (r: ElementRect | null) => get().setMeasuredRect('addBasket', r),
      setQrFabRect: (r: ElementRect | null) => get().setMeasuredRect('qrFab', r),
    }),
    {
      name: 'walkthrough-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Persist ONLY the completion flag. step / measuredRects / demo flags
      // are ephemeral session state — re-hydrating them would re-trigger an
      // in-flight walkthrough on cold boot, which is exactly the bug we're
      // fixing.
      partialize: (state) => ({ hasCompletedWalkthrough: state.hasCompletedWalkthrough }),
    },
  ),
);

// Convenience selectors that mirror the old store shape so existing readers
// (e.g., the business overlay's addBasketRect / qrFabRect lookups) keep
// working without a code change.
export const selectAddBasketRect = (s: WalkthroughState) => s.measuredRects.addBasket ?? null;
export const selectQrFabRect = (s: WalkthroughState) => s.measuredRects.qrFab ?? null;
