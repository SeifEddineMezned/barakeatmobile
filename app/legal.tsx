import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';

export default function LegalScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const title =
    type === 'terms' ? t('profile.termsAndConditions') :
    type === 'cookies' ? t('profile.cookies') :
    t('profile.privacyPolicy');

  const content =
    type === 'terms' ? t('legal.termsContent') :
    type === 'cookies' ? t('legal.cookiesContent') :
    t('legal.privacyContent');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <StatusBar style="dark" />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, marginLeft: 12 }}>
          {title}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, lineHeight: 22 }}>
          {content}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
