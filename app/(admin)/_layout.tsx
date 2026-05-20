import React from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Users as UsersIcon, Building2, MapPin, AlertTriangle, LogOut } from 'lucide-react-native';
import { TouchableOpacity, View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

// Admin-only tab layout. The root layout redirects non-admin users away so we
// only guard at mount here. Signing out returns to the regular sign-in flow.
export default function AdminTabLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const signOut = useAuthStore((s) => s.signOut);

  React.useEffect(() => {
    if (!isAuthenticated || user?.role !== 'admin') {
      router.replace('/auth/sign-in' as never);
    }
  }, [isAuthenticated, user?.role, router]);

  if (!isAuthenticated || user?.role !== 'admin') return null;

  const headerRight = () => (
    <TouchableOpacity
      onPress={async () => {
        await signOut();
        router.replace('/auth/sign-in' as never);
      }}
      style={{ marginRight: 16, flexDirection: 'row', alignItems: 'center', gap: 4 }}
    >
      <LogOut size={18} color={theme.colors.textSecondary} />
    </TouchableOpacity>
  );

  const headerLeft = () => (
    <View style={{ marginLeft: 16, flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 16 }}>
        {t('admin.tabs.title', { defaultValue: 'Barakeat Admin' })}
      </Text>
    </View>
  );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        headerShown: true,
        headerTitle: '',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.bg },
        headerLeft,
        headerRight,
      }}
    >
      <Tabs.Screen
        name="users"
        options={{
          title: t('admin.tabs.users', { defaultValue: 'Utilisateurs' }),
          tabBarIcon: ({ size, color }) => <UsersIcon size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="organizations"
        options={{
          title: t('admin.tabs.organizations', { defaultValue: 'Orgs' }),
          tabBarIcon: ({ size, color }) => <Building2 size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="locations"
        options={{
          title: t('admin.tabs.locations', { defaultValue: 'Emplacements' }),
          tabBarIcon: ({ size, color }) => <MapPin size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: t('admin.tabs.reports', { defaultValue: 'Signalements' }),
          tabBarIcon: ({ size, color }) => <AlertTriangle size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
