export const tokens = {
  colors: {
    primary: '#E67E22',
    primaryDark: '#D35400',
    primaryLight: '#F39C12',
    secondary: '#27AE60',
    secondaryDark: '#229954',
    
    accentWarm: '#E74C3C',
    accentFresh: '#16A085',
    
    bg: '#FAFAFA',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    
    textPrimary: '#2C3E50',
    textSecondary: '#7F8C8D',
    muted: '#BDC3C7',
    divider: '#ECF0F1',
    
    success: '#27AE60',
    warning: '#F39C12',
    error: '#E74C3C',
    
    overlay: 'rgba(0, 0, 0, 0.5)',
    overlayLight: 'rgba(0, 0, 0, 0.2)',
    
    discount: '#E74C3C',
    discountBg: '#FADBD8',
    
    gradientStart: '#E67E22',
    gradientEnd: '#F39C12',
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
    },
    h1: {
      fontSize: 28,
      lineHeight: 36,
      fontWeight: '700' as const,
      letterSpacing: -0.3,
    },
    h2: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: '600' as const,
      letterSpacing: -0.2,
    },
    h3: {
      fontSize: 18,
      lineHeight: 24,
      fontWeight: '600' as const,
      letterSpacing: 0,
    },
    body: {
      fontSize: 16,
      lineHeight: 24,
      fontWeight: '400' as const,
      letterSpacing: 0,
    },
    bodySm: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '400' as const,
      letterSpacing: 0,
    },
    caption: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '400' as const,
      letterSpacing: 0.2,
    },
    button: {
      fontSize: 16,
      lineHeight: 24,
      fontWeight: '600' as const,
      letterSpacing: 0.3,
    },
  },
  
  shadows: {
    shadowSm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
      elevation: 2,
    },
    shadowMd: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      elevation: 4,
    },
    shadowLg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.16,
      shadowRadius: 16,
      elevation: 8,
    },
  },
} as const;

export type Theme = typeof tokens;
