import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useTranslation } from "react-i18next";

export default function NotFoundScreen() {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
          {t('common.screenNotFound', { defaultValue: "This screen doesn't exist." })}
        </Text>

        <Link href="/(tabs)" style={[styles.link, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12 }]}>
          <Text style={[styles.linkText, { color: theme.colors.surface, ...theme.typography.body }]}>{t('common.goHome', { defaultValue: 'Go to home screen' })}</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    marginBottom: 16,
  },
  link: {
    marginTop: 15,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  linkText: {},
});
