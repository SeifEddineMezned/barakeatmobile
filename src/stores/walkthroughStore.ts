import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// NOTE on coordinate spaces: every screen publishes rects via measureInWindow,
// which on both iOS and Android returns absolute window coords. The overlay
// drawing code measures its own window origin (via a ref + measureInWindow)
// and subtracts it when rendering halos — so any per-device drift (status-bar
// offset under edge-to-edge, embedded SafeAreaView padding, etc.) is detected
// at runtime rather than guessed. See useOverlayOriginOffset hook.

export type ElementRect = { x: number; y: number; w: number; h: number };

// Every spotlightable surface gets a stable key here. Screens push their
// measured rect into `measuredRects[key]` on layout; the overlay reads from
// that map. New keys can be added without changing store shape elsewhere.
export type MeasuredKey =
  // ── business
  | 'addBasket'
  // Floating bottom tab bar — measured once so the demo's tab halos sit
  // exactly on the pills (device-independent, no inset guesswork).
  | 'bizTabBar'
  // Intermediary "add basket" page targets.
  | 'selectOrgExistingList'
  | 'selectOrgCreateNew'
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
  | 'mapRadiusExpanded'
  | 'mapCategoryRow'
  | 'reserveCashWarning'
  | 'pickupCodeBlock'
  // Reservation sub-tour (customer demo) — surfaces the user navigates
  // through after tapping the demo basket card on the discover/map list.
  | 'restaurantSurpriseBasket'
  | 'basketReserveBtn'
  | 'reserveQtySection'
  | 'reservePaymentSection'
  | 'reserveConfirmBtn'
  // Customer demo: after the fake reservation lands on (tabs)/orders, the
  // walkthrough highlights the injected demo order card and its pickup code.
  | 'customerOrderCard'
  | 'customerPickupCode';

interface WalkthroughState {
  step: number | null;
  // Persisted across app reloads — once true, the walkthrough never auto-fires
  // again (until reset by the manual "Mode démo" entry in Settings). Without
  // this flag the walkthrough would re-launch on every cold start because the
  // server-side onboarding flag races with the no-location nudge.
  hasCompletedWalkthrough: boolean;
  showSettingsOverlay: boolean;
  // True when the user has tapped "Mode démo" in settings and the demo
  // welcome cover should be shown OVER the (tabs) home screen. The cover
  // gives the home tab time to mount and lay out fully, lets demo image
  // prefetch settle, and lets the user explicitly tap "Start demo" before
  // any halos / dim masks paint — eliminating the jittery "settling"
  // frames users were seeing right at demo start.
  showDemoWelcome: boolean;
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
  // Customer-side demo. While true the discover/map lists inject a fake
  // location ("Café Démo") + its surprise basket at the top of their
  // rendered lists, real cards become non-tappable, and the
  // /restaurant/demo + /basket/demo-basket + /reserve?basketId=demo-basket
  // screens short-circuit their data fetches with mocked content. Lets the
  // customer demo walk through the full reservation flow without touching
  // the backend or the user's real reservations.
  demoCustomerActive: boolean;

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
  currentStep: {
    measureKey: MeasuredKey;
    titleKey: string;
    descKey: string;
    tooltipPosition?: 'top' | 'bottom';
    isLast: boolean;
    stepIndex: number;
    totalSteps: number;
    requireTap: boolean;
    // Drives the tap-hint copy on sub-screens ('card' → "Appuyez sur la carte").
    tapTarget?: 'card' | 'button';
    radius?: number;
    // Fallback rect used by SubScreenWalkthroughOverlay when the host screen
    // hasn't yet published a measured rect for `measureKey`. Lets the
    // walkthrough render a tooltip + halo at a sensible position even before
    // the on-screen element finishes laying out. Mirrors the `target` field
    // on CustomerStep.
    target?: { top?: number; bottom?: number; left?: number; right?: number; width?: number; height?: number; radius?: number };
  } | null;

  // Increments every time a blocked tap is absorbed somewhere in the demo
  // overlays. UI components subscribe and flash a "follow instructions"
  // toast so the user understands why their tap did nothing.
  tapHintTick: number;
  notifyTapHint: () => void;
  // Epoch-ms until which tap-hints are suppressed. Set briefly whenever the
  // demo advances (nextStep) so a stray SECOND tap during the post-advance
  // settle window — when the overlay is momentarily in its dim-only phase and
  // doesn't yet absorb taps — can't fall through to a still-mounted demo card
  // and wrongly flash "Suivez les instructions" right after a legit Suivant.
  suppressTapHintUntil: number;

  // ── Actions
  // Optional `init` lets callers override fields that `clearDemoState` would
  // otherwise wipe (e.g. demoCustomerActive) AND choose a non-zero starting
  // step. The welcome-cover "Start demo" handler uses `step: 1` to skip the
  // discover-tab intro halo and jump straight to the basket-card highlight
  // — the user already saw the cover, a second "welcome to Discover" beat
  // before they see the demo card reads as a wasted transition.
  startWalkthrough: (init?: Partial<Pick<WalkthroughState,
    'demoCustomerActive' | 'demoOrderActive' | 'demoBasketActive' | 'step'
  >>) => void;
  nextStep: (totalSteps: number) => void;
  skipWalkthrough: () => void;
  // Allows Settings → Mode démo to replay the walkthrough — flips the
  // persisted flag back to false so the next startWalkthrough() runs.
  resetWalkthroughCompletion: () => void;
  setShowSettingsOverlay: (v: boolean) => void;
  setShowDemoWelcome: (v: boolean) => void;

  setMeasuredRect: (key: MeasuredKey, r: ElementRect | null) => void;

  setDemoBasketActive: (v: boolean) => void;
  setDemoOrderActive: (v: boolean) => void;
  setDemoScanCode: (code: string | null) => void;
  setDemoCustomerActive: (v: boolean) => void;

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
  demoCustomerActive: false,
  verifyModalOpen: false,
  expandedDemoCard: false,
  showSettingsOverlay: false,
  showDemoWelcome: false,
  currentStep: null,
};

export const useWalkthroughStore = create<WalkthroughState>()(
  persist(
    (set, get) => ({
      step: null,
      hasCompletedWalkthrough: false,
      showSettingsOverlay: false,
      showDemoWelcome: false,
      measuredRects: {},
      demoBasketActive: false,
      demoOrderActive: false,
      demoScanCode: null,
      demoCustomerActive: false,
      verifyModalOpen: false,
      expandedDemoCard: false,
      currentStep: null,
      tapHintTick: 0,
      suppressTapHintUntil: 0,
      notifyTapHint: () => set((state) => {
        // Ignore hints fired during the brief post-advance suppression window
        // (a stray second tap right after Suivant) — see suppressTapHintUntil.
        if (Date.now() < state.suppressTapHintUntil) return state;
        return { tapHintTick: state.tapHintTick + 1 };
      }),

      // Keep measuredRects across starts. The previous implementation wiped
      // them to guard against stale rects from a prior run painting the
      // halo at the wrong place — but in practice every host that owns a
      // measureKey re-publishes via onLayout as soon as it mounts/renders,
      // and the customer demo always navigates forward to fresh screens, so
      // stale rects never actually survive long enough to matter. What the
      // wipe DID cause was the visible "no halo at step 1" jitter at demo
      // start: the home tab's first-card wrapper had already published its
      // rect while the cover was visible (demoCustomerActive=true mounts
      // the card → onLayout fires → rect set), then startWalkthrough()
      // wiped it, leaving the overlay to render only a dim mask until the
      // home tab's re-measure effect fired several frames later. Preserving
      // the rects across startWalkthrough means step 0's tab pill AND step
      // 1's basket card halo both paint at the correct position from the
      // first frame the cover unmounts.
      startWalkthrough: (init) =>
        set({ step: 0, ...clearDemoState, ...(init ?? {}) }),

      nextStep: (totalSteps: number) =>
        set((state) => {
          if (state.step === null) return state;
          const next = state.step + 1;
          // Suppress tap-hints through the next step's settle window so a stray
          // second tap right after this advance can't flash the toast.
          const suppressTapHintUntil = Date.now() + 600;
          if (next >= totalSteps) {
            // Reaching the last step counts as "completed" — the persisted
            // flag stops the walkthrough from auto-relaunching on next boot.
            return { step: null, hasCompletedWalkthrough: true, ...clearDemoState };
          }
          return { step: next, suppressTapHintUntil };
        }),

      // Skipping is the same as completing for the auto-launch gate. The user
      // explicitly opted out, so we mustn't keep nagging them on every reload —
      // they can replay the tour from Settings → Mode démo.
      skipWalkthrough: () => set({ step: null, hasCompletedWalkthrough: true, ...clearDemoState }),

      resetWalkthroughCompletion: () => set({ hasCompletedWalkthrough: false }),

      setShowSettingsOverlay: (v: boolean) => set({ showSettingsOverlay: v }),
      setShowDemoWelcome: (v: boolean) => set({ showDemoWelcome: v }),

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
      setDemoCustomerActive: (v: boolean) => set({ demoCustomerActive: v }),

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
