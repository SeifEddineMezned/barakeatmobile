import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronDown, Info, ShoppingBag, CreditCard, Store } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';

interface FAQItem { q: string; a: string; }
interface FAQCategory { title: string; icon: any; items: FAQItem[]; }

// FAQ content is i18n-keyed under `faq.*` in each locale (en/fr/ar) so
// the dedicated FAQ screen displays in the user's current language
// instead of always rendering French. The list of question keys lives
// here; the strings live in the locale JSONs.
const FAQ_KEYS: { title: string; icon: any; items: string[] }[] = [
  {
    title: 'faq.general.title',
    icon: Info,
    items: ['surprise', 'why', 'region', 'impact'],
  },
  {
    title: 'faq.orders.title',
    icon: ShoppingBag,
    items: ['knowContent', 'whyUnknown', 'stillGood', 'pickup', 'cancel'],
  },
  {
    title: 'faq.payment.title',
    icon: CreditCard,
    // `howToPay` was rewritten to spell out the three accepted methods
    // (online card / Barakeat credits / cash on pickup) per the launch
    // checklist. Old text only mentioned cash on pickup.
    items: ['howToPay', 'credits'],
  },
  {
    title: 'faq.merchants.title',
    icon: Store,
    // `manage` was removed — the customer FAQ has no business reason
    // to surface partner-only how-to.
    items: ['become'],
  },
];

function FAQAccordion({ item, theme }: { item: FAQItem; theme: any }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <TouchableOpacity
      onPress={() => setExpanded(v => !v)}
      style={{ backgroundColor: theme.colors.surface, borderRadius: 14, marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: expanded ? theme.colors.primary + '30' : theme.colors.divider }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 }}>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
          {item.q}
        </Text>
        <ChevronDown size={16} color={theme.colors.muted} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }], marginLeft: 8 }} />
      </View>
      {expanded && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 14, paddingTop: 0 }}>
          <View style={{ height: 1, backgroundColor: theme.colors.divider, marginBottom: 10 }} />
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, lineHeight: 20 }}>
            {item.a}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function FAQScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const categories: FAQCategory[] = FAQ_KEYS.map((cat) => ({
    title: t(cat.title, { defaultValue: cat.title }),
    icon: cat.icon,
    items: cat.items.map((key) => {
      const base = cat.title.replace(/\.title$/, '');
      return {
        q: t(`${base}.${key}.q`, { defaultValue: key }),
        a: t(`${base}.${key}.a`, { defaultValue: '' }),
      };
    }),
  }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <StatusBar style="dark" />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, marginLeft: 12 }}>
          {t('profile.faq', { defaultValue: 'FAQ' })}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {categories.map((cat, ci) => {
          const CatIcon = cat.icon;
          return (
            <View key={ci} style={{ marginBottom: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 }}>
                <CatIcon size={18} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700' }}>
                  {cat.title}
                </Text>
              </View>
              {cat.items.map((item, i) => (
                <FAQAccordion key={i} item={item} theme={theme} />
              ))}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
