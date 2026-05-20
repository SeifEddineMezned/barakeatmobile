import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { MapPin, Plus } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';

type Props = {
  compact?: boolean;
  onPressOverride?: () => void;
  // When true, this CTA publishes its primary-button bounds into the
  // walkthrough store under the 'addLocationCta' measureKey so the no-location
  // step can highlight it. The CTA is rendered in several places (dashboard,
  // dropdowns, etc.) — we only want ONE of them (the dashboard's full-width
  // empty state) to publish, otherwise the rect flips around as users open
  // dropdowns. Defaults to false.
  publishMeasure?: boolean;
};

export function NoLocationCTA({ compact = false, onPressOverride, publishMeasure = false }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const setMeasuredRect = useWalkthroughStore((s) => s.setMeasuredRect);
  const ctaButtonRef = React.useRef<View | null>(null);

  const handlePress = () => {
    if (onPressOverride) {
      onPressOverride();
      return;
    }
    router.push('/business/add-location' as never);
  };

  const measureCtaButton = React.useCallback(() => {
    if (!publishMeasure) return;
    requestAnimationFrame(() => {
      ctaButtonRef.current?.measureInWindow((x: number, y: number, w: number, h: number) => {
        if (w > 0 && h > 0) setMeasuredRect('addLocationCta', { x, y, w, h });
      });
    });
  }, [publishMeasure, setMeasuredRect]);

  React.useEffect(() => {
    return () => {
      if (publishMeasure) setMeasuredRect('addLocationCta', null);
    };
  }, [publishMeasure, setMeasuredRect]);

  const iconSize = compact ? 56 : 88;
  const iconRadius = iconSize / 2;
  const iconGlyph = compact ? 28 : 40;
  const cardPad = compact ? 20 : 32;
  const titleStyle = compact ? theme.typography.h3 : theme.typography.h2;

  return (
    <View style={{ alignItems: 'center', paddingTop: compact ? 16 : 60, paddingHorizontal: 24 }}>
      <View
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.r20,
          padding: cardPad,
          alignItems: 'center',
          width: '100%',
          ...theme.shadows.shadowSm,
        }}
      >
        <View
          style={{
            width: iconSize,
            height: iconSize,
            borderRadius: iconRadius,
            backgroundColor: theme.colors.primary + '15',
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: compact ? 12 : 20,
          }}
        >
          <MapPin size={iconGlyph} color={theme.colors.primary} />
        </View>
        <Text style={{ color: theme.colors.textPrimary, ...titleStyle, textAlign: 'center' }}>
          {t('business.noLocation.title')}
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            ...theme.typography.body,
            marginTop: 10,
            textAlign: 'center',
            lineHeight: 22,
          }}
        >
          {t('business.noLocation.description')}
        </Text>
        <TouchableOpacity
          ref={ctaButtonRef as any}
          onLayout={measureCtaButton}
          onPress={handlePress}
          activeOpacity={0.85}
          style={{
            marginTop: compact ? 16 : 24,
            backgroundColor: theme.colors.primary,
            borderRadius: theme.radii.r12,
            paddingVertical: 12,
            paddingHorizontal: 22,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Plus size={16} color="#fff" />
          <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '700' }}>
            {t('business.noLocation.cta')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
