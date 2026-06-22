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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, minHeight: 52 }}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={{ position: 'absolute', left: 16, top: 14 }}
        >
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        {/* pointerEvents="none" — title paints later than the absolute back
            button and would otherwise swallow taps over the icon. */}
        <Text pointerEvents="none" style={{ color: theme.colors.textPrimary, ...theme.typography.h2 }}>
          {title}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {renderMarkdown(content, theme)}
      </ScrollView>
    </SafeAreaView>
  );
}

// Lightweight markdown-ish renderer for the legal/privacy content stored in
// the locale files. Editing the body? Use these markers in the i18n value:
//   ## Title         → section title (primary-colored, bold)
//   ### Sub          → subsection (text-primary, semi-bold)
//   - item           → bullet
//   > note           → italic left-bordered callout
//   ---              → horizontal divider
//   **bold**         → inline bold
//   *italic*         → inline italic
//   blank line       → paragraph break
function renderMarkdown(raw: string, theme: any): React.ReactNode[] {
  const lines = (raw || '').split('\n');
  const nodes: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];
  let calloutBuffer: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    const items = [...bulletBuffer];
    bulletBuffer = [];
    nodes.push(
      <View key={`l${key++}`} style={{ marginVertical: 6, paddingLeft: 4 }}>
        {items.map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', marginBottom: 4 }}>
            <Text style={{ color: theme.colors.primary, marginRight: 8, fontSize: 14, lineHeight: 22, fontFamily: 'Poppins_400Regular' }}>•</Text>
            <Text style={{ flex: 1, color: theme.colors.textPrimary, fontSize: 14, lineHeight: 22, fontFamily: 'Poppins_400Regular' }}>
              {renderInline(item)}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const flushCallout = () => {
    if (calloutBuffer.length === 0) return;
    const calloutLines = [...calloutBuffer];
    calloutBuffer = [];
    nodes.push(
      <View
        key={`c${key++}`}
        style={{
          borderLeftWidth: 3,
          borderLeftColor: theme.colors.primary,
          backgroundColor: theme.colors.primary + '10',
          paddingHorizontal: 12,
          paddingVertical: 10,
          marginVertical: 10,
          borderTopRightRadius: 6,
          borderBottomRightRadius: 6,
        }}
      >
        {calloutLines.map((line, i) => (
          <Text
            key={i}
            style={{ color: theme.colors.textPrimary, fontSize: 14, lineHeight: 22, fontStyle: 'italic', fontFamily: 'Poppins_400Regular' }}
          >
            {renderInline(line)}
          </Text>
        ))}
      </View>
    );
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === '---') {
      flushBullets();
      flushCallout();
      nodes.push(
        <View
          key={`d${key++}`}
          style={{ height: 1, backgroundColor: theme.colors.divider, marginVertical: 16 }}
        />
      );
      continue;
    }

    if (line.startsWith('## ')) {
      flushBullets();
      flushCallout();
      nodes.push(
        <Text
          key={`h2-${key++}`}
          style={{
            color: theme.colors.primary,
            fontSize: 17,
            fontWeight: '700' as const,
            fontFamily: 'Poppins_700Bold',
            marginTop: 12,
            marginBottom: 8,
          }}
        >
          {line.slice(3)}
        </Text>
      );
      continue;
    }

    if (line.startsWith('### ')) {
      flushBullets();
      flushCallout();
      nodes.push(
        <Text
          key={`h3-${key++}`}
          style={{
            color: theme.colors.textPrimary,
            fontSize: 14,
            fontWeight: '600' as const,
            fontFamily: 'Poppins_600SemiBold',
            marginTop: 10,
            marginBottom: 4,
          }}
        >
          {line.slice(4)}
        </Text>
      );
      continue;
    }

    if (line.startsWith('- ')) {
      flushCallout();
      bulletBuffer.push(line.slice(2));
      continue;
    }

    if (line.startsWith('> ')) {
      flushBullets();
      calloutBuffer.push(line.slice(2));
      continue;
    }

    if (line === '') {
      flushBullets();
      flushCallout();
      continue;
    }

    flushBullets();
    flushCallout();
    nodes.push(
      <Text
        key={`p${key++}`}
        style={{ color: theme.colors.textPrimary, fontSize: 14, lineHeight: 22, marginBottom: 8, fontFamily: 'Poppins_400Regular' }}
      >
        {renderInline(line)}
      </Text>
    );
  }

  flushBullets();
  flushCallout();
  return nodes;
}

// Inline span parser — supports **bold** then *italic*. Falls back to the raw
// string when no markers are present so we don't pay the cost on plain text.
function renderInline(text: string): React.ReactNode {
  if (!text.includes('*')) return text;
  const out: React.ReactNode[] = [];
  let i = 0;
  let buf = '';
  let k = 0;
  const flushBuf = () => {
    if (buf) {
      out.push(buf);
      buf = '';
    }
  };
  while (i < text.length) {
    if (text.slice(i, i + 2) === '**') {
      const close = text.indexOf('**', i + 2);
      if (close > i + 1) {
        flushBuf();
        out.push(
          <Text key={`b${k++}`} style={{ fontWeight: '700' as const, fontFamily: 'Poppins_700Bold' }}>
            {text.slice(i + 2, close)}
          </Text>
        );
        i = close + 2;
        continue;
      }
    }
    if (text[i] === '*') {
      const close = text.indexOf('*', i + 1);
      if (close > i) {
        flushBuf();
        out.push(
          <Text key={`i${k++}`} style={{ fontStyle: 'italic', fontFamily: 'Poppins_400Regular' }}>
            {text.slice(i + 1, close)}
          </Text>
        );
        i = close + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flushBuf();
  return out;
}
