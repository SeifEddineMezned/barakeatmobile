import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus, ShoppingBag, MapPin, Tag, Copy, Check } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMyBaskets, duplicateBasketToLocations, type BusinessBasketFromAPI } from '@/src/services/business';
import { fetchMyContext, fetchOrganizationDetails, type OrgDetailsFromAPI } from '@/src/services/teams';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { getErrorMessage } from '@/src/lib/api';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { SubScreenWalkthroughOverlay } from '@/src/components/SubScreenWalkthroughOverlay';

/**
 * Pick from existing org basket TYPES, or jump to the manual create flow.
 * Shown before `create-basket.tsx` when the user taps "+ Create basket"
 * from `my-baskets.tsx`.
 *
 * The list shows every UNIQUE basket type in the org (deduped by
 * name+price) — including types that already exist at the currently-
 * selected location. For each type we show a small location chip:
 *   - exactly one location → that location's name
 *   - several locations    → "{count} emplacements"
 * The right-hand CTA flips to "Déjà ici" (disabled) when the basket
 * type already exists at the currently-selected location, so the
 * merchant can't accidentally create a duplicate row.
 */
export default function SelectOrgBasketScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const alert = useCustomAlert();
  const queryClient = useQueryClient();
  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);

  // Org-wide list — fetchMyBaskets() with no arg returns every basket
  // across every location the user belongs to.
  const basketsQuery = useQuery({
    queryKey: ['my-baskets'],
    queryFn: () => fetchMyBaskets(),
    staleTime: 30_000,
  });

  // Need the org's location list so we can render location names
  // (basket rows only carry `location_id`, not the location name).
  const contextQuery = useQuery({
    queryKey: ['my-context'],
    queryFn: fetchMyContext,
    staleTime: 60_000,
  });
  const orgId = contextQuery.data?.organization_id;
  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgId],
    queryFn: () => fetchOrganizationDetails(orgId!),
    enabled: !!orgId,
    staleTime: 60_000,
  });
  const locationNameById = useMemo(() => {
    const map = new Map<number, string>();
    const locs = (orgDetailsQuery.data as OrgDetailsFromAPI | undefined)?.locations ?? [];
    for (const loc of locs) {
      if (loc?.id != null && loc?.name) map.set(Number(loc.id), loc.name);
    }
    return map;
  }, [orgDetailsQuery.data]);

  // Group baskets by `name|price` (the basket "type"), tracking every
  // location it appears in. We pick a single representative basket per
  // group — preferring one NOT at the current location so the
  // duplicate-to-current call doesn't try to clone a row onto itself.
  type GroupedBasket = {
    key: string;
    rep: BusinessBasketFromAPI;
    locationIds: Set<number>;
    name: string;
    price: number;
    image_url: string | null | undefined;
  };
  const groupedBaskets = useMemo<GroupedBasket[]>(() => {
    const byKey = new Map<string, GroupedBasket>();
    for (const b of basketsQuery.data ?? []) {
      if (b.status === 'deleted') continue;
      const name = (b.name ?? '').trim();
      if (!name) continue;
      const price = Number(b.selling_price ?? 0);
      const key = `${name.toLowerCase()}|${price}`;
      const locId = b.location_id != null ? Number(b.location_id) : null;
      const existing = byKey.get(key);
      if (existing) {
        if (locId != null) existing.locationIds.add(locId);
        // Upgrade the representative to one that's NOT at the current
        // location, so a later duplicate call has a useful source.
        if (
          selectedLocationId != null &&
          Number(existing.rep.location_id) === Number(selectedLocationId) &&
          locId != null && locId !== Number(selectedLocationId)
        ) {
          existing.rep = b;
        }
      } else {
        byKey.set(key, {
          key,
          rep: b,
          locationIds: new Set(locId != null ? [locId] : []),
          name,
          price,
          image_url: b.image_url ?? null,
        });
      }
    }
    return Array.from(byKey.values());
  }, [basketsQuery.data, selectedLocationId]);

  const [assigningKey, setAssigningKey] = useState<string | null>(null);

  const assignMutation = useMutation({
    mutationFn: async (group: GroupedBasket) => {
      if (!selectedLocationId) throw new Error('No location selected');
      return duplicateBasketToLocations(group.rep.id, [Number(selectedLocationId)]);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      void queryClient.invalidateQueries({ queryKey: ['business-stats'] });
      router.back();
    },
    onError: (err: any) => {
      alert.showAlert(t('common.error'), getErrorMessage(err));
      setAssigningKey(null);
    },
  });

  const handleAssign = (group: GroupedBasket) => {
    setAssigningKey(group.key);
    assignMutation.mutate(group);
  };

  const handleManualCreate = () => {
    router.replace('/business/create-basket' as never);
  };

  // ── Walkthrough wiring ── the business demo highlights the "reuse existing"
  // list (org-admins only) and the "Créer un nouveau" CTA on this pushed
  // screen. Publish their measured rects so SubScreenWalkthroughOverlay paints
  // the halo on top of this screen.
  const walkthroughActive = useWalkthroughStore((s) => s.step !== null);
  const walkthroughKey = useWalkthroughStore((s) => s.currentStep?.measureKey);
  const setMeasuredRect = useWalkthroughStore((s) => s.setMeasuredRect);
  const createNewRef = useRef<View | null>(null);
  // `existingListRef` is attached to ONE of two surfaces depending on whether
  // the org has any baskets to reuse:
  //   • baskets exist → attached to the first basket card. Halo highlights
  //     a representative card so the user understands they can reuse it.
  //   • baskets absent → attached to a wrapper around the "Paniers existants"
  //     subtitle + "Aucun panier..." empty-state block. Halo highlights the
  //     whole "nothing to reuse here yet" section so the demo step still
  //     teaches what this part of the page is FOR — even on a fresh org.
  // We don't skip the step in the empty-org case because the user explicitly
  // wants the demo to call out this section regardless.
  const existingListRef = useRef<View | null>(null);
  useEffect(() => {
    if (walkthroughKey !== 'selectOrgCreateNew' && walkthroughKey !== 'selectOrgExistingList') return;
    const ref = walkthroughKey === 'selectOrgCreateNew' ? createNewRef : existingListRef;
    const key = walkthroughKey;
    setMeasuredRect(key as any, null);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tryMeasure = (attempt: number) => {
      if (attempt > 8) return;
      if (useWalkthroughStore.getState().currentStep?.measureKey !== key) return;
      const node: any = ref.current;
      if (!node?.measureInWindow) { timers.push(setTimeout(() => tryMeasure(attempt + 1), 100)); return; }
      node.measureInWindow((x: number, y: number, w: number, h: number) => {
        if (w > 0 && h > 0) {
          // Give the "existing basket" card halo a touch more breathing room
          // (slightly bigger than flush) per design request.
          const pad = key === 'selectOrgExistingList' ? 8 : 0;
          setMeasuredRect(key as any, { x: Math.round(x - pad), y: Math.round(y - pad), w: Math.round(w + pad * 2), h: Math.round(h + pad * 2) });
          if (attempt < 3) timers.push(setTimeout(() => tryMeasure(attempt + 1), 200));
        } else {
          timers.push(setTimeout(() => tryMeasure(attempt + 1), 100));
        }
      });
    };
    timers.push(setTimeout(() => tryMeasure(0), 200));
    return () => { timers.forEach(clearTimeout); };
    // Re-measure when groupedBaskets.length crosses the "has-baskets vs
    // empty" boundary — the ref then points at a different surface
    // (first card vs the empty-state block) and the previously-published
    // rect would be stale.
  }, [walkthroughKey, setMeasuredRect, groupedBaskets.length]);

  if (basketsQuery.isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, minHeight: 48 }}>
        <TouchableOpacity
          // Locked during the walkthrough so a stray back-tap can't pop the
          // route and leave the demo overlay pointing at a screen that's
          // no longer mounted. `walkthroughActive` already exists above.
          onPress={walkthroughActive ? undefined : () => router.back()}
          disabled={walkthroughActive}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={{ position: 'absolute', left: theme.spacing.lg, top: theme.spacing.md, opacity: walkthroughActive ? 0.3 : 1 }}
        >
          <ArrowLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2 }} numberOfLines={1}>
          {t('business.createBasket.pickExistingTitle', { defaultValue: 'Ajouter un panier' })}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        {/* Manual create CTA — at the top so the user always sees it first. */}
        <TouchableOpacity
          ref={createNewRef as any}
          onPress={handleManualCreate}
          activeOpacity={0.85}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.colors.primary,
            borderRadius: theme.radii.r16,
            padding: theme.spacing.lg,
            marginTop: theme.spacing.sm,
            marginBottom: theme.spacing.lg,
          }}
        >
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#e3ff5c', alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={22} color="#114b3c" />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={{ color: '#fff', ...theme.typography.h3, fontFamily: 'Poppins_700Bold' }}>
              {t('business.createBasket.createManually', { defaultValue: 'Créer un nouveau panier' })}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.85)', ...theme.typography.caption, marginTop: 2, fontFamily: 'Poppins_400Regular' }}>
              {t('business.createBasket.createManuallyHint', { defaultValue: 'Remplir le formulaire à partir de zéro' })}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Section separator between the create-new CTA above and the
            existing-basket list / empty-state below. A thin divider plus a
            "Paniers existants" subtitle makes it obvious that the text
            below describes a different concept than the green CTA. Same
            chrome renders in BOTH branches so the page feels consistent
            whether the org has baskets or not.

            When the org has NO existing baskets, the wrapper around the
            subtitle + empty-state block becomes the walkthrough halo
            target (`existingListRef`). That way the demo step still
            teaches "this is the reuse-existing section" instead of
            painting a halo on empty space or having to skip the step. */}
        <View
          ref={groupedBaskets.length === 0 ? (existingListRef as any) : undefined}
          collapsable={false}
        >
          <View style={{ height: 1, backgroundColor: theme.colors.divider, marginBottom: theme.spacing.md }} />
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, fontWeight: '700' as const, fontFamily: 'Poppins_700Bold', marginBottom: 12 }}>
            {t('business.createBasket.existingSectionTitle', { defaultValue: 'Paniers existants' })}
          </Text>

        {groupedBaskets.length > 0 ? (
          <View>
            {/* Heading sits OUTSIDE the measured wrapper — the walkthrough
                halo only needs to highlight one representative basket card
                so the user "gets" the reuse-existing concept. Pre-fix the
                ref wrapped heading + ALL cards, which produced a halo so
                tall it spanned the whole list and read as misplaced
                ("way off") instead of pointing at the relevant element. */}
            <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginBottom: 10 }}>
              {t('business.createBasket.orPickExisting', { defaultValue: 'Ou choisissez un panier existant' })}
            </Text>
            {groupedBaskets.map((group, idx) => {
              const isPending = assigningKey === group.key;
              const alreadyHere = selectedLocationId != null && group.locationIds.has(Number(selectedLocationId));
              const locationCount = group.locationIds.size;
              // Chip text: one location → its name, several → "N emplacements".
              // Falls back to "Sans emplacement" if we somehow lack any.
              let locationChipLabel: string;
              if (locationCount === 0) {
                locationChipLabel = t('business.createBasket.noLocationChip', { defaultValue: 'Sans emplacement' });
              } else if (locationCount === 1) {
                const [onlyId] = Array.from(group.locationIds);
                locationChipLabel = locationNameById.get(onlyId) ?? t('business.createBasket.oneLocationChip', { defaultValue: '1 emplacement' });
              } else {
                locationChipLabel = t('business.createBasket.manyLocationsChip', { count: locationCount, defaultValue: `${locationCount} emplacements` });
              }
              return (
                <TouchableOpacity
                  key={group.key}
                  // Only the first card is the walkthrough halo target — see
                  // the comment above the heading for why.
                  ref={idx === 0 ? (existingListRef as any) : undefined}
                  // Inert during the walkthrough so the demo can highlight a
                  // card without firing a real duplicate.
                  onPress={() => { if (!alreadyHere && !walkthroughActive) handleAssign(group); }}
                  disabled={alreadyHere || isPending || assignMutation.isPending || walkthroughActive}
                  activeOpacity={alreadyHere ? 1 : 0.85}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r12,
                    padding: theme.spacing.md,
                    marginBottom: 10,
                    borderWidth: 1,
                    borderColor: theme.colors.divider,
                    // Fade out baskets that can't be added (already at this
                    // location) so the "addable" ones stand out; the "Déjà ici"
                    // badge stays as the explicit reason.
                    opacity: alreadyHere ? 0.45 : (isPending ? 0.6 : 1),
                  }}
                >
                  {group.image_url ? (
                    <Image source={{ uri: group.image_url }} style={{ width: 56, height: 56, borderRadius: theme.radii.r12 }} />
                  ) : (
                    <View style={{ width: 56, height: 56, borderRadius: theme.radii.r12, backgroundColor: theme.colors.primary + '15', alignItems: 'center', justifyContent: 'center' }}>
                      <ShoppingBag size={22} color={theme.colors.primary} />
                    </View>
                  )}
                  <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontFamily: 'Poppins_600SemiBold' }} numberOfLines={1}>
                      {group.name}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 10, flexWrap: 'wrap' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Tag size={11} color={theme.colors.primary} />
                        <Text style={{ color: theme.colors.primary, ...theme.typography.caption, fontFamily: 'Poppins_600SemiBold', marginLeft: 4 }}>
                          {group.price.toFixed(2)} {t('common.currency', { defaultValue: 'TND' })}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0, flexShrink: 1 }}>
                        <MapPin size={11} color={theme.colors.muted} />
                        <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginLeft: 4 }} numberOfLines={1}>
                          {locationChipLabel}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {isPending ? (
                    <ActivityIndicator color={theme.colors.primary} />
                  ) : alreadyHere ? (
                    <View style={{ backgroundColor: theme.colors.muted + '20', borderRadius: theme.radii.pill, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Check size={11} color={theme.colors.textSecondary} />
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, fontFamily: 'Poppins_600SemiBold' }}>
                        {t('business.createBasket.alreadyHere', { defaultValue: 'Déjà ici' })}
                      </Text>
                    </View>
                  ) : (
                    <View style={{ backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.pill, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Copy size={11} color={theme.colors.primary} />
                      <Text style={{ color: theme.colors.primary, ...theme.typography.caption, fontFamily: 'Poppins_600SemiBold' }}>
                        {t('business.createBasket.useThis', { defaultValue: 'Utiliser' })}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: theme.spacing.xl }}>
            <ShoppingBag size={32} color={theme.colors.muted} />
            <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, marginTop: 10, textAlign: 'center', lineHeight: 20 }}>
              {t('business.createBasket.noOrgBaskets', { defaultValue: 'Aucun panier dans votre organisation pour le moment.' })}
            </Text>
          </View>
        )}
        </View>
      </ScrollView>
      <SubScreenWalkthroughOverlay keys={['selectOrgExistingList', 'selectOrgCreateNew']} />
    </SafeAreaView>
  );
}
