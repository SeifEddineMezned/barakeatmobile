import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Mail, MapPin, Shield, ShieldCheck, Crown, ShoppingBag, Edit3, Clock, User } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/src/lib/api';

async function fetchMemberActivity(memberId: string) {
  try {
    const res = await apiClient.get(`/api/teams/members/${memberId}/activity`);
    return res.data as { activities: Array<{ type: string; description: string; created_at: string }> };
  } catch {
    return { activities: [] };
  }
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function MemberDetailScreen() {
  const { memberId, memberName, memberEmail, memberRole, locationName } = useLocalSearchParams<{
    memberId: string;
    memberName?: string;
    memberEmail?: string;
    memberRole?: string;
    locationName?: string;
  }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const activityQuery = useQuery({
    queryKey: ['member-activity', memberId],
    queryFn: () => fetchMemberActivity(memberId),
    staleTime: 60_000,
  });

  const name = memberName || memberEmail?.split('@')[0] || 'Member';
  const initials = name
    .split(' ')
    .map((w: string) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .substring(0, 2);

  const getRoleBadge = () => {
    switch (memberRole) {
      case 'owner': return { color: '#16a34a', bg: '#16a34a15', label: t('business.team.owner', { defaultValue: 'Owner' }), Icon: Crown };
      case 'admin': return { color: theme.colors.primary, bg: theme.colors.primary + '20', label: t('business.team.admin'), Icon: ShieldCheck };
      default: return { color: theme.colors.muted, bg: theme.colors.muted + '25', label: t('business.team.member'), Icon: Shield };
    }
  };

  const badge = getRoleBadge();
  const activities = activityQuery.data?.activities ?? [];

  const getActivityIcon = (type: string) => {
    if (type.includes('reservation') || type.includes('order')) return { Icon: ShoppingBag, color: theme.colors.primary };
    if (type.includes('basket') || type.includes('edit')) return { Icon: Edit3, color: '#f59e0b' };
    return { Icon: Clock, color: theme.colors.muted };
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <ArrowLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, textAlign: 'center' }}>
          {t('business.team.memberDetail', { defaultValue: 'Member' })}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        {/* Member Info Card */}
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, alignItems: 'center' }]}>
          <View style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: theme.colors.primary + '20',
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: 16,
          }}>
            <Text style={{ color: theme.colors.primary, fontSize: 24, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
              {initials}
            </Text>
          </View>

          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, textAlign: 'center' }}>
            {name}
          </Text>

          {/* Role badge */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: badge.bg, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, gap: 6 }}>
            <badge.Icon size={14} color={badge.color} />
            <Text style={{ color: badge.color, ...theme.typography.bodySm, fontWeight: '600' }}>
              {badge.label}
            </Text>
          </View>

          {/* Info rows */}
          <View style={{ width: '100%', marginTop: 20 }}>
            {memberEmail ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                <Mail size={16} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginLeft: 12, flex: 1 }}>
                  {memberEmail}
                </Text>
              </View>
            ) : null}
            {locationName ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                <MapPin size={16} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginLeft: 12, flex: 1 }}>
                  {locationName}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Activity Section */}
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, marginTop: theme.spacing.lg, padding: theme.spacing.xl }]}>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: 16 }}>
            {t('business.team.recentActivity', { defaultValue: 'Recent Activity' })}
          </Text>

          {activityQuery.isLoading ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
            </View>
          ) : activities.length === 0 ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <User size={24} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 8, textAlign: 'center' }}>
                {t('business.team.noActivity', { defaultValue: 'No recent activity' })}
              </Text>
            </View>
          ) : (
            activities.map((activity, index) => {
              const { Icon, color } = getActivityIcon(activity.type);
              return (
                <View key={index} style={{ flexDirection: 'row', paddingVertical: 12, borderTopWidth: index > 0 ? 1 : 0, borderTopColor: theme.colors.divider }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color + '15', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                    <Icon size={16} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                      {activity.description}
                    </Text>
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                      {timeAgo(activity.created_at)}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
});
