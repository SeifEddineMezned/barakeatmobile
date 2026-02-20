import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated,
  TouchableOpacity,
  FlatList,
  ViewToken,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShoppingBag, Package, MapPin, CreditCard } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { useAuthStore } from '@/src/stores/authStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface OnboardingSlide {
  id: string;
  icon: React.ReactNode;
  titleKey: string;
  descriptionKey: string;
}

export default function OnboardingScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const completeOnboarding = useAuthStore((state) => state.completeOnboarding);

  const slides: OnboardingSlide[] = [
    {
      id: '1',
      icon: <ShoppingBag size={80} color={theme.colors.primary} />,
      titleKey: 'onboarding.slide1.title',
      descriptionKey: 'onboarding.slide1.description',
    },
    {
      id: '2',
      icon: <Package size={80} color={theme.colors.primary} />,
      titleKey: 'onboarding.slide2.title',
      descriptionKey: 'onboarding.slide2.description',
    },
    {
      id: '3',
      icon: <MapPin size={80} color={theme.colors.primary} />,
      titleKey: 'onboarding.slide3.title',
      descriptionKey: 'onboarding.slide3.description',
    },
    {
      id: '4',
      icon: <CreditCard size={80} color={theme.colors.primary} />,
      titleKey: 'onboarding.slide4.title',
      descriptionKey: 'onboarding.slide4.description',
    },
  ];

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setCurrentIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const handleNext = useCallback(() => {
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    } else {
      completeOnboarding();
      router.replace('/auth/sign-in');
    }
  }, [currentIndex, slides.length, completeOnboarding, router]);

  const handleSkip = useCallback(() => {
    completeOnboarding();
    router.replace('/auth/sign-in');
  }, [completeOnboarding, router]);

  const changeLanguage = useCallback((lang: string) => {
    i18n.changeLanguage(lang);
  }, [i18n]);

  const renderSlide = useCallback(
    ({ item, index }: { item: OnboardingSlide; index: number }) => {
      const inputRange = [
        (index - 1) * SCREEN_WIDTH,
        index * SCREEN_WIDTH,
        (index + 1) * SCREEN_WIDTH,
      ];

      const scale = scrollX.interpolate({
        inputRange,
        outputRange: [0.8, 1, 0.8],
        extrapolate: 'clamp',
      });

      const opacity = scrollX.interpolate({
        inputRange,
        outputRange: [0.3, 1, 0.3],
        extrapolate: 'clamp',
      });

      return (
        <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
          <Animated.View
            style={[
              styles.iconContainer,
              {
                transform: [{ scale }],
                opacity,
              },
            ]}
          >
            {item.icon}
          </Animated.View>
          <Text
            style={[
              styles.title,
              {
                color: theme.colors.textPrimary,
                ...theme.typography.h1,
              },
            ]}
          >
            {t(item.titleKey)}
          </Text>
          <Text
            style={[
              styles.description,
              {
                color: theme.colors.textSecondary,
                ...theme.typography.body,
              },
            ]}
          >
            {t(item.descriptionKey)}
          </Text>
        </View>
      );
    },
    [scrollX, t, theme]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl }]}>
        <TouchableOpacity onPress={handleSkip}>
          <Text style={[styles.skipText, { color: theme.colors.textSecondary, ...theme.typography.body }]}>
            {t('common.skip')}
          </Text>
        </TouchableOpacity>
        <View style={styles.languageSelector}>
          <TouchableOpacity
            onPress={() => changeLanguage('en')}
            style={[
              styles.langButton,
              i18n.language === 'en' && { backgroundColor: theme.colors.primaryLight },
            ]}
          >
            <Text
              style={[
                styles.langText,
                {
                  color: i18n.language === 'en' ? theme.colors.surface : theme.colors.textSecondary,
                  ...theme.typography.bodySm,
                },
              ]}
            >
              EN
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => changeLanguage('fr')}
            style={[
              styles.langButton,
              i18n.language === 'fr' && { backgroundColor: theme.colors.primaryLight },
            ]}
          >
            <Text
              style={[
                styles.langText,
                {
                  color: i18n.language === 'fr' ? theme.colors.surface : theme.colors.textSecondary,
                  ...theme.typography.bodySm,
                },
              ]}
            >
              FR
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => changeLanguage('ar')}
            style={[
              styles.langButton,
              i18n.language === 'ar' && { backgroundColor: theme.colors.primaryLight },
            ]}
          >
            <Text
              style={[
                styles.langText,
                {
                  color: i18n.language === 'ar' ? theme.colors.surface : theme.colors.textSecondary,
                  ...theme.typography.bodySm,
                },
              ]}
            >
              AR
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={slides}
        renderItem={renderSlide}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: false,
        })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        keyExtractor={(item) => item.id}
      />

      <View style={[styles.footer, { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.xxl }]}>
        <View style={styles.pagination}>
          {slides.map((_, index) => {
            const inputRange = [
              (index - 1) * SCREEN_WIDTH,
              index * SCREEN_WIDTH,
              (index + 1) * SCREEN_WIDTH,
            ];

            const dotWidth = scrollX.interpolate({
              inputRange,
              outputRange: [8, 24, 8],
              extrapolate: 'clamp',
            });

            const opacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.3, 1, 0.3],
              extrapolate: 'clamp',
            });

            return (
              <Animated.View
                key={index}
                style={[
                  styles.dot,
                  {
                    backgroundColor: theme.colors.primary,
                    width: dotWidth,
                    opacity,
                  },
                ]}
              />
            );
          })}
        </View>
        <PrimaryCTAButton
          onPress={handleNext}
          title={currentIndex === slides.length - 1 ? t('onboarding.getStarted') : t('common.continue')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  skipText: {},
  languageSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  langButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  langText: {},
  slide: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconContainer: {
    marginBottom: 40,
  },
  title: {
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  footer: {
    paddingTop: 32,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 32,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
});
