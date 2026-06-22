import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal, Platform, Dimensions, Animated, Image, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Search, X, RefreshCw, Settings, Bell, MapPin, ChevronDown, Hand, Store, ChevronRight } from 'lucide-react-native';

import { useRouter, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { BasketCard } from '@/src/components/BasketCard';
import { SkeletonLoader } from '@/src/components/SkeletonLoader';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { useAuthStore } from '@/src/stores/authStore';
import { MapFallback } from '@/src/components/MapFallback';
import { fetchLocations } from '@/src/services/restaurants';
import { fetchReviewMap } from '@/src/services/reviews';
import { useReviewMapStore } from '@/src/stores/reviewMapStore';
import { normalizeLocationToBasket } from '@/src/utils/normalizeRestaurant';
import { useHeroStore } from '@/src/stores/heroStore';
import { useAddressStore } from '@/src/stores/addressStore';
import { useSplashStore } from '@/src/stores/splashStore';
import { resolveAddressLabel } from '@/src/utils/addressLabel';
import { useNotificationStore } from '@/src/stores/notificationStore';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { buildDemoListingBasket, DEMO_LOCATION_ID } from '@/src/lib/demoData';
import { fetchHeroSlides, type HeroSlide } from '@/src/services/heroSlides';
import { isPickupExpiredInTz } from '@/src/utils/timezone';
import { useSwipeToDismiss } from '@/src/hooks/useSwipeToDismiss';
import { sharedScrollY, HERO_HEIGHT as SHARED_HERO_HEIGHT } from '@/src/lib/topBarScroll';
import { useStatusBarStyleOnFocus } from '@/src/hooks/useStatusBarStyleOnFocus';

const SCREEN_WIDTH = Dimensions.get('window').width;

let MapView: any = null;
let MapMarker: any = null;
let MapCircle: any = null;

if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
  MapMarker = maps.Marker;
  MapCircle = maps.Circle;
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [addressSuggestions, setAddressSuggestions] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const addressSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toggleBasketFavorite, isBasketFavorite } = useFavoritesStore();
  const { user } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showRadiusModal, setShowRadiusModal] = useState(false);
  const radiusSwipe = useSwipeToDismiss(() => setShowRadiusModal(false));
  const [radius, setRadius] = useState(5);
  const [carouselPage, setCarouselPage] = useState(0);
  const carouselRef = useRef<ScrollView>(null);
  // Address picker is now a full-page route
  const { addresses, selectedId, hydrate: hydrateAddresses } = useAddressStore();
  // Prefer the transient demo location (e.g. Grand Tunis) while demo mode is
  // active so cards/map show a distance even without a real saved address.
  const demoAddress = useAddressStore((s) => s.demoAddress);
  const selectedAddress = demoAddress ?? addresses.find((a) => a.id === selectedId) ?? null;
  const unreadCount = useNotificationStore((s) => s.unreadCount);


  useEffect(() => {
    void hydrateAddresses();
  }, [hydrateAddresses]);

  // Review-aggregate map: hydrated from AsyncStorage AND prefetched live at
  // app boot in the root layout (see app/_layout.tsx). By the time this tab
  // mounts the store already holds the previous session's cached map, so
  // rating chips paint INSTANTLY on first frame — no "N/A → loads later"
  // flash. The live useQuery below overrides as soon as the fresh response
  // lands, and persists back to the store for the next cold-start.
  const cachedReviewMap = useReviewMapStore((s) => s.map);
  const setReviewMap = useReviewMapStore((s) => s.setMap);

  // Hero/carousel scroll-away. The hero is the first item inside a single
  // vertical ScrollView; native scroll moves it out of view 1:1 with the
  // finger. Opacity, container bg, and the heroVisible flag are all derived
  // from scrollY — no JS spring, no layout-height animation, so the gesture
  // can't be raced (which was the iOS jitter and the Samsung rapid-refresh
  // cause).
  // HERO_HEIGHT + scrollY are shared via the topBarScroll singleton so the
  // floating map button in (tabs)/_layout.tsx can read the SAME scroll
  // progress and crossfade its colour in lock-step with the in-page
  // Settings / Bell icons. See src/lib/topBarScroll.ts for the rationale.
  const HERO_HEIGHT = SHARED_HERO_HEIGHT;
  const scrollY = sharedScrollY;
  // On a fresh (re)mount / app reload the native list always starts at the top,
  // but `scrollY` is a module singleton that can still hold a stale, collapsed
  // value from a previous mount — which makes heroOpacity/containerBg paint the
  // hero all white until the user scrolls a little. Snap it back to 0 on the
  // FIRST render (synchronously, before the interpolations read it) so the hero
  // is correct from the very first frame. The ref guard means it runs once per
  // mount, so a screen that stays mounted across tab switches keeps its scroll.
  // One-shot scroll-position reset for this HomeScreen instance. Moved into
  // a useEffect (was inline during render) because `sharedScrollY.setValue`
  // synchronously notifies every Animated.Value listener — including this
  // component's own listener below — which then calls setState. Doing that
  // during render is what triggers React's "Cannot update a component while
  // rendering a different component" warning, especially during the rapid
  // navigate-back from the cancel-reservation popup where two HomeScreen
  // instances overlap for a frame. The ref guarantees this only runs once
  // per fresh mount.
  const didInitScrollRef = useRef(false);
  useEffect(() => {
    if (didInitScrollRef.current) return;
    didInitScrollRef.current = true;
    sharedScrollY.setValue(0);
  }, []);
  const [heroVisible, setHeroVisible] = useState(true);
  const heroVisibleRef = useRef(true);
  const setHeroVisibleGlobal = useHeroStore((s) => s.setHeroVisible);
  // Drive the OS status bar from the same `heroVisible` flag the page uses for
  // its hero theming. Hook-based (not <StatusBar/>) so the style re-asserts on
  // every focus event — tabs stay mounted, and a one-shot useEffect push from
  // the declarative component would leave the bar stuck on whatever style the
  // last-visited tab set the next time the user returns here.
  useStatusBarStyleOnFocus(heroVisible ? 'light' : 'dark');

  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      const visible = value < HERO_HEIGHT * 0.5;
      if (visible !== heroVisibleRef.current) {
        heroVisibleRef.current = visible;
        setHeroVisible(visible);
        setHeroVisibleGlobal(visible);
      }
    });
    return () => scrollY.removeListener(id);
  }, [scrollY, setHeroVisibleGlobal]);

  // Snap the hero back to the top after a flow that re-enters the search feed
  // at the top (placing or cancelling an order). `scrollY` (sharedScrollY) is
  // JS-driven and only updated by onScroll; after that round-trip the native
  // list is at the top but scrollY is stale at its last collapsed value, so
  // heroOpacity/containerBg paint the hero all white until the user scrolls.
  // The reserve/cancel flows set a one-shot flag (heroStore.requestScrollReset)
  // and we consume it on focus (below) — so this NEVER fires on ordinary tab
  // switches and does NO data refetch.
  const resetHeroScroll = useCallback(() => {
    mainScrollRef.current?.scrollTo({ y: 0, animated: false });
    scrollY.setValue(0);
    heroVisibleRef.current = true;
    setHeroVisible(true);
    setHeroVisibleGlobal(true);
  }, [scrollY, setHeroVisibleGlobal]);

  const heroOpacity = scrollY.interpolate({
    inputRange: [0, HERO_HEIGHT * 0.6, HERO_HEIGHT],
    outputRange: [1, 0, 0],
    extrapolate: 'clamp',
  });

  // Container bg slides from green → light as the hero scrolls away
  const containerBg = scrollY.interpolate({
    inputRange: [0, HERO_HEIGHT],
    outputRange: ['#114b3c', theme.colors.bg],
    extrapolate: 'clamp',
  });

  // 0 → 1 progress along the hero collapse, used to crossfade every top-bar
  // icon + dropdown pill colour alongside the container bg. lucide icons
  // take a `color` STRING prop (not Animated.Value), so each icon position
  // is rendered as two stacked copies — one at the over-hero colour, one
  // at the over-white colour — gated by `opacity: colorProgress` /
  // `colorProgressInv`. The Map button in (tabs)/_layout.tsx reads from
  // the SAME `sharedScrollY` (this file's `scrollY`) so its colour eases
  // on the same timeline.
  const colorProgress = scrollY.interpolate({
    inputRange: [0, HERO_HEIGHT],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const colorProgressInv = Animated.subtract(1, colorProgress);
  // Dropdown pill's bg morphs from the translucent-white over-hero variant
  // to the surface colour over the light section.
  const dropdownPillBg = scrollY.interpolate({
    inputRange: [0, HERO_HEIGHT],
    outputRange: ['rgba(255,255,255,0.15)', theme.colors.surface],
    extrapolate: 'clamp',
  });

  // Locations rarely change mid-session. With the multi-tenant payload
  // growth in mind (more locations = bigger response), pay the cost
  // less often: 5-min staleTime + no background interval (we invalidate
  // on writes from the reservation / business flows). Opt back into
  // `refetchOnReconnect` since a stale list on the home feed after a
  // network blip is visible to the user. Dropped `refetchOnMount:
  // 'always'` — the global staleTime now handles freshness on entry.
  //
  // `enabled: !showSplash` defers this fetch until the splash dismisses.
  // The (tabs) tree mounts UNDER the splash, so without this gate the
  // request fires while BarakeatHaloSplash's rAF loop is still driving the
  // bouncing-B animation on the JS thread — JSON parse + normaliseLocation
  // for N locations is heavy enough to drop animation frames on Expo Go
  // and slow Android. The root layout's prefetch (app/_layout.tsx) is
  // already gated the same way and uses the same query key, so when the
  // splash dismisses the cache is populated and this hook re-renders
  // with data instantly — no second network round-trip.
  const showSplash = useSplashStore((s) => s.showSplash);
  // Stable RQ client handle — used by the useFocusEffect below to invalidate
  // ['locations'] on tab focus without putting the unstable locationsQuery
  // object in the callback deps (which caused an infinite refetch loop).
  const queryClient = useQueryClient();
  const locationsQuery = useQuery({
    queryKey: ['locations'],
    queryFn: fetchLocations,
    staleTime: 5 * 60_000,
    refetchOnReconnect: true,
    retry: 2,
    enabled: !showSplash,
  });

  // Stuck-loading watchdog. Symptom (rare, intermittent): the home tab shows
  // category chips but the basket list never populates — React Query's fetch
  // promise has gone silent (network glitch / connection dropped mid-request
  // / axios interceptor stalled / etc.) and the user has to manually
  // pull-to-refresh. Guard against it by force-refetching ONCE if we've been
  // fetching for >12 s without data ever arriving. Tight guard:
  //   - Only fires when there's NEVER been data (initial load). A refetch
  //     that takes 12 s with stale data on screen is annoying-but-fine;
  //     this only saves the "blank screen forever" case.
  //   - 12 s is well past the typical fetch (1-2 s) but below the user's
  //     pain threshold (~30 s before they manually refresh).
  //   - Single force-refetch, no loop. If the refetch ALSO hangs, the user
  //     will pull-to-refresh — we don't want a runaway recovery loop.
  React.useEffect(() => {
    if (!locationsQuery.isFetching) return;
    if (locationsQuery.data !== undefined) return;
    const t = setTimeout(() => {
      if (locationsQuery.isFetching && locationsQuery.data === undefined) {
        console.warn('[home] locations fetch stuck > 12s — forcing refetch');
        void locationsQuery.refetch();
      }
    }, 12_000);
    return () => clearTimeout(t);
  }, [locationsQuery.isFetching, locationsQuery.data, locationsQuery.refetch]);

  // Reviews are fetched per-location via /api/reviews/restaurant/:id with
  // concurrency capped to 3 inside fetchReviewMap (the platform-wide
  // /api/reviews endpoint 404s). The sorted-id signature in the query key
  // means the cache invalidates only when the location set actually changes.
  //
  // Cadence is aligned with locationsQuery (staleTime 30s, refetchInterval
  // 60s, refetchOnMount: 'always') so ratings stay in sync with the rest of
  // the card data. The query is prefetched at app boot from the root layout
  // using the same key, so by the time this hook runs the cache is usually
  // already populated.
  // Only fan out /api/reviews/restaurant/:id for locations whose rating the
  // backend did NOT already embed as `avg_rating`. With the bulk aggregate
  // now shipped on /api/locations, this list is normally empty → the query
  // below is disabled and fires ZERO review requests. It only does real work
  // against an older backend that hasn't rolled out avg_rating yet.
  const locationIdsSig = useMemo(() => {
    const ids = (locationsQuery.data ?? [])
      .filter((l) => l.avg_rating == null)
      .map((l) => Number(l.id))
      .filter((n) => !Number.isNaN(n));
    ids.sort((a, b) => a - b);
    return ids.join(',');
  }, [locationsQuery.data]);
  const reviewsQuery = useQuery({
    queryKey: ['review-map', locationIdsSig],
    queryFn: () => fetchReviewMap(locationIdsSig ? locationIdsSig.split(',') : []),
    enabled: locationIdsSig.length > 0,
    staleTime: 5 * 60_000,
    // Reviews live in the /api/reviews writeLimiter bucket (20 req/min);
    // each fetch makes one request per location. With many locations
    // this used to flood the bucket. Now: fetched once per session and
    // refreshed on demand (invalidated when a new review lands).
    retry: (failureCount, error: any) => {
      if (error?.status === 429 || error?.response?.status === 429) return false;
      return failureCount < 2;
    },
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
  });

  // Refetch when the home tab regains focus (tabs stay mounted across navigation,
  // so refetchOnMount isn't enough — the business could edit a basket, switch
  // back to home, and see stale data otherwise).
  //
  // Also re-sync the global `heroVisible` from the current scrollY. The
  // global is shared with the tab layout's map-button color logic and can
  // drift stale when the user navigates between tabs rapidly or the index
  // remounts (e.g. after deep navigation). Without this sync, the icon
  // could read yellow over a fully-white bg (or dark-green over a
  // green hero) until the user touches the scroll view.
  useFocusEffect(
    useCallback(() => {
      // CRITICAL: do NOT put `locationsQuery` (the whole RQ query object)
      // in deps — RQ returns a new object on every render, so it would
      // make the callback identity change on every render, useFocusEffect
      // would re-fire on every change while focused, and refetch() would
      // trigger a state update → re-render → new callback → re-fetch.
      // Infinite refetch loop. Use queryClient.invalidateQueries instead;
      // queryClient is a stable context value and the invalidate triggers
      // exactly one refetch per focus event.
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      // Consume a pending hero-scroll reset (set after placing/cancelling an
      // order). This is the fix for the "hero is white after I order and come
      // back to search" case: snap the list + shared scroll value to the top.
      if (useHeroStore.getState().consumeScrollReset()) {
        resetHeroScroll();
      } else {
        const currentScroll = (scrollY as any)._value ?? 0;
        const shouldBeVisible = currentScroll < HERO_HEIGHT * 0.5;
        heroVisibleRef.current = shouldBeVisible;
        setHeroVisible(shouldBeVisible);
        setHeroVisibleGlobal(shouldBeVisible);
      }
    }, [queryClient, scrollY, setHeroVisibleGlobal, resetHeroScroll])
  );

  // Build card data: one card per location.
  // Rating source priority:
  //   1. `loc.avg_rating` / `loc.review_count` from the locations response
  //      (fast path — set by normalizeLocationToBasket already)
  //   2. Client-computed average from /api/reviews as a fallback when (1)
  //      is missing (bridge while the backend rolls out aggregate columns;
  //      see services/restaurants.ts LocationFromAPI for the contract).
  // Once the backend ships avg_rating/review_count on /api/locations, the
  // reviewsQuery fallback below becomes a no-op and the global review
  // fetch can be removed entirely.
  // Mirror every fresh live response into the persistent store so the next
  // cold-start has up-to-date ratings before the network resolves.
  useEffect(() => {
    if (reviewsQuery.data && Object.keys(reviewsQuery.data).length > 0) {
      setReviewMap(reviewsQuery.data);
    }
  }, [reviewsQuery.data, setReviewMap]);

  const baskets = useMemo(() => {
    const locations = locationsQuery.data ?? [];
    // Prefer fresh live data; fall back to AsyncStorage-cached map so cards
    // render ratings on first paint instead of flashing N/A.
    const rmap = reviewsQuery.data ?? cachedReviewMap ?? {};
    return locations.map((loc) => {
      const basket = normalizeLocationToBasket(loc);
      if (basket.merchantRating == null) {
        const summary = rmap[String(loc.id)];
        if (summary) {
          basket.merchantRating = summary.avg;
          basket.reviewCount = summary.count;
        }
      }
      return basket;
    });
  }, [locationsQuery.data, reviewsQuery.data, cachedReviewMap]);

  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    baskets.forEach((b) => {
      if (b.category && b.category !== 'all') cats.add(b.category);
    });
    return ['all', ...Array.from(cats)];
  }, [baskets]);

  // Haversine distance in km
  const distKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const filteredBaskets = useMemo(() => {
    let result = baskets;
    if (activeCategory !== 'all') {
      result = result.filter((b) => b.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.merchantName.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q) ||
          (b.address && b.address.toLowerCase().includes(q))
      );
    }

    // User location for proximity sorting
    const userLat = selectedAddress?.lat;
    const userLng = selectedAddress?.lng;
    const hasUserLoc = userLat != null && userLng != null && isFinite(userLat) && isFinite(userLng);

    // Sort: open & available first, then closed-for-today, then sold-out/unavailable
    const isPickupClosed = (b: typeof result[0]) => isPickupExpiredInTz(b.pickupWindow?.end);
    result = [...result].sort((a, b) => {
      const aAvail = a.isActive && a.quantityLeft > 0;
      const bAvail = b.isActive && b.quantityLeft > 0;
      const aClosed = aAvail && isPickupClosed(a);
      const bClosed = bAvail && isPickupClosed(b);
      // Tier: 0 = open & available, 1 = closed for today, 2 = unavailable
      const aTier = !aAvail ? 2 : aClosed ? 1 : 0;
      const bTier = !bAvail ? 2 : bClosed ? 1 : 0;
      if (aTier !== bTier) return aTier - bTier;

      // Within the same tier, sort by distance if user location is known
      if (hasUserLoc) {
        const aDist = a.hasCoords ? distKm(userLat!, userLng!, a.latitude!, a.longitude!) : Infinity;
        const bDist = b.hasCoords ? distKm(userLat!, userLng!, b.latitude!, b.longitude!) : Infinity;
        return aDist - bDist;
      }
      return 0;
    });

    // Compute distance in km for each basket (for card display)
    if (hasUserLoc) {
      result = result.map(b => ({
        ...b,
        distance: b.hasCoords ? Math.round(distKm(userLat!, userLng!, b.latitude!, b.longitude!) * 10) / 10 : 0,
      }));
    }

    return result;
  }, [baskets, activeCategory, searchQuery, selectedAddress]);

  // During the customer demo, inject the synthetic "Café Démo" basket at
  // the top of the list so the walkthrough's firstBasketCard step lands on
  // a card whose merchantId === 'demo' (and so tapping it routes to
  // /restaurant/demo where the demo flow takes over). Filter out any other
  // accidental id collision so we never render two cards with id='demo'.
  const demoCustomerActive = useWalkthroughStore((s) => s.demoCustomerActive);

  // Reset Home's scroll position when the walkthrough advances to one of the
  // steps that targets a home-tab element. Tab screens preserve scroll
  // position across navigation, so without this the demo would replay step
  // halos at the user's pre-demo scroll offset (e.g. the first-basket card
  // off-screen, the map/notif buttons covered by the collapsed hero).
  //
  // CRITICAL: never call `setMeasuredRect(key, null)` here. The list-wrapper
  // onLayout only fires on actual layout changes, NOT on scroll — so a null
  // clear with no guaranteed re-publish leaves the layout overlay stuck on
  // its "dim mask only" branch (no halo, no tooltip), which is exactly the
  // "faded screen after pickup-code" symptom users hit. Instead we scroll
  // first, then re-measure the first-card wrapper ref directly so the
  // post-scroll window y is republished as the source of truth.
  const mainScrollRef = useRef<ScrollView>(null);
  const firstCardWrapperRef = useRef<View>(null);
  const walkthroughMeasureKey = useWalkthroughStore((s) => s.currentStep?.measureKey);
  // Walkthrough step index — used as the entry-point trigger so we can
  // scroll the search page back to top THE MOMENT the demo starts (not
  // only when the first homeKeys step arrives). Without this, a user who
  // starts the demo while scrolled down sees step 0's halo (the Discover
  // tab pill) painted over a scrolled-away hero, and the header re-sync
  // (heroVisible, mapBtnAnim) races the first halo measurement.
  const walkthroughStep = useWalkthroughStore((s) => s.step);
  useEffect(() => {
    // Run the home reset as soon as the demo ARMS — `demoCustomerActive`
    // flips true under the welcome cover (settings sets it before showing the
    // cover), a beat BEFORE `step` becomes 0. The home tab is REUSED across
    // the settings round-trip (not remounted), so it keeps whatever scroll
    // offset the user left it at. Previously we only reset at `step === 0`,
    // which fires the instant the cover unmounts — so the scroll-to-top + hero
    // reset happened in full view of the just-shown dim mask. THAT was the
    // "refresh flicker right after tapping Démarrer la démo". Doing it while
    // the cover still hides the screen makes the demo's first frame land on an
    // already-settled home. The `step === 0` branch stays as a safety net for
    // any path that reaches step 0 without the cover.
    if (!demoCustomerActive && walkthroughStep !== 0) return;
    // Reset hero scroll AND the heroVisible flag so the layout's
    // map-button colour + position math reads "we're at the top" on the
    // very first halo paint.
    mainScrollRef.current?.scrollTo({ y: 0, animated: false });
    heroVisibleRef.current = true;
    setHeroVisible(true);
    setHeroVisibleGlobal(true);
  }, [demoCustomerActive, walkthroughStep, setHeroVisibleGlobal]);
  useEffect(() => {
    const homeKeys = new Set([
      'firstBasketCard',
      'favoriteHeart',
      'notifBell',
      'mapButton',
    ]);
    if (!walkthroughMeasureKey || !homeKeys.has(walkthroughMeasureKey)) return;
    mainScrollRef.current?.scrollTo({ y: 0, animated: false });
    // For list-positioned elements (first card + the favorite heart
    // derived from it), republish a fresh rect after the scroll settles.
    // The header elements (notifBell, mapButton) sit in fixed-position
    // chrome whose window y doesn't change with scroll, so their existing
    // onLayout-published rect remains valid — no re-measure needed.
    if (walkthroughMeasureKey === 'firstBasketCard' || walkthroughMeasureKey === 'favoriteHeart') {
      // Re-measure on the next frame. The previous `setTimeout(150)` was
      // there to "let the scroll settle", but the scrollTo above runs with
      // animated: false (synchronous), so the layout is correct by the
      // next paint — the 150 ms only added a visible gap where the overlay
      // showed a featureless dim mask while it waited for the rect to be
      // re-published. requestAnimationFrame fires after the next layout
      // pass without any artificial wait.
      const raf = requestAnimationFrame(() => {
        firstCardWrapperRef.current?.measureInWindow((x, y, w, h) => {
          if (w <= 0 || h <= 0) return;
          const set = useWalkthroughStore.getState().setMeasuredRect;
          set('firstBasketCard', { x, y, w, h });
          // Same derivation as the onLayout publisher at the wrapper below.
          set('favoriteHeart', { x: x + w - 44, y: y + 8, w: 34, h: 34 });
        });
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [walkthroughMeasureKey]);
  const demoListingBasket = useMemo(
    () => buildDemoListingBasket({
      merchantName: t('walkthrough.customer.demoLocationName', { defaultValue: 'Chez Joe (démo)' }),
      name: t('walkthrough.customer.demoBasketName', { defaultValue: 'Panier Surprise' }),
      description: t('walkthrough.customer.demoBasketDesc', { defaultValue: 'Démonstration — aucune commande réelle n\'est créée.' }),
    }),
    [t],
  );
  const listBaskets = useMemo(
    () => (demoCustomerActive
      ? [demoListingBasket, ...filteredBaskets.filter((b) => b.id !== DEMO_LOCATION_ID)]
      : filteredBaskets),
    [demoCustomerActive, demoListingBasket, filteredBaskets],
  );

  // Location suggestions: when searching, show locations that match by name/address
  // even if they don't have matching baskets — lets user navigate to the location page
  const locationSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const locations = locationsQuery.data ?? [];
    // IDs of locations already shown as basket cards
    const shownIds = new Set(filteredBaskets.map(b => b.merchantId));
    return locations
      .filter(loc => {
        if (shownIds.has(String(loc.id))) return false;
        const name = (loc.display_name ?? loc.name ?? '').toLowerCase();
        const addr = (loc.address ?? '').toLowerCase();
        return name.includes(q) || addr.includes(q);
      })
      .slice(0, 5);
  }, [searchQuery, locationsQuery.data, filteredBaskets]);

  // Nominatim address autocomplete — debounced
  const fetchAddressSuggestions = useCallback((query: string) => {
    if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);
    if (query.length < 3) { setAddressSuggestions([]); return; }
    addressSearchTimer.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          format: 'json', q: query, limit: '5',
          viewbox: '7.5,30.2,11.6,37.5', bounded: '0', 'accept-language': 'fr',
        });
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
        const data = await resp.json();
        setAddressSuggestions(data ?? []);
      } catch { setAddressSuggestions([]); }
    }, 500);
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    fetchAddressSuggestions(text);
  }, [fetchAddressSuggestions]);

  const handleAddressSuggestionPress = useCallback(async (suggestion: { display_name: string; lat: string; lon: string }) => {
    const shortLabel = suggestion.display_name.split(',')[0] ?? suggestion.display_name;
    await useAddressStore.getState().addAddress({ label: shortLabel, lat: parseFloat(suggestion.lat), lng: parseFloat(suggestion.lon) });
    setSearchQuery('');
    setAddressSuggestions([]);
  }, []);

  const handleCategoryPress = useCallback((cat: string) => {
    setActiveCategory(cat);
  }, []);

  // Defensive 2-second guard so /api/locations can't get hammered to 429 even
  // if the user mashes pull-to-refresh.
  const lastRefreshAtRef = useRef(0);
  const handleRefresh = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefreshAtRef.current < 2000) return;
    lastRefreshAtRef.current = now;
    setRefreshing(true);
    await Promise.allSettled([
      locationsQuery.refetch(),
      reviewsQuery.refetch(),
    ]);
    setRefreshing(false);
  }, [locationsQuery, reviewsQuery]);

  const firstName = user?.firstName ?? user?.name?.split(' ')[0] ?? '';
  const userGender = (user as any)?.gender ?? null; // 'male', 'female', or null

  // Hero slides are admin-curated and near-static. 15s was overkill —
  // bumped to 15 min so a quick tab swap doesn't refetch and a long
  // session doesn't keep pulling. The focus-refetch below is also
  // dropped (it was firing every home-tab focus, which is constant
  // for a typical user). Admin edits propagate on next cold start or
  // when the cache GCs after 24h.
  const heroSlidesQuery = useQuery({
    queryKey: ['hero-slides'],
    queryFn: fetchHeroSlides,
    staleTime: 15 * 60_000,
  });
  const dynamicSlides = heroSlidesQuery.data ?? [];

  // Total pages = 1 (welcome) + dynamic slides
  const totalCarouselPages = 1 + dynamicSlides.length;
  const carouselWidth = SCREEN_WIDTH - 40;

  // Auto-scroll carousel every 10s
  useEffect(() => {
    if (totalCarouselPages <= 1) return;
    const timer = setInterval(() => {
      setCarouselPage((prev) => {
        const next = (prev + 1) % totalCarouselPages;
        carouselRef.current?.scrollTo({ x: next * carouselWidth, animated: true });
        return next;
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [carouselWidth, totalCarouselPages]);

  // Only place markers for restaurants that have real backend coordinates
  const mapMarkers = baskets
    .filter((b) => b.hasCoords)
    .map((b) => ({ id: b.id, name: b.merchantName, lat: b.latitude as number, lng: b.longitude as number }));

  return (
    <Animated.View style={[styles.container, { backgroundColor: containerBg }]}>
      {/* Status bar style is managed by useStatusBarStyleOnFocus at the top
          of the component — using the focus-aware hook instead of the
          declarative <StatusBar/> so the style re-asserts whenever the user
          returns to this tab (tabs stay mounted, so a one-shot useEffect
          push from <StatusBar/> would otherwise be overwritten by the last
          tab the user visited). */}

      {/* Fixed top bar — always visible, colors shift as hero collapses */}
      <View style={{
        paddingTop: insets.top,
        paddingHorizontal: 16,
        paddingBottom: 4,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <TouchableOpacity
          onPress={() => router.push('/address-picker' as never)}
          accessibilityRole="button"
          accessibilityLabel={selectedAddress?.label ?? t('home.chooseLocation')}
          accessibilityHint={t('home.chooseLocation', { defaultValue: 'Choose location' })}
          // Nudge the chip down so its text optical centre lines up with the
          // 20 px Settings / Bell icons on the right side (which sit at the
          // geometric centre of their 34×34 wrappers).
          style={{ marginTop: 4 }}
        >
          {/* Animated wrapper — pill bg crossfades with the container bg as
              the hero collapses. Inner content is rendered as two stacked
              copies per glyph so each colour eases through opacity, since
              the lucide colour prop can't take an Animated.Value. */}
          <Animated.View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              height: 34,
              backgroundColor: dropdownPillBg,
              borderRadius: 17,
              paddingHorizontal: 12,
            }}
          >
            <View style={{ width: 13, height: 13 }}>
              <Animated.View style={{ position: 'absolute', opacity: colorProgressInv }}>
                <MapPin size={13} color="#e3ff5c" />
              </Animated.View>
              <Animated.View style={{ position: 'absolute', opacity: colorProgress }}>
                <MapPin size={13} color={theme.colors.primary} />
              </Animated.View>
            </View>
            <View style={{ maxWidth: 130 }}>
              <Animated.Text
                style={{ color: '#fff', fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', opacity: colorProgressInv }}
                numberOfLines={1}
              >
                {selectedAddress ? resolveAddressLabel(selectedAddress.label, t) : t('home.chooseLocation')}
              </Animated.Text>
              <Animated.Text
                style={{ position: 'absolute', color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', opacity: colorProgress }}
                numberOfLines={1}
              >
                {selectedAddress ? resolveAddressLabel(selectedAddress.label, t) : t('home.chooseLocation')}
              </Animated.Text>
            </View>
            <View style={{ width: 13, height: 13 }}>
              <Animated.View style={{ position: 'absolute', opacity: colorProgressInv }}>
                <ChevronDown size={13} color="rgba(255,255,255,0.7)" />
              </Animated.View>
              <Animated.View style={{ position: 'absolute', opacity: colorProgress }}>
                <ChevronDown size={13} color={theme.colors.textSecondary} />
              </Animated.View>
            </View>
          </Animated.View>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 34 }}>
          {/* Spacer — the map button is rendered by the tab layout overlay so it can animate between tabs */}
          <View pointerEvents="none" style={{ width: 34, height: 34 }} />
          {/* Fixed 34x34 touch targets so the Settings / Bell icons sit on
              the same horizontal centerline as the map-button spacer. Without
              the explicit box, Android collapses each TouchableOpacity to the
              20px icon and the icons drift to the top of the row. */}
          <TouchableOpacity
            onPress={() => router.push('/settings' as never)}
            accessibilityLabel={t('settings.title', { defaultValue: 'Settings' })}
            accessibilityRole="button"
            style={{ width: 34, height: 34, justifyContent: 'center', alignItems: 'center' }}
            // Small L/R because bell sits ~10 px to the right; full T/B since
            // the row has nothing above or below to overlap.
            hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
          >
            {/* Crossfade between neon (over hero) and textPrimary (over white)
                so the icon colour eases alongside the container bg instead of
                snapping at the heroVisible threshold. */}
            <View style={{ width: 20, height: 20 }}>
              <Animated.View style={{ position: 'absolute', opacity: colorProgressInv }}>
                <Settings size={20} color="#e3ff5c" />
              </Animated.View>
              <Animated.View style={{ position: 'absolute', opacity: colorProgress }}>
                <Settings size={20} color={theme.colors.textPrimary} />
              </Animated.View>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/notifications' as never)}
            accessibilityLabel={t('notifications.title', { defaultValue: 'Notifications' })}
            accessibilityRole="button"
            style={{ width: 34, height: 34, justifyContent: 'center', alignItems: 'center' }}
            hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
            // Publish THIS bell's measurement to the walkthrough store. On
            // the search tab this is the VISIBLE bell (the layout's bell at
            // top: insets.top + 7 has opacity 0 here), so anchoring the
            // halo to this wrapper is what makes the halo actually wrap
            // around what the user sees. The layout's bell also publishes
            // (via its own onLayout) — the most-recent setMeasuredRect
            // wins, so when the search tab is active and renders, this
            // measurement takes precedence.
            //
            // Symmetric +4 expansion: 34×34 wrapper → 42×42 halo centred
            // on the wrapper (which is centred on the icon).
            onLayout={(e) => {
              (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
                if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('notifBell', { x: x - 4, y: y - 4, w: w + 8, h: h + 8 });
              });
            }}
          >
            {/* Anchor for the badge — sized to the icon so the badge sits
                just above/right of the bell glyph the same way it did before
                the 34x34 touch target was added. */}
            <View>
              <View style={{ width: 20, height: 20 }}>
                <Animated.View style={{ position: 'absolute', opacity: colorProgressInv }}>
                  <Bell size={20} color="#e3ff5c" />
                </Animated.View>
                <Animated.View style={{ position: 'absolute', opacity: colorProgress }}>
                  <Bell size={20} color={theme.colors.textPrimary} />
                </Animated.View>
              </View>
              {unreadCount > 0 && (
                <View style={{
                  position: 'absolute',
                  top: -4,
                  right: -6,
                  backgroundColor: theme.colors.error,
                  borderRadius: 8,
                  minWidth: 16,
                  height: 16,
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingHorizontal: 4,
                }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Single vertical ScrollView. The hero is the first item — native scroll
          moves it out of view 1:1 with the finger. The search bar wrapper is
          the sticky header (stickyHeaderIndices={[1]}). RefreshControl only
          fires on a true pull-down at offset 0, so the Samsung rapid-fire
          refresh (caused by the old JS layout-height spring shifting content
          under the finger) can no longer trigger. */}
      <Animated.ScrollView
        ref={mainScrollRef as any}
        style={{ flex: 1 }}
        // paddingBottom moved INTO the cards section View below. Was here on
        // the contentContainer, which left a 120 px gap between the cards View's
        // light bottom edge and the contentContainer's bottom edge. That gap
        // showed the Animated parent's containerBg interpolation — green at
        // the top of the scroll, light only after scrolling past the hero —
        // producing a green strip above the tab bar on short lists / partial
        // scrolls. With paddingBottom now inside the cards View, its light
        // background covers all the way down to the tab bar regardless of
        // scrollY.
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        stickyHeaderIndices={[1]}
        keyboardShouldPersistTaps="handled"
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false },
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void handleRefresh(); }}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        {/* [0] Hero — carousel + dots. Fixed height; fades and scrolls away. */}
        <Animated.View style={{ height: HERO_HEIGHT, opacity: heroOpacity, overflow: 'hidden', paddingHorizontal: 20 }}>
          <ScrollView
            ref={carouselRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            onMomentumScrollEnd={(e) => {
              const page = Math.round(e.nativeEvent.contentOffset.x / carouselWidth);
              setCarouselPage(page);
            }}
            style={{ width: carouselWidth }}
          >
            {/* Page 1: Welcome — always present */}
            <View style={{ width: carouselWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={{
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 14,
                  fontFamily: 'Poppins_400Regular',
                }}>
                  {t('home.welcomeBack')}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 6 }}>
                  <Text style={{
                    color: '#fff',
                    fontSize: 24,
                    fontWeight: '700',
                    fontFamily: 'Poppins_700Bold',
                  }}>
                    {firstName || t('home.search')}
                  </Text>
                  <Hand size={24} color="rgba(255,255,255,0.9)" />
                </View>
              </View>
              {/* Hero image — gender-based */}
              <Image
                source={userGender === 'female'
                  ? require('@/assets/images/woman_holding_basket-removebg-preview.png')
                  : require('@/assets/images/man_holding_basket-removebg-preview.png')}
                style={{ width: HERO_HEIGHT * 0.68, height: HERO_HEIGHT * 0.92, marginLeft: 4 }}
                resizeMode="contain"
                accessibilityLabel={t('home.heroImage', { defaultValue: 'Person holding a food basket' })}
              />
            </View>
            {/* Dynamic slides from API */}
            {dynamicSlides.map((slide: HeroSlide) => {
              const imgW = slide.image_size ?? HERO_HEIGHT * 0.5;
              const imgH = Math.round(imgW * 1.36);
              const alignMap: Record<string, 'flex-start' | 'center' | 'flex-end'> = { top: 'flex-start', center: 'center', bottom: 'flex-end' };
              const textJustify = alignMap[slide.text_align_v ?? 'center'] ?? 'center';
              const titleSize = slide.title_font_size ?? 18;
              const subtitleOp = slide.subtitle_opacity ?? 0.7;
              const imgOp = slide.image_opacity ?? 1;
              const offsetY = slide.text_offset_y ?? 0;
              return (
              <View key={slide.id} style={{ width: carouselWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, justifyContent: textJustify, transform: [{ translateY: offsetY }] }}>
                  {slide.subtitle ? (
                    <Text style={{
                      color: `rgba(255,255,255,${subtitleOp})`,
                      fontSize: 12,
                      fontFamily: 'Poppins_400Regular',
                    }}>
                      {slide.subtitle}
                    </Text>
                  ) : null}
                  <Text style={{
                    color: slide.text_color ?? '#fff',
                    fontSize: titleSize,
                    fontWeight: '700',
                    fontFamily: 'Poppins_700Bold',
                    marginTop: 4,
                  }}>
                    {slide.title}
                  </Text>
                </View>
                {slide.image_url ? (
                  <Image
                    source={{ uri: slide.image_url }}
                    style={{ width: imgW, height: imgH, marginLeft: 8, opacity: imgOp }}
                    resizeMode="contain"
                  />
                ) : (
                  <Image
                    source={userGender === 'female'
                      ? require('@/assets/images/woman_holding_basket-removebg-preview.png')
                      : require('@/assets/images/man_holding_basket-removebg-preview.png')}
                    style={{ width: imgW, height: imgH, marginLeft: 8, opacity: imgOp }}
                    resizeMode="contain"
                  />
                )}
              </View>
              );
            })}
          </ScrollView>

          {/* Dot indicators */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 6, marginBottom: 24 }}>
            {Array.from({ length: totalCarouselPages }, (_, i) => (
              <View
                key={i}
                style={{
                  width: carouselPage === i ? 20 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: carouselPage === i ? '#e3ff5c' : 'rgba(255,255,255,0.3)',
                  marginHorizontal: 3,
                }}
              />
            ))}
          </View>
        </Animated.View>

        {/* [1] STICKY: rounded white card top + drag handle + search bar.
            Pins under the top bar once the hero scrolls past it.
            Corner-crack mitigation: this sheet's background colour
            (`theme.colors.bg`, #fcfcfa) is intentionally one shade off
            from individual card surfaces (`theme.colors.surface`,
            #FFFFFF). When a card scrolled past the sticky sheet, its
            brighter-white edge used to peek out of the corner triangles
            (area outside the curve but inside the bounding rect). The
            actual fix is two-pronged below:
              1. `overflow: 'hidden'` here clips children to the rounded
                 shape so they can't extend past the curve.
              2. The card list (`[2]` below) uses `paddingHorizontal: 28+`
                 so individual cards never reach into the horizontal
                 zone where the corner triangles live (28 = the radius).
            Together, the only thing that ever shows in the corner
            triangles is the cards-container bg, which is the same
            colour as this sheet — so the curve transition stays clean
            in every scroll position. */}
        <View style={{
          backgroundColor: theme.colors.bg,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          marginTop: -16,
          overflow: 'hidden',
        }}>
          {/* Drag handle (visual indicator) */}
          <View style={{ alignItems: 'center', paddingTop: 6, paddingBottom: 6 }}>
            <View style={{
              width: 44,
              height: 5,
              borderRadius: 3,
              backgroundColor: theme.colors.muted + '40',
            }} />
          </View>

          <View style={{ paddingHorizontal: theme.spacing.xl, paddingBottom: 6 }}>
            <View
              style={[
                styles.searchBar,
                {
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radii.r12,
                  ...theme.shadows.shadowSm,
                  height: 44,
                  alignItems: 'center',
                },
              ]}
            >
              <Search size={18} color={theme.colors.muted} />
              <TextInput
                style={[
                  styles.searchInput,
                  { color: theme.colors.textPrimary, fontFamily: 'Poppins_400Regular', fontSize: 14, flex: 1, textAlign: 'left' },
                ]}
                placeholder={t('home.searchPlaceholder')}
                placeholderTextColor={theme.colors.muted}
                value={searchQuery}
                onChangeText={handleSearchChange}
                returnKeyType="search"
                textAlignVertical="center"
                accessibilityLabel={t('home.searchPlaceholder')}
                accessibilityRole="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  style={{ padding: 4 }}
                  hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                  accessibilityLabel={t('common.clear', { defaultValue: 'Clear search' })}
                  accessibilityRole="button"
                >
                  <X size={16} color={theme.colors.muted} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* [2] Categories + cards — white bg continues seamlessly from sticky.
            flexGrow:1 so the white bg fills the remaining viewport when the
            list is short (error/empty states), otherwise the dark-green
            container bg at scrollY=0 shows through below the card.
            Keep paddingHorizontal at theme.spacing.xl to match the
            search bar — the user explicitly preferred the tighter
            horizontal spacing here. The corner-triangle "crack" the
            previous bump was guarding against is handled by the sticky
            sheet's `overflow: 'hidden'` alone in practice.
            `marginTop: -1` overlaps the sticky sheet's bottom edge by one
            pixel. Both surfaces use the same cream bg so the overlap is
            invisible, but it closes the subpixel gap that some Android
            devices were exposing — the root container's dark-green tint
            was bleeding through there as a thin horizontal line between
            the search bar and the category pills. */}
        <View style={{ backgroundColor: theme.colors.bg, paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.sm, paddingBottom: 120, marginTop: -1, flexGrow: 1 }}>
          <View style={[styles.categoriesSection, { marginBottom: theme.spacing.lg }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled
              contentContainerStyle={{ paddingRight: theme.spacing.xl, paddingVertical: 4 }}
            >
              {availableCategories.map((cat) => {
                const isActive = activeCategory === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => handleCategoryPress(cat)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t(`home.categories.${cat}`, { defaultValue: cat })}
                    accessibilityState={{ selected: isActive }}
                    style={[
                      styles.categoryPill,
                      {
                        backgroundColor: isActive ? theme.colors.primary : theme.colors.surface,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: isActive ? theme.colors.primary : theme.colors.divider,
                        marginRight: theme.spacing.sm,
                        paddingHorizontal: theme.spacing.lg,
                        paddingVertical: 8,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        {
                          color: isActive ? '#fff' : theme.colors.textPrimary,
                          ...theme.typography.bodySm,
                          fontWeight: isActive ? ('600' as const) : ('400' as const),
                        },
                      ]}
                    >
                      {t(`home.categories.${cat}`, { defaultValue: cat })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
          {locationsQuery.isLoading && !demoCustomerActive ? (
            <>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={{ marginBottom: 16, backgroundColor: theme.colors.surface, borderRadius: 16, overflow: 'hidden', padding: 12 }}>
                  <SkeletonLoader height={120} borderRadius={12} style={{ marginBottom: 10 }} />
                  <SkeletonLoader height={14} width="60%" borderRadius={6} style={{ marginBottom: 6 }} />
                  <SkeletonLoader height={12} width="40%" borderRadius={6} />
                </View>
              ))}
            </>
          ) : locationsQuery.isError && !locationsQuery.data && !demoCustomerActive ? (
            // Only blank the list on first-load failure. If a background
            // refetch fails after we already had data, keep showing the
            // cached cards — React Query will try again on the next interval
            // tick, focus event, or pull-to-refresh.
            <View style={styles.centerState}>
              <Text style={[{ color: theme.colors.error, ...theme.typography.body, textAlign: 'center' as const, marginBottom: 16 }]}>
                {t('common.errorOccurred')}
              </Text>
              <TouchableOpacity
                onPress={() => { locationsQuery.refetch(); }}
                style={[styles.retryButton, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12 }]}
                accessibilityLabel={t('common.retry')}
                accessibilityRole="button"
              >
                <RefreshCw size={16} color="#fff" />
                <Text style={[{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 8 }]}>
                  {t('common.retry')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : listBaskets.length === 0 && locationSuggestions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' as const, marginTop: 40, paddingHorizontal: 20 }]}>
                {t('home.emptyState.noBaskets')}
              </Text>
            </View>
          ) : (
            <>
              {listBaskets.map((basket, idx) => {
                const isFirst = idx === 0;
                const card = (
                  <BasketCard
                    key={basket.id}
                    basket={basket}
                    isFavorite={isBasketFavorite(basket.id)}
                    onFavoritePress={() => toggleBasketFavorite(basket.id)}
                  />
                );
                // Wrap the first card in a measured View — the walkthrough
                // overlay reads firstBasketCard + favoriteHeart from the
                // store. Heart sits at top:10, right:10 inside the image
                // (~32×32), so derive its rect from the card's window coords.
                if (!isFirst) return card;
                return (
                  <View
                    key={basket.id}
                    ref={firstCardWrapperRef}
                    onLayout={(e) => {
                      (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
                        if (w <= 0 || h <= 0) return;
                        const set = useWalkthroughStore.getState().setMeasuredRect;
                        set('firstBasketCard', { x, y, w, h });
                        set('favoriteHeart', { x: x + w - 44, y: y + 8, w: 34, h: 34 });
                      });
                    }}
                  >
                    {card}
                  </View>
                );
              })}

              {/* Address suggestions from Nominatim */}
              {searchQuery.trim() && addressSuggestions.length > 0 && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: filteredBaskets.length > 0 || locationSuggestions.length > 0 ? 20 : 0, marginBottom: 14 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginHorizontal: 12 }}>
                      {t('home.searchByAddress', { defaultValue: 'Rechercher par adresse' })}
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                  </View>
                  {addressSuggestions.map((s, idx) => (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => handleAddressSuggestionPress(s)}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row', alignItems: 'center',
                        backgroundColor: theme.colors.surface, borderRadius: 14,
                        padding: 14, marginBottom: 10,
                      }}
                    >
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#3b82f612', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                        <MapPin size={18} color="#3b82f6" />
                      </View>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }} numberOfLines={2}>
                        {s.display_name}
                      </Text>
                      <ChevronRight size={14} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {/* Location suggestions when searching */}
              {searchQuery.trim() && locationSuggestions.length > 0 && (
                <>
                  {/* Divider */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: filteredBaskets.length > 0 ? 20 : 0, marginBottom: 14 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginHorizontal: 12 }}>
                      {filteredBaskets.length === 0
                        ? t('home.noMatchingBaskets', { defaultValue: 'Aucun panier avec ce nom' })
                        : t('home.otherLocations', { defaultValue: 'Autres commerces' })}
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                  </View>

                  {/* Location suggestion cards */}
                  {locationSuggestions.map((loc) => (
                    <TouchableOpacity
                      key={loc.id}
                      onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: String(loc.id) } } as never)}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row', alignItems: 'center',
                        backgroundColor: theme.colors.surface, borderRadius: 14,
                        padding: 14, marginBottom: 10,
                      }}
                    >
                      {loc.image_url ? (
                        <Image source={{ uri: loc.image_url }} style={{ width: 44, height: 44, borderRadius: 12, marginRight: 12 }} resizeMode="cover" />
                      ) : (
                        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.colors.primary + '12', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                          <Store size={20} color={theme.colors.primary} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' }} numberOfLines={1}>
                          {loc.display_name ?? loc.name}
                        </Text>
                        {loc.address ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                            <MapPin size={11} color={theme.colors.textSecondary} style={{ marginRight: 4 }} />
                            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }} numberOfLines={1}>
                              {loc.address}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <ChevronRight size={16} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </>
          )}
        </View>
      </Animated.ScrollView>

      <Modal visible={showRadiusModal} transparent animationType="slide" onRequestClose={() => setShowRadiusModal(false)}>
        <View style={styles.radiusModalOverlay}>
          <Animated.View
            style={[styles.radiusModalContent, { backgroundColor: theme.colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, transform: [{ translateY: radiusSwipe.translateY }], ...theme.shadows.shadowLg }]}
          >
            {/* Swipe zone — full-width strip at the top hosts the
                handle AND the gesture. Crucial here because the MapView
                below would otherwise capture vertical drags as map pan,
                stealing the swipe-down before it could close the sheet. */}
            <View
              {...radiusSwipe.panHandlers}
              style={{ paddingTop: 10, paddingBottom: 12, alignItems: 'center' }}
            >
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.divider }} />
            </View>

            <View style={[styles.radiusModalHeader, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1 }]}>
                {t('home.selectRadius')}
              </Text>
              <TouchableOpacity
                onPress={() => setShowRadiusModal(false)}
                style={[styles.closeBtn, { backgroundColor: theme.colors.bg }]}
                accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
                accessibilityRole="button"
              >
                <X size={18} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.mapContainer, { marginHorizontal: theme.spacing.xl, marginTop: theme.spacing.lg }]}>
              {Platform.OS !== 'web' && MapView ? (
                <MapView
                  style={styles.mapView}
                  initialRegion={{
                    latitude: selectedAddress?.lat ?? 36.8065,
                    longitude: selectedAddress?.lng ?? 10.1815,
                    latitudeDelta: 0.15,
                    longitudeDelta: 0.15,
                  }}
                >
                  {MapCircle && (
                    <MapCircle
                      center={{ latitude: 36.8065, longitude: 10.1815 }}
                      radius={radius * 1000}
                      fillColor="rgba(255, 0, 0, 0.12)"
                      strokeColor="red"
                      strokeWidth={3}
                    />
                  )}
                  {baskets.map((basket) => (
                    MapMarker && basket.hasCoords ? (
                      <MapMarker
                        key={basket.id}
                        coordinate={{ latitude: basket.latitude as number, longitude: basket.longitude as number }}
                        title={basket.merchantName}
                      />
                    ) : null
                  ))}
                </MapView>
              ) : (
                <MapFallback markers={mapMarkers} radius={radius} style={styles.mapView} />
              )}
            </View>

            <View style={[styles.sliderSection, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xl }]}>
              <View style={styles.sliderLabelRow}>
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
                  {t('home.radiusFilter') as string}
                </Text>
                <View style={[styles.distanceBadge, { backgroundColor: theme.colors.primary + '12' }]}>
                  <Text style={[{ color: theme.colors.primary, ...theme.typography.h3 }]}>
                    {radius} km
                  </Text>
                </View>
              </View>

              <View style={styles.sliderContainer}>
                <View style={[styles.sliderTrackBg, { backgroundColor: theme.colors.divider }]}>
                  <View style={[styles.sliderTrackFill, { backgroundColor: theme.colors.primary, width: `${((radius - 1) / 19) * 100}%` }]} />
                </View>
                <View style={[styles.sliderThumbContainer, { left: `${((radius - 1) / 19) * 100}%` }]}>
                  <View style={[styles.sliderThumb, { backgroundColor: theme.colors.primary, ...theme.shadows.shadowMd }]}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>{radius}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={StyleSheet.absoluteFillObject}
                  activeOpacity={1}
                  onPress={(e) => {
                    const trackWidth = Dimensions.get('window').width - 80;
                    const pct = Math.max(0, Math.min(1, e.nativeEvent.locationX / trackWidth));
                    setRadius(Math.max(1, Math.min(20, Math.round(1 + pct * 19))));
                  }}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.useLocationBtn, { borderColor: theme.colors.primary }]}
              activeOpacity={0.7}
            >
              <MapPin size={16} color={theme.colors.primary} />
              <Text style={[{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 8 }]}>
                  {t('home.useMyLocation') as string}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowRadiusModal(false)}
              activeOpacity={0.8}
              style={[styles.confirmBtn, {
                backgroundColor: theme.colors.primary,
                marginHorizontal: theme.spacing.xl,
                marginBottom: theme.spacing.xxl,
              }]}
            >
              <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                {t('home.chooseLocation')}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 44,
  },
  searchInput: {
    marginLeft: 10,
    paddingVertical: 0,
    height: 44,
    includeFontPadding: false,
  } as any,
  categoriesSection: {},
  categoryPill: {},
  scrollView: {
    flex: 1,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radiusModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  radiusModalContent: {},
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
  },
  radiusModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapContainer: {
    height: 260,
    borderRadius: 16,
    overflow: 'hidden',
  },
  mapView: {
    flex: 1,
  },
  sliderSection: {},
  sliderLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  distanceBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  sliderContainer: {
    position: 'relative',
    paddingVertical: 8,
  },
  sliderTrackBg: {
    height: 4,
    borderRadius: 2,
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: -2,
  },
  sliderTrackFill: {
    height: 4,
    borderRadius: 2,
  },
  sliderThumbContainer: {
    position: 'absolute',
    top: -8,
    marginLeft: -12,
  },
  sliderThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  useLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
  },
  confirmBtn: {
    borderRadius: 14,
    paddingVertical: 16,
  },
});
