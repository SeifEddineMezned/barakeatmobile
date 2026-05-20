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

const FAQ_DATA_FR: FAQCategory[] = [
  {
    title: 'Général', icon: Info,
    items: [
      { q: "C'est quoi exactement un « panier surprise » ?", a: "Le « panier surprise » est un lot qui contient divers produits d'un commerce alimentaire (boulangerie, restaurant, café…). Mais quoi exactement ? Surprise…" },
      { q: "Pourquoi lancer ce concept en Tunisie ?", a: "Le gaspillage alimentaire coûte plus de 500 millions de dinars par an à la population tunisienne. Alors vous économisez de l'argent et en retour, vous sauvez la planète !" },
      { q: "Dans quelle région est disponible Barakeat ?", a: "Actuellement, Barakeat est disponible dans toutes les villes du Grand Tunis. Nous vous tiendrons au courant de notre arrivée dans les autres régions." },
      { q: "Est-ce que je vais vraiment aider à la lutte contre le gaspillage alimentaire ?", a: "Oui, massivement ! Chaque panier sauvé évite que des ressources précieuses ne finissent à la poubelle. Chaque geste compte !" },
    ],
  },
  {
    title: 'Commandes', icon: ShoppingBag,
    items: [
      { q: "Est-ce que je sais ce qu'il y a dans mon « panier surprise » ?", a: "C'est une surprise ! Mais bien que vous ne connaissiez pas la liste exacte des articles à l'avance, vous êtes garanti de recevoir les produits du commerce en question !" },
      { q: "Pourquoi je ne sais pas ce qu'il y a dans le « panier surprise » ?", a: "Parce qu'il s'agit d'invendus du jour. Les commerces ne peuvent pas prédire ce qu'il leur reste et vous promettre un contenu spécifique." },
      { q: "Est-ce que la nourriture que je reçois est encore bonne ?", a: "Absolument ! Les produits proposés sont ceux du jour même, frais, et parfaitement propres à la consommation." },
      { q: "Comment fonctionne le retrait ?", a: "Après avoir réservé un panier, vous recevez un code de retrait. Rendez-vous au commerce pendant le créneau indiqué, présentez votre code, payez et repartez avec votre panier !" },
      { q: "Puis-je annuler ma commande ?", a: "Oui, vous pouvez annuler avant le début du créneau de retrait. Les annulations tardives peuvent affecter votre compte." },
    ],
  },
  {
    title: 'Paiement', icon: CreditCard,
    items: [
      { q: "Comment je paie ?", a: "Le paiement se fait directement au commerçant lors du retrait. Espèces acceptées partout." },
      { q: "Qu'est-ce que les crédits Barakeat ?", a: "Ce sont des crédits que vous gagnez en parrainant des amis ou via des codes cadeaux. Ils peuvent être utilisés pour réduire le prix de vos prochains paniers." },
    ],
  },
  {
    title: 'Commerçants', icon: Store,
    items: [
      { q: "Comment devenir commerçant partenaire ?", a: "Inscrivez-vous directement sur l'application en tant que commerçant ou contactez-nous à contact@barakeat.tn. L'inscription est gratuite !" },
      { q: "Comment je gère mes paniers ?", a: "Depuis votre tableau de bord commerçant, vous pouvez créer des paniers, définir les prix et quantités, et suivre les réservations en temps réel." },
    ],
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
        {FAQ_DATA_FR.map((cat, ci) => {
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
