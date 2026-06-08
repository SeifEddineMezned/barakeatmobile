import { Animated } from 'react-native';

// Module-singleton Animated.Value that tracks the customer home feed's
// vertical scroll position. Shared between:
//   • app/(tabs)/index.tsx — the home screen that writes to it via the
//     ScrollView's onScroll handler.
//   • app/(tabs)/_layout.tsx — the layout that hosts the floating map /
//     "Search" button (kept in the layout so it can animate across tab
//     swaps) and needs the SAME scroll progress as the in-page Settings /
//     Bell icons to crossfade its colour smoothly.
//
// Without this shared value the layout-side map icon falls back to the
// `heroVisible` boolean (flipped at a single threshold), which makes it
// snap at a different moment than the icons in the page — exactly the
// "map seems to be changing on its own timeframe" issue.
export const sharedScrollY = new Animated.Value(0);

// Vertical extent of the hero band. The container bg + every top-bar icon
// crossfade is interpolated over [0, HERO_HEIGHT].
export const HERO_HEIGHT = 160;
