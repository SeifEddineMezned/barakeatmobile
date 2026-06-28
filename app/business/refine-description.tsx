import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Check, AlertCircle, AlertTriangle, Info, ChevronDown, ChevronUp } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '@/src/theme/ThemeProvider';
import { apiClient, getErrorMessage } from '@/src/lib/api';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { useAiRefineStore, type RefineTrio } from '@/src/stores/aiRefineStore';

type Phase = 'loading' | 'question' | 'preview' | 'error';

// Full-screen interactive refinement of a basket description. The create-basket
// form hands the starting text via the aiRefine store; this page runs the Q&A
// loop (one question at a time), then a preview, and hands the accepted
// {fr,en,ar} trio back through the store. Built as a page (not a modal) so the
// answer field + keyboard don't push content off-screen.
export default function RefineDescriptionScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const alert = useCustomAlert();

  const input = useAiRefineStore((s) => s.input);
  const setResult = useAiRefineStore((s) => s.setResult);

  const previewLang: 'fr' | 'en' | 'ar' = (() => {
    const code = (i18n.language || 'fr').slice(0, 2);
    return code === 'en' || code === 'ar' ? code : 'fr';
  })();
  const translatedLangsLabel = ['FR', 'EN', ...(FeatureFlags.LANGUAGES_AR_ENABLED ? ['AR'] : [])].join(' · ');

  const [phase, setPhase] = useState<Phase>('loading');
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(input?.description ?? '');
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<{ question: string; answer: string }[]>([]);
  const [answer, setAnswer] = useState('');
  const [trio, setTrio] = useState<RefineTrio | null>(null);
  const [errorInfo, setErrorInfo] = useState<{ title: string; message: string; isLimit: boolean } | null>(null);
  // The current question's answer UI: a free-text box, or a min–max number pair.
  const [qType, setQType] = useState<'text' | 'number_range'>('text');
  const [qUnit, setQUnit] = useState('');
  const [minVal, setMinVal] = useState('');
  const [maxVal, setMaxVal] = useState('');
  // The "Comment ça marche ?" helper collapses behind its info icon.
  const [introExpanded, setIntroExpanded] = useState(true);
  // The AI warning box — collapsed by default, showing only the disclaimer line.
  const [warningExpanded, setWarningExpanded] = useState(false);

  type RefineResponse = { done: boolean; question?: string; inputType?: string; unit?: string; description?: string; fr?: string; en?: string; ar?: string };

  // Move into the question phase for a fresh question, resetting the answer UI.
  // The server returns a progressively-rewritten `description` each round, so the
  // "Description actuelle" box shows a polished running version (not raw answers).
  const applyQuestion = (data: RefineResponse) => {
    if (typeof data.description === 'string' && data.description.trim()) setWorking(data.description.trim());
    setQuestion(data.question || '');
    setQType(data.inputType === 'number_range' ? 'number_range' : 'text');
    setQUnit(typeof data.unit === 'string' ? data.unit : '');
    setAnswer('');
    setMinVal('');
    setMaxVal('');
    setPhase('question');
  };

  // Compose the answer string from whichever input mode is active.
  const buildAnswer = () => {
    if (qType === 'number_range') {
      const mn = minVal.trim();
      const mx = maxVal.trim();
      const suffix = qUnit ? ` ${qUnit}` : '';
      if (mn && mx) return `${mn} - ${mx}${suffix}`;
      const one = mn || mx;
      return one ? `${one}${suffix}` : '';
    }
    return answer.trim();
  };

  const hasAnswer = qType === 'number_range'
    ? (minVal.trim() !== '' && maxVal.trim() !== '')
    : answer.trim() !== '';

  // Build a user-facing title/message for an error. The daily-cap (429) gets a
  // dedicated "limite atteinte" message, surfaced from the server when present.
  const buildError = (err: any): { title: string; message: string; isLimit: boolean } => {
    if (err?.response?.status === 429) {
      return {
        title: t('business.createBasket.aiLimitTitle', { defaultValue: 'Limite atteinte' }),
        message: err?.response?.data?.message
          || t('business.createBasket.aiLimitBody', { defaultValue: "Vous avez atteint votre limite de suggestions IA pour aujourd'hui. Réessayez demain." }),
        isLimit: true,
      };
    }
    return { title: t('common.error', { defaultValue: 'Erreur' }), message: getErrorMessage(err), isLimit: false };
  };

  // The server always rebuilds from the ORIGINAL description + the full answer
  // history, so we send those (not the running rewrite) — that avoids
  // double-counting answers. `language` forces the question + rewrite language;
  // `title` gives the model basket-specific context for tailored questions.
  const callRefine = async (hist: { question: string; answer: string }[], finalize = false) => {
    const res = await apiClient.post('/api/baskets/ai-refine', {
      description: input?.description ?? '',
      title: input?.title,
      category: input?.category,
      language: i18n.language,
      history: hist,
      finalize,
    });
    return res.data as RefineResponse;
  };

  // Kick off the first round on mount. No input → nothing to do, go back.
  useEffect(() => {
    if (!input?.description) { router.back(); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await callRefine([]);
        if (cancelled) return;
        if (data.done) {
          setTrio({ fr: data.fr || input.description, en: data.en || input.description, ar: data.ar || input.description });
          setPhase('preview');
        } else {
          applyQuestion(data);
        }
      } catch (err) {
        if (cancelled) return;
        setErrorInfo(buildError(err));
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitAnswer = async (finalize: boolean) => {
    const ans = buildAnswer();
    const newHistory = ans ? [...history, { question, answer: ans }] : history;
    setBusy(true);
    try {
      const data = await callRefine(newHistory, finalize);
      setHistory(newHistory);
      if (data.done) {
        setTrio({ fr: data.fr || working, en: data.en || working, ar: data.ar || working });
        setPhase('preview');
      } else {
        applyQuestion(data);
      }
    } catch (err: any) {
      // Daily cap → dedicated full-screen "limite atteinte" (they can't
      // continue anyway). Other errors → inline alert so they can retry the
      // same answer without losing their progress.
      if (err?.response?.status === 429) {
        setErrorInfo(buildError(err));
        setPhase('error');
      } else {
        const e = buildError(err);
        alert.showAlert(e.title, e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const accept = () => {
    if (trio) setResult(trio);
    router.back();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <StatusBar style="dark" />
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, minHeight: 56 }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} style={{ position: 'absolute', left: 16 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text pointerEvents="none" style={{ color: theme.colors.textPrimary, ...theme.typography.h2, fontFamily: 'Poppins_600SemiBold' }}>
          {t('business.createBasket.aiRefineTitle', { defaultValue: 'Affiner la description' })}
        </Text>
      </View>

      {phase === 'loading' ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>
            {t('business.createBasket.aiRefineLoading', { defaultValue: 'Analyse de votre description…' })}
          </Text>
        </View>
      ) : phase === 'error' ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: 14 }}>
          <View style={{ backgroundColor: '#e3ff5c22', width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center' }}>
            <AlertCircle size={32} color="#b8a600" />
          </View>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontFamily: 'Poppins_700Bold', textAlign: 'center' }}>
            {errorInfo?.title}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 15, lineHeight: 22, fontFamily: 'Poppins_400Regular', textAlign: 'center' }}>
            {errorInfo?.message}
          </Text>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center', marginTop: 8 }}
          >
            <Text style={{ color: '#fff', ...theme.typography.body, fontFamily: 'Poppins_600SemiBold' }}>
              {t('common.back', { defaultValue: 'Retour' })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {/* AI warning box — collapsible, collapsed by default (only the
                disclaimer line shows; the beta note expands on tap). */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setWarningExpanded((v) => !v)}
              style={{ backgroundColor: '#e3ff5c22', borderRadius: 14, padding: 14, marginBottom: 16 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <AlertTriangle size={18} color="#b8a600" style={{ marginRight: 10 }} />
                <Text style={{ color: theme.colors.textPrimary, fontSize: 13, lineHeight: 19, fontFamily: 'Poppins_500Medium', flex: 1 }}>
                  {t('business.createBasket.aiDisclaimer', { defaultValue: 'Les suggestions sont générées par IA — vérifiez-les avant de publier.' })}
                </Text>
                {warningExpanded
                  ? <ChevronUp size={18} color="#b8a600" />
                  : <ChevronDown size={18} color="#b8a600" />}
              </View>
              {warningExpanded && (
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18, fontFamily: 'Poppins_400Regular', marginTop: 8, marginLeft: 28 }}>
                  {t('business.createBasket.aiBetaNote', { defaultValue: "Nouvelle fonctionnalité, encore en cours d'amélioration — le résultat peut nécessiter des ajustements." })}
                </Text>
              )}
            </TouchableOpacity>

            {/* Working description so far */}
            <Text style={{ color: theme.colors.primary, fontSize: 13, fontFamily: 'Poppins_700Bold', marginBottom: 6 }}>
              {t('business.createBasket.aiRefineCurrent', { defaultValue: 'Description actuelle' })}
            </Text>
            <View style={{ backgroundColor: theme.colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.divider, marginBottom: 24, ...theme.shadows.shadowSm }}>
              <Text style={{ color: theme.colors.textPrimary, fontSize: 16, lineHeight: 24, fontFamily: 'Poppins_400Regular' }}>
                {phase === 'preview' && trio ? trio[previewLang] : working}
              </Text>
            </View>

            {phase === 'question' ? (
              <>
                {/* Intro explainer — collapsible behind its info icon, between
                    the current description and the question. */}
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setIntroExpanded((v) => !v)}
                  style={{ backgroundColor: theme.colors.primary + '12', borderRadius: 14, padding: 14, marginBottom: 22 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Info size={16} color={theme.colors.primary} style={{ marginRight: 8 }} />
                    <Text style={{ color: theme.colors.primary, fontSize: 13, fontFamily: 'Poppins_600SemiBold', flex: 1 }}>
                      {t('business.createBasket.aiRefineIntroLabel', { defaultValue: 'Comment ça marche ?' })}
                    </Text>
                    {introExpanded
                      ? <ChevronUp size={18} color={theme.colors.primary} />
                      : <ChevronDown size={18} color={theme.colors.primary} />}
                  </View>
                  {introExpanded && (
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, fontFamily: 'Poppins_400Regular', marginTop: 10 }}>
                      {t('business.createBasket.aiRefineIntro', { defaultValue: "Répondez aux questions pour rendre votre description plus complète, ou appuyez sur « C'est bon, terminer » si elle vous convient déjà." })}
                    </Text>
                  )}
                </TouchableOpacity>

                <Text style={{ color: theme.colors.primary, fontSize: 13, fontFamily: 'Poppins_700Bold', marginBottom: 8 }}>
                  {t('business.createBasket.aiRefineStep', { defaultValue: 'Question {{n}}', n: history.length + 1 })}
                </Text>
                <Text style={{ color: theme.colors.textPrimary, fontSize: 16, lineHeight: 24, fontFamily: 'Poppins_400Regular', marginBottom: 18 }}>
                  {question}
                </Text>
                {qType === 'number_range' ? (
                  // Min–max pair for "approximately how many …" style questions.
                  <View>
                    {!!qUnit && (
                      <Text style={{ color: theme.colors.muted, ...theme.typography.caption, fontFamily: 'Poppins_400Regular', marginBottom: 8 }}>
                        {qUnit}
                      </Text>
                    )}
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, fontFamily: 'Poppins_500Medium', marginBottom: 4 }}>
                          {t('business.createBasket.aiRefineMin', { defaultValue: 'Min' })}
                        </Text>
                        <TextInput
                          style={{ backgroundColor: theme.colors.surface, borderColor: minVal.trim() ? theme.colors.primary : theme.colors.divider, borderWidth: 1.5, borderRadius: 14, color: theme.colors.textPrimary, ...theme.typography.body, padding: 14 }}
                          value={minVal}
                          onChangeText={(v) => setMinVal(v.replace(/[^0-9]/g, ''))}
                          placeholder="0"
                          placeholderTextColor={theme.colors.muted}
                          keyboardType="number-pad"
                          editable={!busy}
                          autoFocus
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, fontFamily: 'Poppins_500Medium', marginBottom: 4 }}>
                          {t('business.createBasket.aiRefineMax', { defaultValue: 'Max' })}
                        </Text>
                        <TextInput
                          style={{ backgroundColor: theme.colors.surface, borderColor: maxVal.trim() ? theme.colors.primary : theme.colors.divider, borderWidth: 1.5, borderRadius: 14, color: theme.colors.textPrimary, ...theme.typography.body, padding: 14 }}
                          value={maxVal}
                          onChangeText={(v) => setMaxVal(v.replace(/[^0-9]/g, ''))}
                          placeholder="0"
                          placeholderTextColor={theme.colors.muted}
                          keyboardType="number-pad"
                          editable={!busy}
                        />
                      </View>
                    </View>
                  </View>
                ) : (
                  <TextInput
                    style={{ backgroundColor: theme.colors.surface, borderColor: answer.trim() ? theme.colors.primary : theme.colors.divider, borderWidth: 1.5, borderRadius: 14, color: theme.colors.textPrimary, ...theme.typography.body, minHeight: 90, padding: 14, textAlignVertical: 'top' }}
                    value={answer}
                    onChangeText={setAnswer}
                    placeholder={t('business.createBasket.aiRefineAnswerPlaceholder', { defaultValue: 'Votre réponse…' })}
                    placeholderTextColor={theme.colors.muted}
                    multiline
                    editable={!busy}
                    autoFocus
                  />
                )}

                {qType === 'text' && (
                  <Text style={{ color: theme.colors.muted, ...theme.typography.caption, fontFamily: 'Poppins_400Regular', marginTop: 6 }}>
                    {t('business.createBasket.aiRefineSkipHint', { defaultValue: "Si vous n'avez pas de réponse, tapez « passer »." })}
                  </Text>
                )}

                <TouchableOpacity
                  onPress={() => submitAnswer(false)}
                  disabled={busy || !hasAnswer}
                  style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 20, opacity: (busy || !hasAnswer) ? 0.45 : 1 }}
                >
                  {busy ? <ActivityIndicator size="small" color="#fff" /> : (
                    <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '700' as const }}>
                      {t('business.createBasket.aiRefineNext', { defaultValue: 'Continuer' })}
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => submitAnswer(true)}
                  disabled={busy}
                  style={{ alignItems: 'center', marginTop: 16, opacity: busy ? 0.5 : 1 }}
                >
                  <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '700' as const }}>
                    {t('business.createBasket.aiRefineFinish', { defaultValue: "C'est bon, terminer" })}
                  </Text>
                  <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 2 }}>
                    {t('business.createBasket.aiRefineFinishHint', { defaultValue: 'Utiliser la description telle quelle' })}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              // ── Preview phase ───────────────────────────────────────────────
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                  <Check size={18} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>
                    {FeatureFlags.LANGUAGES_AR_ENABLED
                      ? t('business.createBasket.aiPreviewSubtitle', { defaultValue: 'Version améliorée, traduite automatiquement en français, anglais et arabe :' })
                      : t('business.createBasket.aiPreviewSubtitleNoAr', { defaultValue: 'Version améliorée, traduite automatiquement en français et anglais :' })}
                  </Text>
                </View>
                <View style={{ marginBottom: 4 }} />

                <TouchableOpacity
                  onPress={accept}
                  style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '700' as const }}>
                    {t('business.createBasket.aiUse', { defaultValue: 'Utiliser' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.back()}
                  style={{ alignItems: 'center', marginTop: 16 }}
                >
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, fontWeight: '600' as const }}>
                    {t('business.createBasket.aiKeepMine', { defaultValue: 'Garder mon texte' })}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
