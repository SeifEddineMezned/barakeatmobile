/**
 * First-login onboarding for OAuth users (Apple / Google).
 *
 * Triggered by sign-in.tsx when the backend's /auth/apple or /auth/google
 * response returns `genderStepCompleted: false`. A single, skippable step:
 *
 *   Gender picker — same "man / woman holding basket" cards used in the
 *   standard buyer sign-up flow. Reusing the visual so the OAuth
 *   first-login feels like a continuation of the same registration, not a
 *   separate detour. Skippable; defaults the avatar to the male silhouette
 *   when skipped (per product decision).
 *
 * There is intentionally NO name step: a real name is captured at the
 * OAuth source — Google always returns it, and Apple returns it on the
 * first-ever authorization (the only chance the app ever gets it). If
 * Apple withholds it the user keeps a placeholder name and can rename
 * themselves later in profile.
 *
 * On finish (gender picked or skipped) we PUT /api/auth/me/onboarding so
 * the server flips `gender_step_completed = true`, then run the EXACT same
 * first-run handoff the email-signup flow uses (verify-email.tsx): trigger
 * the loading splash, mark this as a pending first run so the root layout
 * mounts the welcome carousel UNDER the splash, and defer flipping the local
 * gender flag until the splash animation finishes. That makes Google/Apple
 * first login identical to email: gender → loading animation → onboarding
 * slides, with NO intermediary "welcome" page and NO app sneak-peek.
 *
 * Routing model: this screen is registered on the auth stack and reached by
 * sign-in.tsx (which signs the user in, then router.replace's here). The
 * routing guard in _layout.tsx HOLDS the user on /auth/onboarding while
 * `genderStepCompleted === false`; once finish() flips it true (at the end of
 * the splash animation) the guard navigates to the role home — under the
 * already-mounted carousel. A JS refresh / process kill mid-onboarding leaves
 * the user signed in and lands them back here on the next launch.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { useSplashStore } from '@/src/stores/splashStore';
import { updateOnboardingProfile } from '@/src/services/auth';
import { useCustomAlert } from '@/src/components/CustomAlert';

// Sentinel avatar tokens — the silhouette images live in the same
// /assets/images bundle as the sign-up gender cards. We store the
// shorthand (`silhouette://male` / `silhouette://female`) on the user
// row so the profile screen can resolve them locally to the bundled
// asset without a network request, while still leaving the field
// compatible with a future "real photo" override.
const AVATAR_MALE = 'silhouette://male';
const AVATAR_FEMALE = 'silhouette://female';

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const alert = useCustomAlert();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [gender, setGender] = useState<'male' | 'female' | null>(
    (user?.gender as 'male' | 'female' | null) ?? null,
  );
  const [saving, setSaving] = useState(false);

  // Final submit. Idempotent — if the user re-lands here for any reason
  // the second call just no-ops on the server side. We patch the auth
  // store with the returned row so the UI elsewhere (profile, etc.) sees
  // the new values without waiting for a re-fetch.
  //
  // Name is NOT collected here: a real name is captured at the OAuth source
  // — Google always returns it, and Apple returns it on the first-ever
  // authorization (the only time the app can get it). The standalone name
  // step was removed; users can still rename themselves in profile if Apple
  // ever withholds it.
  const finish = async (picked: 'male' | 'female' | null) => {
    setSaving(true);
    try {
      const avatar = picked === 'female' ? AVATAR_FEMALE : AVATAR_MALE;
      const res = await updateOnboardingProfile({
        gender: picked,
        // Let the server keep the existing stored name (Google/Apple value).
        avatar,
      });
      // Make OAuth (Google/Apple) first login IDENTICAL to the email-signup
      // first run: play the loading splash, mount the welcome carousel UNDER
      // it, and flip the gender flag ONLY when the animation finishes. That
      // removes both the extra "Bienvenue {name}" page AND the app "sneak peek"
      // (the old router.replace('/(tabs)') mounted the home tree before the
      // carousel could cover it). The routing guard — gated on
      // genderStepCompleted + splashAnimDone — navigates into the app once the
      // flag flips, with the carousel already covering the screen.
      const finalize = () => {
        if (user) {
          setUser({
            ...user,
            name: res.user?.name || user.name,
            // User.gender is typed as string | undefined (NOT nullable),
            // so coerce the server's nullable value through undefined.
            gender: res.user?.gender ?? picked ?? undefined,
            avatar: res.user?.avatar ?? avatar,
            // Mark ONLY the gender step done — leave onboardingCompleted as-is
            // (still false) so landing in the app triggers the welcome carousel
            // / demo / address prompt. Releasing the routing guard's hold.
            genderStepCompleted: (res.user as any)?.genderStepCompleted ?? true,
          });
        }
      };
      // Front-run the server onboarding probe: tell the root layout this is a
      // first run so it mounts the carousel the instant the splash tears down
      // (no home-screen flash) — the same flag verify-email sets.
      useWalkthroughStore.getState().setPendingFirstRun(true);
      // triggerSplash() RESETS pendingAnimFinish, so register the callback
      // AFTER it (mirrors sign-in.tsx / verify-email.tsx ordering).
      useSplashStore.getState().triggerSplash();
      useSplashStore.getState().setPendingAnimFinish(finalize);
      // NO router.replace here — navigation is LEFT to the routing guard, which
      // fires after the splash animation once genderStepCompleted flips true.
    } catch (err: any) {
      console.error('[Onboarding] Save failed:', err?.status, err?.message, JSON.stringify(err?.data));
      alert.showAlert(
        t('common.error'),
        t('errors.serverUnavailable', { defaultValue: 'Le serveur ne répond pas. Veuillez actualiser l’application puis réessayer.' }),
      );
      setSaving(false);
    }
  };

  const handleGenderPick = (picked: 'male' | 'female' | null) => {
    setGender(picked);
    // Go straight to finish — NO intermediary welcome page. The "welcome to
    // Barakeat" beat lives as the first slide of the onboarding carousel
    // (exactly like the email-signup flow), not as a separate screen here.
    void finish(picked);
  };

  // ── Gender picker (the only onboarding step) ─────────────────────────
  const genderCard = (value: 'male' | 'female', img: any, label: string) => {
    const selected = gender === value;
    return (
      <TouchableOpacity
        onPress={() => handleGenderPick(value)}
        activeOpacity={0.85}
        disabled={saving}
        style={{
          flex: 1,
          backgroundColor: selected ? '#114b3c12' : '#fff',
          borderWidth: 2,
          borderColor: selected ? '#114b3c' : '#114b3c20',
          borderRadius: 20,
          paddingVertical: theme.spacing.lg,
          paddingHorizontal: theme.spacing.md,
          alignItems: 'center',
        }}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
      >
        <Image source={img} style={{ width: '100%', height: 150 }} resizeMode="contain" />
        <Text style={{ color: '#114b3c', ...theme.typography.body, fontWeight: '700' as const, marginTop: theme.spacing.sm }}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fffff8' }}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ flex: 1, padding: theme.spacing.xxl, justifyContent: 'center' }}>
          <Text style={{ color: '#114b3c', ...theme.typography.h1, marginBottom: theme.spacing.sm }}>
            {t('auth.genderTitle', { defaultValue: 'Vous êtes ?' })}
          </Text>
          <Text style={{ color: '#114b3c80', ...theme.typography.body, marginBottom: theme.spacing.xxl }}>
            {t('auth.genderSubtitle', { defaultValue: 'Cela nous aide à personnaliser votre expérience. Vous pouvez passer cette étape.' })}
          </Text>

          <View style={{ flexDirection: 'row', gap: theme.spacing.lg, marginBottom: theme.spacing.xl }}>
            {genderCard('male', require('@/assets/images/man_holding_basket-removebg-preview.png'), t('auth.genderMale', { defaultValue: 'Homme' }))}
            {genderCard('female', require('@/assets/images/woman_holding_basket-removebg-preview.png'), t('auth.genderFemale', { defaultValue: 'Femme' }))}
          </View>

          {saving ? (
            <View style={{ height: 48, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color="#114b3c" />
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => handleGenderPick(null)}
              style={{ height: 48, justifyContent: 'center', alignItems: 'center' }}
              accessibilityLabel={t('common.skip', { defaultValue: 'Skip' })}
              accessibilityRole="button"
            >
              <Text style={{ color: '#114b3c', ...theme.typography.body, fontWeight: '600' as const, textDecorationLine: 'underline' as const }}>
                {t('common.skip', { defaultValue: 'Skip' })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
