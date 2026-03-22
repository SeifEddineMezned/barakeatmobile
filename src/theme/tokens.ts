export const tokens = {
  colors: {
    primary: '#114b3c',
    primaryDark: '#003d24',
    primaryLight: '#1a6b54',
    secondary: '#e3ff5c',
    secondaryDark: '#c8e04a',

    accentWarm: '#e8a838',
    accentFresh: '#2d8a6e',

    bg: '#f9f9f6',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',

    textPrimary: '#1a1a1a',
    textSecondary: '#6b6b6b',
    muted: '#a0a0a0',
    divider: '#e8e8e3',

    success: '#2d8a6e',
    warning: '#e8a838',
    error: '#d94f4f',

    overlay: 'rgba(0, 0, 0, 0.5)',
    overlayLight: 'rgba(0, 0, 0, 0.2)',

    discount: '#d94f4f',
    discountBg: '#fde8e8',

    starYellow: '#f5a623',
    bagsLeft: '#114b3c',
    bagsLeftBg: 'rgba(17, 75, 60, 0.12)',
    bagsLeftWarning: '#e3ff5c',

    gradientStart: '#114b3c',
    gradientEnd: '#e3ff5c',

    chartGreen: '#2d8a6e',
    chartYellow: '#e3ff5c',
    chartBar: '#114b3c',
  },

  radii: {
    r4: 4,
    r8: 8,
    r12: 12,
    r16: 16,
    r20: 20,
    r24: 24,
    pill: 9999,
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },

  typography: {
    display: {
      fontSize: 32,
      lineHeight: 40,
      fontWeight: '700' as const,
      letterSpacing: -0.5,
      fontFamily: 'Poppins_700Bold',
    },
    h1: {
      fontSize: 26,
      lineHeight: 34,
      fontWeight: '700' as const,
      letterSpacing: -0.3,
      fontFamily: 'Poppins_700Bold',
    },
    h2: {
      fontSize: 20,
      lineHeight: 28,
      fontWeight: '600' as const,
      letterSpacing: -0.2,
      fontFamily: 'Poppins_600SemiBold',
    },
    h3: {
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600' as const,
      letterSpacing: 0,
      fontFamily: 'Poppins_600SemiBold',
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '400' as const,
      letterSpacing: 0,
      fontFamily: 'Poppins_400Regular',
    },
    bodySm: {
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '400' as const,
      letterSpacing: 0,
      fontFamily: 'Poppins_400Regular',
    },
    caption: {
      fontSize: 11,
      lineHeight: 16,
      fontWeight: '400' as const,
      letterSpacing: 0.2,
      fontFamily: 'Poppins_400Regular',
    },
    button: {
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '600' as const,
      letterSpacing: 0.3,
      fontFamily: 'Poppins_600SemiBold',
    },
  },

  shadows: {
    shadowSm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
      elevation: 2,
    },
    shadowMd: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.1,
      shadowRadius: 6,
      elevation: 4,
    },
    shadowLg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.14,
      shadowRadius: 12,
      elevation: 8,
    },
  },
} as const;

export type Theme = typeof tokens;
