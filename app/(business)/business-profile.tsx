import React, { useCallback, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Image, TextInput, Switch, KeyboardAvoidingView, Platform, Animated, Pressable } from 'react-native';
import { validateBizDayWindow } from '@/src/utils/timezone';
import { TimePicker } from '@/src/components/TimePicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/src/lib/api';
import { useRouter } from 'expo-router';
import {
  ChevronRight, MapPin, Clock, Store,
  Users, UserPlus, Trash2, Shield, CreditCard, Camera, X, UtensilsCrossed, Package, Check
} from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { EditIcon8 } from '@/src/components/ui/Icon8';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { useAuthStore } from '@/src/stores/authStore';
import { useBusinessStore, DEFAULT_PERMISSIONS } from '@/src/stores/businessStore';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMyProfile, fetchMyBaskets } from '@/src/services/business';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { fetchMyContext, fetchOrganizationDetails, addMember as addMemberAPI, updateMember, removeMember as removeMemberAPI } from '@/src/services/teams';
import * as ImagePicker from 'expo-image-picker';
import { useImageCropper } from '@/src/components/ImageCropper';
import type { TeamMember, TeamRole, TeamPermission } from '@/src/types';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { NoLocationCTA } from '@/src/components/NoLocationCTA';
import { formatLocationName } from '@/src/utils/formatLocation';
import { formatPhone } from '@/src/utils/formatPhone';
import { useSwipeToDismiss } from '@/src/hooks/useSwipeToDismiss';

export default function BusinessProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const alert = useCustomAlert();
  const router = useRouter();
  const { user } = useAuthStore();
  const store = useBusinessStore();
  const { team, addTeamMember, removeTeamMember, updateTeamMemberRole } = store;
  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);
  const queryClient = useQueryClient();
  const { pickAndCrop } = useImageCropper();

  // Profile changes are user-initiated and we invalidate on save, so
  // a 2-min staleTime is safe. `refetchOnMount: 'always'` dropped — the
  // global QueryClient floor + invalidations handle the freshness case.
  const profileQuery = useQuery({
    queryKey: ['my-profile', selectedLocationId],
    queryFn: () => fetchMyProfile(selectedLocationId),
    staleTime: 2 * 60_000,
    retry: 1,
  });

  const contextQuery = useQuery({
    queryKey: ['my-context'],
    queryFn: fetchMyContext,
    staleTime: 5 * 60_000,
  });

  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', contextQuery.data?.organization_id],
    queryFn: () => fetchOrganizationDetails(contextQuery.data!.organization_id!),
    enabled: !!contextQuery.data?.organization_id,
    staleTime: 5 * 60_000,
  });

  // Permission enforcement — hide/disable sections based on member permissions
  const myRole = contextQuery.data?.role ?? 'member';
  const myLocationIdForScope = contextQuery.data?.location_id ?? null;
  // Org admin = admin/owner with NO location constraint.
  // Location admin = admin scoped to one location — they can manage their
  // location's team but not the org-wide profile fields.
  const isOrgAdmin = (myRole === 'owner' || myRole === 'admin') && !myLocationIdForScope;
  const isLocationAdmin = myRole === 'admin' && !!myLocationIdForScope;
  const isAdmin = isOrgAdmin || isLocationAdmin;
  const rawPerms = contextQuery.data?.permissions ?? {};
  // Normalize: backend may send booleans or strings
  const hasPerm = (key: string) => {
    const v = rawPerms[key];
    return v === true || v === 'true' || v === 'write';
  };
  // Profile editing = org-wide changes (name, category, ...). Location admins
  // can view the profile but can't edit org-level fields.
  const canEditProfile = isOrgAdmin;
  const canEditAvailability = isAdmin || hasPerm('edit_quantities');
  const canEditBasketInfo = isAdmin || hasPerm('edit_basket_info');
  const canCreateDeleteBaskets = isAdmin || hasPerm('create_delete_baskets');
  const canManageBaskets = canEditAvailability || canEditBasketInfo || canCreateDeleteBaskets;
  // Team management is admin-only — location admins keep access but their
  // team.tsx screen is scoped to their one location.
  const canManageTeam = isAdmin;

  // Baskets for this location — used for basket management and menu items.
  // refetchOnMount: 'always' guarantees the conflict-detection in
  // handleSaveHours sees the latest basket pickup times (otherwise a stale
  // cached snapshot could miss a basket whose custom window now falls outside
  // the new location hours, suppressing the "X panier(s) hors créneau"
  // warning).
  const basketsQuery = useQuery({
    queryKey: ['my-baskets', selectedLocationId],
    queryFn: () => fetchMyBaskets(selectedLocationId),
    staleTime: 30_000,
    refetchOnMount: 'always',
  });

  const teamMembers = orgDetailsQuery.data?.members ?? team.map((m: TeamMember) => ({
    membership_id: m.id,
    name: m.name,
    email: m.email,
    role: m.role === 'admin' ? 'admin' : 'member',
    status: 'active',
  }));

  // Dedupe by user_id so a member in multiple locations counts once in the
  // team-management button subtitle (matches gestion d'équipe's own count).
  const uniqueTeamMemberCount = React.useMemo(() => {
    const ids = new Set<string>();
    for (const m of teamMembers as any[]) ids.add(String(m.user_id ?? m.membership_id ?? m.id));
    return ids.size;
  }, [teamMembers]);

  const addMemberMutation = useMutation({
    mutationFn: async () => {
      const orgId = contextQuery.data?.organization_id;
      if (!orgId) throw new Error(t('business.team.noOrg', { defaultValue: 'Organisation introuvable' }));
      const tempPassword = Math.random().toString(36).slice(-8);

      // Build role and permissions based on selection
      let role: string;
      let permsPayload: Record<string, string> | undefined;
      let locationId: number | undefined;

      if (newMemberIsOrgAdmin) {
        role = 'admin';
        permsPayload = { availability: 'write', reservations: 'write', profile: 'write', menu: 'write', team: 'write' };
      } else {
        role = newMemberRole === 'admin' ? 'admin' : 'member';
        if (role === 'admin') {
          permsPayload = { availability: 'write', reservations: 'write', profile: 'write', menu: 'write', team: 'write' };
        } else {
          // Restricted: default minimal permissions
          permsPayload = { availability: 'none', reservations: 'write', profile: 'none', menu: 'none', team: 'none' };
        }
        locationId = newMemberLocations[0];
      }

      return addMemberAPI(orgId, {
        email: newMemberEmail.trim(),
        name: newMemberName.trim(),
        password: tempPassword,
        role,
        permissions: permsPayload,
        ...(locationId ? { location_id: locationId } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      void queryClient.invalidateQueries({ queryKey: ['my-context'] });
      setShowAddMemberModal(false);
      setNewMemberName('');
      setNewMemberEmail('');
      setNewMemberLocations([]);
      setNewMemberIsOrgAdmin(false);
      alert.showAlert(t('common.success'), t('business.profile.memberAdded', { defaultValue: 'Membre ajouté avec succès' }));
    },
    onError: (err: any) => {
      alert.showAlert(t('common.error'), getErrorMessage(err));
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const orgId = contextQuery.data?.organization_id;
      if (!orgId) throw new Error('No organization');
      await removeMemberAPI(orgId, memberId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
    },
  });

  // Wrapper around the shared formatPhone util so we keep returning
  // `undefined` for empty input (the existing call site relied on that to
  // distinguish "no phone on file" from a formatted string).
  const formatTnPhone = (raw?: string | null): string | undefined => {
    if (!raw) return undefined;
    const out = formatPhone(raw);
    return out || undefined;
  };

  // Profile = the currently selected location's data. When no location has
  // been added yet, profile is null and the screen short-circuits to a
  // NoLocationCTA — we deliberately do NOT fall back to demo data.
  const profile = profileQuery.data
    ? {
        id: String(profileQuery.data.id),
        name: profileQuery.data.name,
        email: user?.email ?? '',
        phone: formatTnPhone(profileQuery.data.phone),
        address: profileQuery.data.address ?? '',
        category: profileQuery.data.category ?? '',
        description: profileQuery.data.description ?? undefined,
        logo: profileQuery.data.image_url ?? undefined,
        coverPhoto: profileQuery.data.cover_image_url ?? undefined,
        hours: (() => {
          // Use location profile times as the source of truth (updated via handleSaveHours)
          const start = profileQuery.data.pickup_start_time;
          const end = profileQuery.data.pickup_end_time;
          return start && end
            ? `${start.substring(0, 5)} - ${end.substring(0, 5)}`
            : undefined;
        })(),
        latitude: profileQuery.data.latitude ?? 0,
        longitude: profileQuery.data.longitude ?? 0,
        isSupermarket: (profileQuery.data.category ?? '').toLowerCase() === 'supermarket',
      }
    : null;

  const orgLocationsForNoLoc = orgDetailsQuery.data?.locations ?? [];
  const hasNoLocation = isOrgAdmin
    && !!contextQuery.data?.organization_id
    && !orgDetailsQuery.isLoading
    && orgLocationsForNoLoc.length === 0;
  const orgName = contextQuery.data?.organization_name ?? orgDetailsQuery.data?.organization?.name ?? '';
  const orgImageUrl = orgDetailsQuery.data?.organization?.image_url ?? null;
  // Pickup instructions editor state
  const [showPickupInstructionsEditor, setShowPickupInstructionsEditor] = useState(false);
  const [pickupInstructionsText, setPickupInstructionsText] = useState(profileQuery.data?.pickup_instructions ?? '');
  const [pickupInstructionsSaving, setPickupInstructionsSaving] = useState(false);

  // Optimistic image overrides — the freshly-picked URI is shown immediately
  // after upload so the user sees the new cover/logo without restarting the
  // app. Server URLs often reuse the same path on overwrite, which means
  // RN's <Image> cache returns the stale bytes after a refetch. Holding the
  // local URI in state until the next mount sidesteps that.
  const [localCoverUri, setLocalCoverUri] = useState<string | null>(null);
  const [localLogoUri, setLocalLogoUri] = useState<string | null>(null);

  const handleSavePickupInstructions = async () => {
    setPickupInstructionsSaving(true);
    try {
      const { updateLocationById } = await import('@/src/services/business');
      const locationId = profileQuery.data?.id;
      if (!locationId) throw new Error('Profil non chargé');
      const userId = user?.id ? Number(user.id) : undefined;
      await updateLocationById(locationId, { pickup_instructions: pickupInstructionsText.trim() || null } as any, userId, profileQuery.data?.organization_id ?? undefined);
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      setShowPickupInstructionsEditor(false);
    } catch (err: any) {
      alert.showAlert(t('common.error'), getErrorMessage(err));
    } finally {
      setPickupInstructionsSaving(false);
    }
  };

  // Location hours editor state
  const [showHoursModal, setShowHoursModal] = useState(false);
  const hoursSwipe = useSwipeToDismiss(() => setShowHoursModal(false));
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAY_LABELS: Record<string, string> = { Mon: t('business.dashboard.days.Mon'), Tue: t('business.dashboard.days.Tue'), Wed: t('business.dashboard.days.Wed'), Thu: t('business.dashboard.days.Thu'), Fri: t('business.dashboard.days.Fri'), Sat: t('business.dashboard.days.Sat'), Sun: t('business.dashboard.days.Sun') };
  // Seed modal from LOCATION profile times (not basket times — those are basket-specific)
  const defaultStart = profileQuery.data?.pickup_start_time?.substring(0, 5) ?? '09:00';
  const defaultEnd = profileQuery.data?.pickup_end_time?.substring(0, 5) ?? '18:00';
  const [hoursStart, setHoursStart] = useState(defaultStart);
  const [hoursEnd, setHoursEnd] = useState(defaultEnd);
  const [sameAllDays, setSameAllDays] = useState(true);
  // Per-day hours include an optional `closed` flag — when true the location
  // accepts no pickups that day and the time pickers collapse. Mirrors the
  // basket-side `daily_reinit_schedule` pattern; serialized to the new
  // `locations.weekly_schedule` JSONB column on save.
  const [dayHours, setDayHours] = useState<Record<string, { start: string; end: string; closed: boolean }>>(
    Object.fromEntries(DAYS.map(d => [d, { start: defaultStart, end: defaultEnd, closed: false }]))
  );
  const [hoursSaving, setHoursSaving] = useState(false);

  // Hydrate per-day state from the persisted weekly_schedule when the modal
  // opens. Backend stores keys as lower-case `mon`/`tue`/.../`sun`; UI uses
  // `Mon`/`Tue`/... — convert on read and write. Empty/null schedule falls
  // back to the single-window times (sameAllDays = true).
  const DAY_TO_BACKEND: Record<string, string> = { Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' };
  React.useEffect(() => {
    if (!showHoursModal) return;
    const raw = (profileQuery.data as any)?.weekly_schedule;
    const ws = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
    if (!ws || typeof ws !== 'object') return;
    setDayHours(prev => {
      const next = { ...prev };
      for (const dayKey of DAYS) {
        const entry = ws[DAY_TO_BACKEND[dayKey]];
        if (entry && typeof entry === 'object') {
          next[dayKey] = {
            start: typeof entry.start === 'string' ? entry.start.substring(0, 5) : prev[dayKey].start,
            end: typeof entry.end === 'string' ? entry.end.substring(0, 5) : prev[dayKey].end,
            closed: !!entry.closed,
          };
        }
      }
      return next;
    });
    // If any day differs from any other, flip the "Same all days" switch off
    // so the per-day UI is shown by default when there's per-day data.
    const distinct = Object.values(ws).some((e: any) => e && (e.closed || typeof e.start === 'string'));
    if (distinct) setSameAllDays(false);
  }, [showHoursModal, profileQuery.data]);

  // Sync hoursStart/hoursEnd when profile data loads (it may arrive after mount)
  React.useEffect(() => {
    const s = profileQuery.data?.pickup_start_time?.substring(0, 5);
    const e = profileQuery.data?.pickup_end_time?.substring(0, 5);
    if (s && s !== hoursStart) setHoursStart(s);
    if (e && e !== hoursEnd) setHoursEnd(e);
  }, [profileQuery.data?.pickup_start_time, profileQuery.data?.pickup_end_time]);

  // Warning flash for location end time exceeding 03:30
  const [hoursEndWarning, setHoursEndWarning] = useState(false);
  const hoursEndWarningAnim = useRef(new Animated.Value(0)).current;
  const flashHoursEndWarning = useCallback(() => {
    setHoursEndWarning(true);
    Animated.sequence([
      Animated.timing(hoursEndWarningAnim, { toValue: 1, duration: 150, useNativeDriver: false }),
      Animated.timing(hoursEndWarningAnim, { toValue: 0, duration: 2000, useNativeDriver: false }),
    ]).start(() => setHoursEndWarning(false));
  }, [hoursEndWarningAnim]);

  const toTimeField = (hhmm: string) => hhmm.includes(':') && hhmm.split(':').length === 2 ? `${hhmm}:00` : hhmm;
  const normalizePickupTime = (v: string | null | undefined): string | null => {
    if (!v) return null;
    const parts = v.split(':');
    if (parts.length === 2) return `${v}:00`;
    if (parts.length === 3) return v;
    return null;
  };
  const clampToWindow = (v: string | null | undefined, lo: string, hi: string): string => {
    const n = normalizePickupTime(v);
    if (!n) return lo;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  };

  // Wrap the shared validator with i18n. Two failure modes:
  //   - zero        : start === end (no usable window).
  //   - crosses-reset : the window straddles 03:30, the daily reset cron.
  // The cron rolls every basket's inventory back to its
  // `daily_reinitialization_quantity` at that moment, so a window that
  // includes 03:30 would behave incoherently (the basket would
  // unexpectedly refill mid-window). We force the merchant to pick a
  // window that fits one biz day.
  const validateWindow = (startStr: string, endStr: string): string | null => {
    const status = validateBizDayWindow(startStr, endStr);
    if (status === 'ok') return null;
    if (status === 'zero') {
      return t('business.availability.invalidWindow', {
        defaultValue: "L'heure de fin doit être différente de l'heure de début.",
      });
    }
    return t('business.availability.crossReset', {
      defaultValue: "Le créneau ne peut pas traverser la réinitialisation quotidienne (03:30). Choisissez un début ≥ 03:30, ou une fin ≤ 03:29.",
    });
  };

  const runSaveHours = async () => {
    setHoursSaving(true);
    try {
      const { updateLocationById, updateBasket } = await import('@/src/services/business');
      const userId = user?.id ? Number(user.id) : undefined;
      const locationId = profileQuery.data?.id;
      if (!locationId) throw new Error('Profil non chargé');
      // When per-day mode is on, derive the location's single pickup window
      // from the widest open span across non-closed days. This keeps legacy
      // surfaces (which still read `pickup_start_time`/`pickup_end_time`)
      // showing a coherent window; the per-day refinement lives in
      // weekly_schedule. Previously only Monday's values were used — Mon
      // closed + custom Tue–Sun produced nonsense pickup hours.
      let newStart: string;
      let newEnd: string;
      if (sameAllDays) {
        newStart = toTimeField(hoursStart);
        newEnd = toTimeField(hoursEnd);
      } else {
        const openDays = DAYS.filter(d => !dayHours[d]?.closed);
        const starts = openDays.map(d => dayHours[d]?.start ?? hoursStart).filter(Boolean) as string[];
        const ends = openDays.map(d => dayHours[d]?.end ?? hoursEnd).filter(Boolean) as string[];
        // Fall back to the single-window values when every day is closed
        // (degenerate config — at least save valid times so the row stays
        // queryable).
        newStart = toTimeField(starts.length ? starts.sort()[0] : hoursStart);
        newEnd = toTimeField(ends.length ? ends.sort()[ends.length - 1] : hoursEnd);
      }
      // Build the weekly_schedule payload. When sameAllDays is on we clear
      // it (null) — the single window IS the schedule. When off we send a
      // full Mon→Sun map; backend stores it as JSONB.
      const weeklySchedule = sameAllDays ? null : Object.fromEntries(
        DAYS.map(d => {
          const dh = dayHours[d];
          const beKey = DAY_TO_BACKEND[d];
          if (!dh) return [beKey, null];
          if (dh.closed) return [beKey, { closed: true }];
          return [beKey, { closed: false, start: dh.start, end: dh.end }];
        })
      );
      // PUT /api/locations/:id — same pattern as confirmed-working PUT /api/baskets/:id
      await updateLocationById(
        locationId,
        { pickup_start_time: newStart, pickup_end_time: newEnd, weekly_schedule: weeklySchedule } as any,
        userId,
        profileQuery.data?.organization_id ?? undefined
      );
      // Clamp ONLY baskets that have a custom pickup window AND fall outside
      // the new location window. Baskets with NULL pickup times inherit from
      // the location via backend COALESCE — touching them would bake in the
      // current location times and break inheritance for future hour changes.
      const baskets = basketsQuery.data ?? [];
      const adjusted: Array<{ id: string | number; name: string }> = [];
      // Also collect baskets whose own pickup end has already elapsed in
      // business-day terms. When the user widens the location window (e.g.
      // sets "Open all day") they expect those baskets to come back online —
      // we clear the override so the basket inherits the new, generous
      // location window instead of staying frozen at its old expired end.
      const { isPickupExpiredInTz } = await import('@/src/utils/timezone');
      const revived: Array<{ id: string | number; name: string }> = [];
      await Promise.all(
        baskets.map((b) => {
          const bs = normalizePickupTime(b.pickup_start_time);
          const be = normalizePickupTime(b.pickup_end_time);
          if (bs === null || be === null) return Promise.resolve();
          // Inherited basket whose own end has expired and now sits inside
          // the wider location window: clear the override so it inherits.
          if (be && isPickupExpiredInTz(be.substring(0, 5)) && bs >= newStart && be <= newEnd) {
            revived.push({ id: b.id, name: b.name });
            return updateBasket(b.id, {
              pickup_start_time: null,
              pickup_end_time: null,
            } as any).catch((err: any) => {
              console.log('[Profile] Failed to revive basket', b.id, err?.message);
            });
          }
          if (bs >= newStart && be <= newEnd) return Promise.resolve();
          const cs = clampToWindow(b.pickup_start_time, newStart, newEnd);
          const ce = clampToWindow(b.pickup_end_time, newStart, newEnd);
          adjusted.push({ id: b.id, name: b.name });
          return updateBasket(b.id, {
            pickup_start_time: cs,
            pickup_end_time: ce,
          }).catch((err: any) => {
            console.log('[Profile] Failed to clamp basket', b.id, err?.message);
          });
        })
      );
      await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      await queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      // Also invalidate org-details so my-baskets' locationsById map (used to
      // fall back to a basket's location hours when its pickup columns are
      // NULL) reflects the new location hours. Without this, an inheriting
      // basket would keep displaying the OLD location hours even though its
      // effective time has changed.
      await queryClient.invalidateQueries({ queryKey: ['org-details'] });
      await queryClient.refetchQueries({ queryKey: ['my-profile', selectedLocationId] });
      void queryClient.invalidateQueries({ queryKey: ['business-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      setShowHoursModal(false);
      // Update local state so next modal open shows new values
      setHoursStart(newStart.substring(0, 5));
      setHoursEnd(newEnd.substring(0, 5));
      // Post-save recap so the business knows which baskets were nudged.
      // Deferred so the hours modal can finish dismissing before the alert
      // shows (RN can't reliably stack a second Modal over a visible one).
      if (adjusted.length > 0) {
        setTimeout(() => {
          const sHHMM = newStart.substring(0, 5);
          const eHHMM = newEnd.substring(0, 5);
          // Plural-aware fallbacks for the rare case the locale lookup misses.
          const fallback = adjusted.length === 1
            ? `1 panier a été ajusté au nouveau créneau (${sHHMM}-${eHHMM}). Pensez à le vérifier.`
            : `${adjusted.length} paniers ont été ajustés au nouveau créneau (${sHHMM}-${eHHMM}). Pensez à les vérifier.`;
          alert.showAlert(
            t('business.availability.adjustedRecapTitle', { defaultValue: 'Paniers ajustés' }),
            t('business.availability.adjustedRecap', {
              count: adjusted.length,
              start: sHHMM,
              end: eHHMM,
              defaultValue: fallback,
            })
          );
        }, 300);
      }
    } catch (err: any) {
      alert.showAlert(t('common.error'), getErrorMessage(err));
    } finally {
      setHoursSaving(false);
    }
  };

  const handleSaveHours = async () => {
    // Surface validation errors via CustomAlert. CRITICAL: RN can't reliably
    // stack two Modals (CustomAlert sits in its own Modal), so we close the
    // hours sheet first and wait one frame before showing the alert.
    // Without the close-first pattern the alert renders behind the hours
    // sheet on iOS — the user sees "save did nothing" and then a frozen
    // app when dismissing, because two modals collide.
    const showValidationError = (msg: string) => {
      setShowHoursModal(false);
      setTimeout(() => {
        alert.showAlert(t('common.error', { defaultValue: 'Erreur' }), msg);
      }, 300);
    };

    // Validate every open day's window before doing any other work. A
    // single bad window blocks the save with a clear error — better to
    // catch it here than silently persist 00:00-00:00 and then have
    // baskets render as expired on the customer side.
    if (sameAllDays) {
      const err = validateWindow(hoursStart, hoursEnd);
      if (err) { showValidationError(err); return; }
    } else {
      const openDays = DAYS.filter(d => !dayHours[d]?.closed);
      // At least one day must be open — otherwise the location effectively
      // has no pickup hours at all.
      if (openDays.length === 0) {
        showValidationError(
          t('business.availability.allDaysClosed', { defaultValue: 'Au moins un jour doit rester ouvert.' })
        );
        return;
      }
      for (const d of openDays) {
        const err = validateWindow(dayHours[d]?.start ?? '09:00', dayHours[d]?.end ?? '18:00');
        if (err) {
          showValidationError(`${DAY_LABELS[d]} — ${err}`);
          return;
        }
      }
    }

    // Use the same widest-span derivation as runSaveHours so the conflict
    // detection matches what will actually be saved.
    let newStart: string;
    let newEnd: string;
    if (sameAllDays) {
      newStart = toTimeField(hoursStart);
      newEnd = toTimeField(hoursEnd);
    } else {
      const openDays = DAYS.filter(d => !dayHours[d]?.closed);
      const starts = openDays.map(d => dayHours[d]?.start ?? hoursStart).filter(Boolean) as string[];
      const ends = openDays.map(d => dayHours[d]?.end ?? hoursEnd).filter(Boolean) as string[];
      newStart = toTimeField(starts.length ? starts.sort()[0] : hoursStart);
      newEnd = toTimeField(ends.length ? ends.sort()[ends.length - 1] : hoursEnd);
    }
    const baskets = basketsQuery.data ?? [];
    const conflicting = baskets.filter((b) => {
      const bs = normalizePickupTime(b.pickup_start_time);
      const be = normalizePickupTime(b.pickup_end_time);
      return (bs !== null && bs < newStart) || (be !== null && be > newEnd);
    });
    if (conflicting.length > 0) {
      // Close the hours modal before showing the alert — RN can't reliably
      // stack a second Modal on top of a visible one (iOS freezes, Android
      // hides the new one behind the old one).
      setShowHoursModal(false);
      const resetToSaved = () => {
        const s = profileQuery.data?.pickup_start_time?.substring(0, 5) ?? '09:00';
        const e = profileQuery.data?.pickup_end_time?.substring(0, 5) ?? '18:00';
        setHoursStart(s);
        setHoursEnd(e);
        setDayHours(Object.fromEntries(DAYS.map(d => [d, { start: s, end: e, closed: false }])));
      };
      setTimeout(() => {
        alert.showAlert(
          t('business.availability.conflictTitle'),
          t('business.availability.conflictMessage', {
            count: conflicting.length,
            start: newStart.substring(0, 5),
            end: newEnd.substring(0, 5),
          }),
          [
            { text: t('common.cancel'), style: 'cancel', onPress: resetToSaved },
            { text: t('business.availability.adjustAndSave'), onPress: () => { void runSaveHours(); } },
          ]
        );
      }, 300);
      return;
    }
    await runSaveHours();
  };

  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState<string | null>(null);
  const [showPermissionsModal, setShowPermissionsModal] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<TeamRole>('restricted');
  const [newMemberIsOrgAdmin, setNewMemberIsOrgAdmin] = useState(false);
  const [newMemberLocations, setNewMemberLocations] = useState<number[]>([]);
  const orgLocations = (orgDetailsQuery.data as any)?.locations ?? [];

  const handleAddMember = useCallback(() => {
    if (!newMemberName.trim() || !newMemberEmail.trim()) return;
    addMemberMutation.mutate();
  }, [newMemberName, newMemberEmail, addMemberMutation]);

  const handleRemoveMember = useCallback((memberId: string) => {
    alert.showAlert(
      t('business.profile.removeMember'),
      '',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: () => removeMemberMutation.mutate(memberId) },
      ]
    );
  }, [removeMemberMutation, t]);

  const permBoolToString = (val: boolean): string => val ? 'write' : 'none';

  const handleChangeRole = useCallback(async (memberId: string, role: TeamRole) => {
    const perms: TeamPermission = DEFAULT_PERMISSIONS[role];
    // Update local state immediately for UI responsiveness
    updateTeamMemberRole(memberId, role, perms);
    setShowRoleModal(null);
    // Persist to backend
    try {
      const orgId = contextQuery.data?.organization_id;
      if (orgId) {
        const permsPayload: Record<string, string> = {};
        Object.entries(perms).forEach(([k, v]) => { permsPayload[k] = permBoolToString(v); });
        await updateMember(orgId, memberId, { role, permissions: permsPayload });
        void queryClient.invalidateQueries({ queryKey: ['org-details'] });
        void queryClient.invalidateQueries({ queryKey: ['my-context'] });
      }
    } catch (err: any) {
      alert.showAlert(t('common.error'), t('business.team.updateFailed', { defaultValue: 'Échec de la mise à jour des permissions' }));
    }
  }, [updateTeamMemberRole, contextQuery.data, queryClient, t, alert]);

  const handleTogglePermission = useCallback(async (memberId: string, permKey: keyof TeamPermission) => {
    // Find the member from API data (not Zustand)
    const members = orgDetailsQuery.data?.members ?? [];
    const m = members.find((mem: any) => String(mem.membership_id) === String(memberId) || String(mem.user_id) === String(memberId));
    if (!m) return;
    const rawP = typeof m.permissions === 'string' ? JSON.parse(m.permissions) : (m.permissions ?? {});
    // Build current perms as booleans
    const currentPerms: Record<string, boolean> = {
      confirm_pickup: rawP.confirm_pickup === 'write' || rawP.confirm_pickup === true,
      edit_quantities: rawP.edit_quantities === 'write' || rawP.edit_quantities === true,
      edit_basket_info: rawP.edit_basket_info === 'write' || rawP.edit_basket_info === true,
      create_delete_baskets: rawP.create_delete_baskets === 'write' || rawP.create_delete_baskets === true,
      view_history: rawP.view_history === 'write' || rawP.view_history === true,
      messaging: rawP.messaging === 'write' || rawP.messaging === true,
    };
    // Toggle the key
    currentPerms[permKey] = !currentPerms[permKey];
    const permsPayload: Record<string, string> = {};
    Object.entries(currentPerms).forEach(([k, v]) => { permsPayload[k] = permBoolToString(v as boolean); });
    try {
      const orgId = contextQuery.data?.organization_id;
      if (orgId) {
        await updateMember(orgId, memberId, { permissions: permsPayload });
        await queryClient.invalidateQueries({ queryKey: ['org-details'] });
        void queryClient.invalidateQueries({ queryKey: ['my-context'] });
        void queryClient.invalidateQueries({ queryKey: ['my-context'] });
      }
    } catch (err: any) {
      alert.showAlert(t('common.error'), t('business.team.updateFailed', { defaultValue: 'Échec de la mise à jour des permissions' }));
    }
  }, [orgDetailsQuery.data, contextQuery.data, queryClient, t, alert]);

  const handleChangeCover = async () => {
    try {
      const uri = await pickAndCrop({ aspect: [16, 5], quality: 0.8 });
      if (!uri) return;
      const formData = new FormData();
      const filename = uri.split('/').pop() ?? 'cover.jpg';
      formData.append('cover_image', { uri, name: filename, type: 'image/jpeg' } as any);
      // Optimistic local override so the new cover appears immediately.
      setLocalCoverUri(uri);
      try {
        const { updateMyProfile } = await import('@/src/services/business');
        const userId = (user as any)?.id as number | undefined;
        await updateMyProfile(formData, userId);
        await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
        await queryClient.invalidateQueries({ queryKey: ['org-details'] });
        alert.showAlert(t('common.success'), t('business.profile.imageUpdated'));
      } catch (err: any) {
        setLocalCoverUri(null);
        alert.showAlert(t('common.error'), getErrorMessage(err));
      }
    } catch {
      alert.showAlert(t('common.error'), t('common.errorOccurred'));
    }
  };

  const handleChangeLogo = async () => {
    try {
      const uri = await pickAndCrop({ aspect: [1, 1], quality: 0.8 });
      if (!uri) return;
      const formData = new FormData();
      const filename = uri.split('/').pop() ?? 'logo.jpg';
      formData.append('image', { uri, name: filename, type: 'image/jpeg' } as any);
      setLocalLogoUri(uri);
      try {
        const { updateMyProfile } = await import('@/src/services/business');
        const userId = (user as any)?.id as number | undefined;
        await updateMyProfile(formData, userId);
        await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
        await queryClient.invalidateQueries({ queryKey: ['org-details'] });
        alert.showAlert(t('common.success'), t('business.profile.imageUpdated'));
      } catch (err: any) {
        setLocalLogoUri(null);
        alert.showAlert(t('common.error'), getErrorMessage(err));
      }
    } catch {
      alert.showAlert(t('common.error'), t('common.errorOccurred'));
    }
  };

  const roleLabel = (role: TeamRole) => {
    switch (role) {
      case 'admin': return t('business.profile.admin');
      case 'restricted': return t('business.profile.restricted');
      case 'custom': return t('business.profile.custom');
      default: return role;
    }
  };

  const roleColor = (role: TeamRole) => {
    switch (role) {
      case 'admin': return theme.colors.primary;
      case 'restricted': return theme.colors.accentWarm;
      case 'custom': return theme.colors.accentFresh;
      default: return theme.colors.muted;
    }
  };

  const permissionLabels: { key: keyof TeamPermission; label: string; desc: string }[] = [
    { key: 'confirm_pickup', label: t('business.profile.permConfirmPickup', { defaultValue: 'Confirmer les retraits' }), desc: t('business.profile.permConfirmPickupDesc', { defaultValue: "Scanner le QR / saisir le code pour confirmer le retrait d'un client" }) },
    { key: 'edit_quantities', label: t('business.profile.permEditQuantities', { defaultValue: 'Modifier les quantités' }), desc: t('business.profile.permEditQuantitiesDesc', { defaultValue: 'Changer la quantité disponible des paniers, mettre en pause les ventes' }) },
    { key: 'edit_basket_info', label: t('business.profile.permEditBasketInfo', { defaultValue: 'Modifier les paniers' }), desc: t('business.profile.permEditBasketInfoDesc', { defaultValue: 'Modifier le prix, description, horaires de retrait et instructions' }) },
    { key: 'create_delete_baskets', label: t('business.profile.permCreateDeleteBaskets', { defaultValue: 'Créer et supprimer des paniers' }), desc: t('business.profile.permCreateDeleteBasketsDesc', { defaultValue: 'Ajouter de nouveaux paniers ou supprimer des paniers existants' }) },
    { key: 'view_history', label: t('business.profile.permViewHistory', { defaultValue: 'Historique et statistiques' }), desc: t('business.profile.permViewHistoryDesc', { defaultValue: 'Voir les stats de vente, l\'historique des commandes et les graphiques de performance' }) },
    { key: 'messaging', label: t('business.profile.permMessaging', { defaultValue: 'Messagerie clients' }), desc: t('business.profile.permMessagingDesc', { defaultValue: 'Envoyer et recevoir des messages avec les clients' }) },
    { key: 'cancel_order', label: t('business.profile.permCancelOrder', { defaultValue: 'Annuler des commandes' }), desc: t('business.profile.permCancelOrderDesc', { defaultValue: 'Annuler les commandes entrantes et rembourser les clients en crédits' }) },
  ];

  // Use API member data (orgDetailsQuery) for permission toggles, not Zustand store
  const apiMembers = orgDetailsQuery.data?.members ?? [];
  const selectedMemberForPerms = showPermissionsModal
    ? (() => {
        const m = apiMembers.find((mem: any) => String(mem.membership_id) === String(showPermissionsModal) || String(mem.user_id) === String(showPermissionsModal));
        if (!m) return null;
        const rawP = typeof m.permissions === 'string' ? JSON.parse(m.permissions) : (m.permissions ?? {});
        return {
          id: String(m.membership_id),
          name: m.name ?? m.email ?? '',
          role: m.role ?? 'member',
          permissions: {
            confirm_pickup: rawP.confirm_pickup === 'write' || rawP.confirm_pickup === true,
            edit_quantities: rawP.edit_quantities === 'write' || rawP.edit_quantities === true,
            edit_basket_info: rawP.edit_basket_info === 'write' || rawP.edit_basket_info === true,
            create_delete_baskets: rawP.create_delete_baskets === 'write' || rawP.create_delete_baskets === true,
            view_history: rawP.view_history === 'write' || rawP.view_history === true,
            messaging: rawP.messaging === 'write' || rawP.messaging === true,
          } as TeamPermission,
        };
      })()
    : null;

  if (profileQuery.isLoading && !profileQuery.data) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
          {t('business.profile.title')}
        </Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView style={styles.content} contentContainerStyle={{ padding: theme.spacing.xl, paddingBottom: 100 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={[styles.coverSection, { borderRadius: theme.radii.r16, overflow: 'hidden', ...theme.shadows.shadowSm }]}>
          {(localCoverUri ?? profile?.coverPhoto) ? (
            <Image source={{ uri: (localCoverUri ?? profile?.coverPhoto) as string }} style={styles.coverImage} />
          ) : (
            <View style={[styles.coverImage, { backgroundColor: theme.colors.primary + '20' }]} />
          )}
          <View style={[styles.coverOverlay, { backgroundColor: 'rgba(0,0,0,0.2)' }]} />
          {canEditProfile && (
            <TouchableOpacity onPress={handleChangeCover} style={[styles.coverEditBtn, { backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: theme.radii.r8, padding: 6 }]}>
              <Camera size={16} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.profileCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginTop: -30, marginHorizontal: theme.spacing.sm, ...theme.shadows.shadowMd }]}>
          <View style={styles.profileTop}>
            <View style={styles.logoWrap}>
              {(localLogoUri ?? orgImageUrl ?? profile?.logo) ? (
                <Image source={{ uri: (localLogoUri ?? orgImageUrl ?? profile?.logo) as string }} style={[styles.profileLogo, { borderRadius: theme.radii.r16 }]} />
              ) : (
                <View style={[styles.profileLogo, { borderRadius: theme.radii.r16, backgroundColor: theme.colors.primary + '15' }]}>
                  <Store size={32} color={theme.colors.primary} />
                </View>
              )}
              {canEditProfile && !hasNoLocation && (
                <TouchableOpacity onPress={handleChangeLogo} style={[styles.logoEditBtn, { backgroundColor: theme.colors.primary, borderRadius: 12, width: 24, height: 24 }]}>
                  <Camera size={12} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.profileInfo}>
              {/* Top-of-profile name: show "Org - Location" when a specific
                  location is selected, or just the org name when viewing the
                  "all locations" / org-admin scope. Consistent with the rest
                  of the business interface, which always shows the org
                  prefix before the location name. */}
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]} numberOfLines={1} ellipsizeMode="tail">
                {selectedLocationId
                  ? formatLocationName(orgName, profileQuery.data?.location_name, profileQuery.data?.name ?? '')
                  : (orgName || profileQuery.data?.name || '')}
              </Text>
              {hasNoLocation ? (
                <Text style={[{ color: '#e67e22', ...theme.typography.bodySm, marginTop: 2 }]}>
                  {t('business.locationSwitcher.noLocationYet')}
                </Text>
              ) : !selectedLocationId ? (
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }]}>
                  {t('business.profile.allLocationsLabel', { defaultValue: 'Organisation' })}
                </Text>
              ) : profile?.category ? (
                <View style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: '#114b3c15', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 }}>
                  <Text style={{ color: '#114b3c', ...theme.typography.caption, fontWeight: '600' }}>
                    {t(`categories.${profile.category.toLowerCase()}`, { defaultValue: profile.category })}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* Team Management Card (only visible to admin/owner) */}
        {(contextQuery.data?.role === 'admin' || contextQuery.data?.role === 'owner') && (
        <TouchableOpacity
          ref={(r: any) => {
            if (r) {
              requestAnimationFrame(() => {
                r.measureInWindow?.((x: number, y: number, w: number, h: number) => {
                  if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('profileTeamCard', { x, y, w, h });
                });
              });
            }
          }}
          onLayout={(e) => {
            // measureInWindow on layout for accurate window-coords
            (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
              if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('profileTeamCard', { x, y, w, h });
            });
          }}
          onPress={() => router.push('/business/team' as never)}
          style={[styles.infoCard, {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r16,
            marginTop: theme.spacing.lg,
            padding: theme.spacing.lg,
            ...theme.shadows.shadowSm,
            flexDirection: 'row',
            alignItems: 'center',
          }]}
          activeOpacity={0.7}
        >
          <View style={[{
            backgroundColor: theme.colors.primary + '12',
            borderRadius: theme.radii.r12,
            width: 44,
            height: 44,
            justifyContent: 'center',
            alignItems: 'center',
          }]}>
            <Users size={22} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
              {t('business.profile.teamManagement')}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}>
              {uniqueTeamMemberCount} {t('business.team.members')}
            </Text>
          </View>
          <ChevronRight size={20} color={theme.colors.muted} />
        </TouchableOpacity>
        )}

        {/* Menu Items Card — above Business Info (feature-flagged) */}
        {FeatureFlags.ENABLE_MENU_ITEMS && <TouchableOpacity
          onPress={() => router.push('/business/menu-items' as never)}
          style={[styles.infoCard, {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r16,
            marginTop: theme.spacing.sm,
            padding: theme.spacing.lg,
            ...theme.shadows.shadowSm,
            flexDirection: 'row',
            alignItems: 'center',
          }]}
          activeOpacity={0.7}
        >
          <View style={[{
            backgroundColor: theme.colors.primary + '12',
            borderRadius: theme.radii.r12,
            width: 44,
            height: 44,
            justifyContent: 'center',
            alignItems: 'center',
          }]}>
            <UtensilsCrossed size={22} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
              {t('business.profile.menuItems')}
            </Text>
          </View>
          <ChevronRight size={20} color={theme.colors.muted} />
        </TouchableOpacity>}

        {/* Business Info Card */}
        <View
          onLayout={(e) => {
            (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
              if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('profileBusinessInfo', { x, y, w, h });
            });
          }}
          style={[styles.infoCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}
        >
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, padding: theme.spacing.lg, paddingBottom: theme.spacing.sm }]}>
            {t('business.profile.businessInfo')}
          </Text>

          {hasNoLocation ? (
            <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg }}>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: theme.spacing.md, textAlign: 'center' as const, fontStyle: 'italic' as const }]}>
                {t('business.noLocation.profileHint')}
              </Text>
              <NoLocationCTA compact />
            </View>
          ) : [
            // "Nom du commerce": "Org - Location" when a specific location
            // is selected; just the org name for the org-admin "all locations"
            // view. The row value text uses numberOfLines={1} + ellipsisMode
            // tail, so long combined strings truncate cleanly instead of
            // wrapping (which previously mis-aligned the row).
            {
              icon: Store,
              label: t('business.profile.name'),
              value: selectedLocationId
                ? formatLocationName(contextQuery.data?.organization_name, profileQuery.data?.location_name, '-')
                : (contextQuery.data?.organization_name || profileQuery.data?.location_name || '-'),
            },
            { icon: MapPin, label: t('business.profile.address'), value: profile?.address ?? '-' },
            // Phone row intentionally omitted from the business profile —
            // the value is still saved on the location row (used by the
            // backend and admin tools) but not shown in the merchant's UI.
            { icon: Clock, label: t('business.profile.hours'), value: profile?.hours ?? '-', onPress: () => setShowHoursModal(true) },
          ].map((item, index) => {
            const IconComp = item.icon;
            const Wrapper = item.onPress ? TouchableOpacity : View;
            return (
              <Wrapper
                key={index}
                onPress={item.onPress}
                activeOpacity={0.7}
                style={[styles.infoRow, {
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.md,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.divider,
                }]}
              >
                <View style={styles.infoRowLeft}>
                  <IconComp size={18} color={theme.colors.textSecondary} />
                  <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                    {item.label}
                  </Text>
                </View>
                {/* Single-line value with ellipsis. Long values used to wrap
                    to a second line which mis-aligned the row (the icon+label
                    on the left were vertically centred against the 2-line
                    block, so the label looked like it sat above the value). */}
                <Text
                  style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const, flex: 1, textAlign: 'right' as const, marginLeft: 12 }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {item.value}
                </Text>
                {/* Editing affordance — pencil icon (not a navigation
                    chevron) because tapping opens an inline editor in
                    place rather than navigating to a separate screen. */}
                {item.onPress && <View style={{ marginLeft: 6 }}><EditIcon8 size={15} /></View>}
              </Wrapper>
            );
          })}

          {profile?.description ? (
            <View style={[{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: 4 }]}>
                {t('business.profile.description')}
              </Text>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                {profile.description}
              </Text>
            </View>
          ) : null}

        </View>

        {/* Pickup Instructions Card — hidden when no location exists yet
            (instructions are per-location and would render fake "no instructions"
            text that's not actionable). */}
        {!hasNoLocation && <View style={[styles.infoCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Package size={18} color={theme.colors.primary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                {t('business.profile.pickupInstructions', { defaultValue: 'Instructions de retrait' })}
              </Text>
            </View>
            {canEditAvailability && <TouchableOpacity onPress={() => { setPickupInstructionsText(profileQuery.data?.pickup_instructions ?? ''); setShowPickupInstructionsEditor(!showPickupInstructionsEditor); }}>
              {/* Pencil while closed (this is an in-place editor, not a
                  navigation), X while open as the cancel/dismiss affordance. */}
              {showPickupInstructionsEditor
                ? <X size={18} color={theme.colors.textSecondary} />
                : <EditIcon8 size={16} />}
            </TouchableOpacity>}
          </View>
          <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingTop: theme.spacing.md }}>
            {showPickupInstructionsEditor ? (
              <View>
                <TextInput
                  style={{ backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, padding: 12, color: theme.colors.textPrimary, ...theme.typography.body, minHeight: 80, borderWidth: 1, borderColor: theme.colors.divider, textAlignVertical: 'top' }}
                  value={pickupInstructionsText}
                  onChangeText={setPickupInstructionsText}
                  placeholder={t('business.createBasket.pickupInstructionsPlaceholder', { defaultValue: 'Ex: Sonnez à l\'entrée arrière' })}
                  placeholderTextColor={theme.colors.muted}
                  multiline
                />
                <TouchableOpacity
                  onPress={handleSavePickupInstructions}
                  disabled={pickupInstructionsSaving}
                  style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, paddingVertical: 12, alignItems: 'center', marginTop: theme.spacing.md, flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                >
                  <Check size={16} color="#fff" />
                  <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' }}>
                    {pickupInstructionsSaving ? t('common.loading') : t('common.save')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={{ color: profileQuery.data?.pickup_instructions ? theme.colors.textSecondary : theme.colors.muted, ...theme.typography.bodySm, fontStyle: profileQuery.data?.pickup_instructions ? 'normal' : 'italic' }}>
                {profileQuery.data?.pickup_instructions || t('business.profile.noPickupInstructions', { defaultValue: 'Aucune instruction définie. Appuyez pour en ajouter.' })}
              </Text>
            )}
          </View>
        </View>}

        {FeatureFlags.ENABLE_FINANCIAL_INFO && !hasNoLocation && <View style={[styles.infoCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, padding: theme.spacing.lg, paddingBottom: theme.spacing.sm }]}>
            {t('business.profile.financialInfo')}
          </Text>
          <View style={[styles.infoRow, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
            <View style={styles.infoRowLeft}>
              <CreditCard size={18} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                {t('business.profile.iban')}
              </Text>
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
              {(profile as any)?.iban ?? '••••••••••••'}
            </Text>
          </View>
          <TouchableOpacity style={[styles.infoRow, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
            <View style={styles.infoRowLeft}>
              <CreditCard size={18} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                {t('business.profile.paymentHistory')}
              </Text>
            </View>
            <ChevronRight size={18} color={theme.colors.muted} />
          </TouchableOpacity>
        </View>}

        <View style={{ height: 40 }} />
      </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={showAddMemberModal} transparent animationType="fade" onRequestClose={() => setShowAddMemberModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAddMemberModal(false)}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHeader}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                {t('business.profile.addMember')}
              </Text>
              <TouchableOpacity onPress={() => setShowAddMemberModal(false)}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginTop: theme.spacing.lg, marginBottom: theme.spacing.xs }]}>
              {t('business.profile.memberName')}<Text style={{ color: theme.colors.error }}> *</Text>
            </Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body }]}
              value={newMemberName}
              onChangeText={setNewMemberName}
              placeholder={t('business.profile.memberName')}
              placeholderTextColor={theme.colors.muted}
            />
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginTop: theme.spacing.md, marginBottom: theme.spacing.xs }]}>
              {t('business.profile.memberEmail')}<Text style={{ color: theme.colors.error }}> *</Text>
            </Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body }]}
              value={newMemberEmail}
              onChangeText={setNewMemberEmail}
              placeholder={t('business.profile.memberEmail')}
              placeholderTextColor={theme.colors.muted}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }]}>
              {t('business.profile.memberRole')}
            </Text>
            {/* Role options — clearer labels with subtitles */}
            {[
              { id: 'orgAdmin', label: t('business.profile.orgAdmin', { defaultValue: "Admin de l'organisation" }), desc: t('business.profile.orgAdminDesc', { defaultValue: 'Accès total à tous les emplacements et toutes les fonctionnalités' }), color: '#114b3c' },
              { id: 'locAdmin', label: t('business.profile.locAdmin', { defaultValue: "Admin d'emplacement" }), desc: t('business.profile.locAdminDesc', { defaultValue: 'Accès complet aux emplacements assignés' }), color: theme.colors.primary },
              { id: 'member', label: t('business.profile.memberRole', { defaultValue: 'Membre' }), desc: t('business.profile.memberRoleDesc', { defaultValue: 'Accès limité selon les permissions ci-dessous' }), color: theme.colors.muted },
            ].map((opt) => {
              const selected = opt.id === 'orgAdmin' ? newMemberIsOrgAdmin
                : opt.id === 'locAdmin' ? (!newMemberIsOrgAdmin && newMemberRole === ('admin' as TeamRole))
                : (!newMemberIsOrgAdmin && newMemberRole === ('restricted' as TeamRole));
              return (
                <TouchableOpacity
                  key={opt.id}
                  onPress={() => {
                    if (opt.id === 'orgAdmin') { setNewMemberIsOrgAdmin(true); setNewMemberRole('admin' as TeamRole); setNewMemberLocations([]); }
                    else if (opt.id === 'locAdmin') { setNewMemberIsOrgAdmin(false); setNewMemberRole('admin' as TeamRole); }
                    else { setNewMemberIsOrgAdmin(false); setNewMemberRole('restricted' as TeamRole); }
                  }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', padding: theme.spacing.md, borderRadius: theme.radii.r12, marginBottom: theme.spacing.xs,
                    backgroundColor: selected ? opt.color + '12' : theme.colors.bg,
                    borderWidth: selected ? 1.5 : 0, borderColor: opt.color,
                  }}
                >
                  <Shield size={16} color={opt.color} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: selected ? opt.color : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: selected ? '600' : '400' }}>
                      {opt.label}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 1 }}>{opt.desc}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Location assignment — required unless org admin */}
            {!newMemberIsOrgAdmin && orgLocations.length > 0 && (
              <>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }]}>
                  {t('business.profile.assignLocations', { defaultValue: 'Assigner aux emplacements *' })}
                </Text>
                {orgLocations.map((loc: any) => {
                  const selected = newMemberLocations.includes(loc.id);
                  return (
                    <TouchableOpacity
                      key={loc.id}
                      onPress={() => setNewMemberLocations(prev => selected ? prev.filter(id => id !== loc.id) : [...prev, loc.id])}
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, marginBottom: 4, backgroundColor: selected ? theme.colors.primary + '10' : theme.colors.bg }}
                    >
                      <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: selected ? theme.colors.primary : theme.colors.muted, backgroundColor: selected ? theme.colors.primary : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
                        {selected && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
                      </View>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginLeft: 10 }}>
                        {loc.name ?? loc.display_name ?? `Location ${loc.id}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {newMemberLocations.length === 0 && (
                  <Text style={{ color: theme.colors.error, fontSize: 11, marginTop: 4 }}>
                    {t('business.profile.locationRequired', { defaultValue: 'Veuillez sélectionner au moins un emplacement' })}
                  </Text>
                )}
              </>
            )}

            <TouchableOpacity
              onPress={handleAddMember}
              disabled={!newMemberIsOrgAdmin && newMemberLocations.length === 0 && orgLocations.length > 0}
              style={[{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.lg, opacity: (!newMemberIsOrgAdmin && newMemberLocations.length === 0 && orgLocations.length > 0) ? 0.5 : 1 }]}
            >
              <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                {t('common.add')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showRoleModal !== null} transparent animationType="fade" onRequestClose={() => setShowRoleModal(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowRoleModal(null)}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
              {t('business.profile.memberRole')}
            </Text>
            {(['admin', 'restricted'] as TeamRole[]).map((role) => (
              <TouchableOpacity
                key={role}
                onPress={() => showRoleModal && handleChangeRole(showRoleModal, role)}
                style={[{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: theme.spacing.lg,
                  borderRadius: theme.radii.r12,
                  marginBottom: theme.spacing.sm,
                  backgroundColor: theme.colors.bg,
                }]}
              >
                <Shield size={18} color={roleColor(role)} />
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                  {roleLabel(role)}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => setShowRoleModal(null)}
              style={[{ padding: theme.spacing.md, marginTop: theme.spacing.sm }]}
            >
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' as const }]}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showPermissionsModal !== null} transparent animationType="fade" onRequestClose={() => setShowPermissionsModal(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowPermissionsModal(null)}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHeader}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                {t('business.profile.permissions')}
              </Text>
              <TouchableOpacity onPress={() => setShowPermissionsModal(null)}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {selectedMemberForPerms && (
              <View style={{ marginTop: theme.spacing.md }}>
                <View style={[{ backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, padding: theme.spacing.md, marginBottom: theme.spacing.lg }]}>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }]}>
                    {selectedMemberForPerms.name}
                  </Text>
                  <Text style={[{ color: roleColor(selectedMemberForPerms.role), ...theme.typography.caption, marginTop: 2 }]}>
                    {roleLabel(selectedMemberForPerms.role)}
                  </Text>
                </View>

                {/* Location assignment */}
                {isAdmin && orgLocations.length > 0 && (
                  <View style={{ marginBottom: theme.spacing.lg }}>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginBottom: theme.spacing.sm }}>
                      {t('business.profile.assignedLocation', { defaultValue: 'Emplacement assigné' })}
                    </Text>
                    {orgLocations.map((loc: any) => {
                      const memberLocId = (selectedMemberForPerms as any)?.location_id;
                      const isLocSelected = loc.id === Number(memberLocId);
                      return (
                        <TouchableOpacity
                          key={loc.id}
                          onPress={async () => {
                            try {
                              const orgId = contextQuery.data?.organization_id;
                              if (orgId) {
                                await updateMember(orgId, selectedMemberForPerms!.id, { location_id: loc.id });
                                void queryClient.invalidateQueries({ queryKey: ['org-details'] });
                                void queryClient.invalidateQueries({ queryKey: ['my-context'] });
                                alert.showAlert(t('common.success'), t('business.team.locationUpdated', { defaultValue: 'Emplacement mis à jour' }));
                              }
                            } catch (err: any) {
                              alert.showAlert(t('common.error'), getErrorMessage(err));
                            }
                          }}
                          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, marginBottom: 4, backgroundColor: isLocSelected ? theme.colors.primary + '12' : theme.colors.bg, borderWidth: isLocSelected ? 1.5 : 0, borderColor: theme.colors.primary }}
                        >
                          <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: isLocSelected ? theme.colors.primary : theme.colors.muted, backgroundColor: isLocSelected ? theme.colors.primary : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
                            {isLocSelected && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' }} />}
                          </View>
                          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginLeft: 10 }}>{loc.name ?? `Location ${loc.id}`}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* Grant admin toggle */}
                <TouchableOpacity
                  onPress={async () => {
                    const isCurrentlyAdmin = selectedMemberForPerms.role === 'admin';
                    const newRole = isCurrentlyAdmin ? 'member' : 'admin';
                    try {
                      const orgId = contextQuery.data?.organization_id;
                      if (orgId) {
                        await updateMember(orgId, selectedMemberForPerms.id, { role: newRole });
                        void queryClient.invalidateQueries({ queryKey: ['org-details'] });
                        void queryClient.invalidateQueries({ queryKey: ['my-context'] });
                        void queryClient.invalidateQueries({ queryKey: ['my-context'] });
                      }
                    } catch {}
                  }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    backgroundColor: selectedMemberForPerms.role === 'admin' ? theme.colors.primary + '12' : theme.colors.bg,
                    borderRadius: theme.radii.r12, padding: theme.spacing.md, marginBottom: theme.spacing.md,
                    borderWidth: selectedMemberForPerms.role === 'admin' ? 1.5 : 1,
                    borderColor: selectedMemberForPerms.role === 'admin' ? theme.colors.primary : theme.colors.divider,
                  }}
                >
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Shield size={16} color={selectedMemberForPerms.role === 'admin' ? theme.colors.primary : theme.colors.muted} />
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' }}>
                        {t('business.profile.grantAdminAccess', { defaultValue: "Accorder l'accès admin" })}
                      </Text>
                    </View>
                    <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4, lineHeight: 15 }}>
                      {t('business.profile.grantAdminAccessDesc', { defaultValue: "Donne accès à tout: gestion d'équipe, profil du commerce, et toutes les permissions" })}
                    </Text>
                  </View>
                  <Switch
                    value={selectedMemberForPerms.role === 'admin'}
                    onValueChange={() => {}}
                    trackColor={{ false: theme.colors.divider, true: theme.colors.primary + '50' }}
                    thumbColor={selectedMemberForPerms.role === 'admin' ? theme.colors.primary : theme.colors.muted}
                  />
                </TouchableOpacity>

                {/* Granular permission toggles — hidden when admin */}
                {selectedMemberForPerms.role !== 'admin' && permissionLabels.map(({ key, label, desc }) => (
                  <View
                    key={key}
                    style={{
                      paddingVertical: theme.spacing.md,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.colors.divider,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1, marginRight: 12 }}>
                        {label}
                      </Text>
                      <Switch
                        value={selectedMemberForPerms.permissions[key]}
                        onValueChange={() => handleTogglePermission(selectedMemberForPerms.id, key)}
                        trackColor={{ false: theme.colors.divider, true: theme.colors.primary + '50' }}
                        thumbColor={selectedMemberForPerms.permissions[key] ? theme.colors.primary : theme.colors.muted}
                      />
                    </View>
                    <Text style={{ color: selectedMemberForPerms.permissions[key] ? theme.colors.textSecondary : theme.colors.muted, fontSize: 11, lineHeight: 15, marginTop: 3 }}>
                      {desc}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity
              onPress={() => setShowPermissionsModal(null)}
              style={[{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.xl }]}
            >
              <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                {t('common.done')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Location Hours Editor Modal.
          Layout: backdrop Pressable + content View as SIBLINGS (not
          parent/child) so the backdrop tap-to-close doesn't fight the
          inner ScrollView's pan responder. The previous nesting (parent
          TouchableOpacity + child View with onStartShouldSetResponder)
          intercepted touches after the user tapped the "Fermé" pill,
          which froze the scroll on Android. */}
      <Modal visible={showHoursModal} transparent animationType="fade" onRequestClose={() => setShowHoursModal(false)}>
        {/* backgroundColor on the KeyboardAvoidingView so the keyboard
            push-up region paints with the same dim color as the rest of
            the backdrop — without it the window's default (white)
            background leaks through beneath the keyboard. */}
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }}
            onPress={() => setShowHoursModal(false)}
          />
          <Animated.View
            style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40, paddingHorizontal: 20, maxHeight: '80%', transform: [{ translateY: hoursSwipe.translateY }] }}
          >
            {/* Swipe zone — full-width strip at the top of the sheet
                hosts the handle pill AND the PanResponder. Wrapping
                this in its own View (instead of putting panHandlers
                on the outer sheet) means the inner ScrollView for
                the per-day editors keeps scrolling normally and the
                swipe-down only fires from this top strip. */}
            <View
              {...hoursSwipe.panHandlers}
              style={{ paddingTop: 12, paddingBottom: 14, alignItems: 'center' }}
            >
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.divider }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                {t('business.profile.hours')}
              </Text>
              <TouchableOpacity onPress={() => setShowHoursModal(false)}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Cross-reset rule reminder — shown UPFRONT (above the
                editors) so the merchant reads it before configuring
                and isn't surprised by the cross-03:30 error on save. */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 14, paddingHorizontal: 4 }}>
              <Clock size={12} color={theme.colors.muted} style={{ marginTop: 2 }} />
              <Text style={{ color: theme.colors.muted, ...theme.typography.caption, flex: 1, lineHeight: 15 }}>
                {t('business.availability.crossResetHint', {
                  defaultValue: 'Le créneau ne doit pas traverser 03:30 (réinitialisation quotidienne). Commencez ≥ 03:30 ou terminez ≤ 03:29.',
                })}
              </Text>
            </View>

            {/* Same for all days toggle */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                {t('business.baskets.sameAllDays')}
              </Text>
              <Switch
                value={sameAllDays}
                onValueChange={(v) => {
                  setSameAllDays(v);
                  if (v) setDayHours(Object.fromEntries(DAYS.map(d => [d, { start: hoursStart, end: hoursEnd, closed: false }])));
                }}
                trackColor={{ false: theme.colors.divider, true: theme.colors.primary + '60' }}
                thumbColor={sameAllDays ? theme.colors.primary : '#ccc'}
              />
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {sameAllDays ? (
                <View style={{ backgroundColor: theme.colors.bg, borderRadius: 12, padding: 16, gap: 16 }}>
                  <View>
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: 8 }}>{t('business.availability.startTime')}</Text>
                    <TimePicker value={hoursStart} onChange={setHoursStart} label={t('business.availability.startTime')} primaryColor={theme.colors.primary} textColor={theme.colors.textPrimary} bgColor={theme.colors.surface} mutedColor={theme.colors.muted} />
                  </View>
                  <View>
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: 8 }}>{t('business.availability.endTime')}</Text>
                    <TimePicker value={hoursEnd} onChange={(val) => {
                      const [h, m] = val.split(':').map(Number);
                      const mins = (h || 0) * 60 + (m || 0);
                      const startMins = (() => { const [sh, sm] = hoursStart.split(':').map(Number); return (sh || 0) * 60 + (sm || 0); })();
                      const MAX_END = 3 * 60 + 30; // 03:30
                      if (mins > MAX_END && mins < startMins) {
                        flashHoursEndWarning();
                        setHoursEnd('03:30');
                      } else {
                        setHoursEnd(val);
                      }
                    }} label={t('business.availability.endTime')} primaryColor={theme.colors.primary} textColor={theme.colors.textPrimary} bgColor={theme.colors.surface} mutedColor={theme.colors.muted} />
                    {hoursEndWarning && (
                      <Animated.Text style={{ color: theme.colors.error, ...theme.typography.caption, marginTop: 6, opacity: hoursEndWarningAnim }}>
                        {t('business.availability.maxEndTime', { defaultValue: "L'heure de fin ne peut pas dépasser 03:30 (réinitialisation quotidienne)" })}
                      </Animated.Text>
                    )}
                  </View>
                </View>
              ) : (
                DAYS.map(day => {
                  const dayState = dayHours[day] ?? { start: defaultStart, end: defaultEnd, closed: false };
                  const isClosed = !!dayState.closed;
                  return (
                    <View key={day} style={{ backgroundColor: theme.colors.bg, borderRadius: 12, padding: 12, marginBottom: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' }}>{DAY_LABELS[day]}</Text>
                        {/* Per-day "Fermé" pill. We use a Pressable here (not
                            TouchableOpacity) because on Android the latter
                            could grab the touch responder and prevent the
                            parent ScrollView from scrolling after the first
                            press — Pressable defers properly to the
                            scroll-responder ancestor. */}
                        <Pressable
                          onPress={() => setDayHours(prev => ({ ...prev, [day]: { ...dayState, closed: !isClosed } }))}
                          style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            paddingHorizontal: 10,
                            paddingVertical: 4,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: isClosed ? theme.colors.error : theme.colors.divider,
                            backgroundColor: isClosed ? theme.colors.error + '12' : 'transparent',
                            opacity: pressed ? 0.7 : 1,
                          })}
                        >
                          <View style={{
                            width: 8, height: 8, borderRadius: 4,
                            backgroundColor: isClosed ? theme.colors.error : theme.colors.muted,
                            marginRight: 6,
                          }} />
                          <Text style={{ color: isClosed ? theme.colors.error : theme.colors.textSecondary, fontSize: 11, fontFamily: 'Poppins_600SemiBold' }}>
                            {t('business.profile.closedDay', { defaultValue: 'Fermé' })}
                          </Text>
                        </Pressable>
                      </View>
                      {isClosed ? (
                        <Text style={{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_400Regular', fontStyle: 'italic' as const, paddingVertical: 6 }}>
                          {t('business.profile.closedAllDay', { defaultValue: 'Fermé toute la journée' })}
                        </Text>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ flex: 1 }}>
                            <TimePicker value={dayState.start ?? '09:00'} onChange={(v) => setDayHours(prev => ({ ...prev, [day]: { ...dayState, start: v } }))} primaryColor={theme.colors.primary} textColor={theme.colors.textPrimary} bgColor={theme.colors.surface} mutedColor={theme.colors.muted} />
                          </View>
                          <Text style={{ color: theme.colors.muted }}>à</Text>
                          <View style={{ flex: 1 }}>
                            <TimePicker value={dayState.end ?? '18:00'} onChange={(v) => setDayHours(prev => ({ ...prev, [day]: { ...dayState, end: v } }))} primaryColor={theme.colors.primary} textColor={theme.colors.textPrimary} bgColor={theme.colors.surface} mutedColor={theme.colors.muted} />
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </ScrollView>

            <TouchableOpacity
              onPress={handleSaveHours}
              disabled={hoursSaving}
              style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16, opacity: hoursSaving ? 0.5 : 1 }}
            >
              <Text style={{ color: '#fff', ...theme.typography.button }}>
                {hoursSaving ? t('common.loading') : t('common.save')}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {},
  content: {
    flex: 1,
  },
  coverSection: {
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: 140,
  },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  coverEditBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  profileCard: {},
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoWrap: {
    position: 'relative',
  },
  profileLogo: {
    width: 64,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoEditBtn: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfo: {
    flex: 1,
    marginLeft: 16,
  },
  infoCard: {},
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 120,
  },
  teamSection: {},
  teamHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  teamMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalInput: {
    height: 48,
    paddingHorizontal: 16,
  },
});
