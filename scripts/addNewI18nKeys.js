// One-shot helper: adds the new i18n keys introduced in this round of fixes
// to en/fr/ar locale files. Idempotent — re-running just no-ops for keys
// already present, so it's safe to run after a partial application.
//
// Usage:  node scripts/addNewI18nKeys.js

const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', 'src', 'i18n', 'locales');

// Each entry: dotted-key → { en, fr, ar }
const ADDITIONS = {
  'common.warning': {
    en: 'Warning', fr: 'Avertissement', ar: 'تحذير',
  },
  'auth.businessMustUseEmail': {
    en: 'Merchants sign in with email only.',
    fr: 'Les commerçants se connectent uniquement par email.',
    ar: 'يسجل التجار الدخول عن طريق البريد الإلكتروني فقط.',
  },
  'addressPicker.detectedLabel': {
    en: 'Detected address', fr: 'Adresse détectée', ar: 'العنوان المكتشف',
  },
  'addressPicker.useDetected': {
    en: 'Use', fr: 'Utiliser', ar: 'استخدام',
  },
  'basket.pickupInstructionsCollapse': {
    en: 'Collapse', fr: 'Réduire', ar: 'طي',
  },
  'basket.pickupInstructionsExpand': {
    en: '… Read more', fr: '… Lire plus', ar: '… اقرأ المزيد',
  },
  'basket.pickupInstructionsTapToExpand': {
    en: 'Tap to read', fr: 'Toucher pour lire', ar: 'اضغط للقراءة',
  },
  'basket.dietary.vegan': { en: 'Vegan', fr: 'Végan', ar: 'نباتي صرف' },
  'basket.dietary.vegetarian': { en: 'Vegetarian', fr: 'Végétarien', ar: 'نباتي' },
  'basket.dietary.halal': { en: 'Halal', fr: 'Halal', ar: 'حلال' },
  'basket.dietary.gluten_free': { en: 'Gluten-free', fr: 'Sans gluten', ar: 'خالٍ من الغلوتين' },
  'basket.dietary.dairy_free': { en: 'Dairy-free', fr: 'Sans lactose', ar: 'خالٍ من الألبان' },
  'basket.dietary.organic': { en: 'Organic', fr: 'Bio', ar: 'عضوي' },
  'reserve.basketsCount': {
    en: '× {{count}} basket(s)', fr: '× {{count}} panier(s)', ar: '× {{count}} كيس',
  },
  'reserve.subtotal': {
    en: 'Subtotal', fr: 'Sous-total', ar: 'المجموع الفرعي',
  },
  'business.profile.closedDay': {
    en: 'Closed', fr: 'Fermé', ar: 'مغلق',
  },
  'business.profile.closedAllDay': {
    en: 'Closed all day',
    fr: 'Fermé toute la journée',
    ar: 'مغلق طوال اليوم',
  },
  'business.availability.openAllDay': {
    en: 'Open all day',
    fr: 'Ouvert toute la journée',
    ar: 'مفتوح طوال اليوم',
  },
  'business.availability.invalidWindow': {
    en: 'End time must be after start time. For open all day, choose 03:30 → 03:29.',
    fr: "L'heure de fin doit être après l'heure de début. Pour ouvrir toute la journée, choisissez 03:30 → 03:29.",
    ar: 'يجب أن يكون وقت الانتهاء بعد وقت البدء. للفتح طوال اليوم، اختر 03:30 ← 03:29.',
  },
  'business.availability.invalidTimeFormat': {
    en: 'Invalid time format.',
    fr: 'Format d\'heure invalide.',
    ar: 'تنسيق وقت غير صالح.',
  },
  'business.availability.allDaysClosed': {
    en: 'At least one day must remain open.',
    fr: 'Au moins un jour doit rester ouvert.',
    ar: 'يجب أن يبقى يوم واحد على الأقل مفتوحًا.',
  },
  'business.availability.crossReset': {
    en: "Pickup window can't cross the 03:30 daily reset. Either start at 03:30 or later, or end at 03:29 or earlier.",
    fr: "Le créneau ne peut pas traverser la réinitialisation quotidienne (03:30). Choisissez un début ≥ 03:30, ou une fin ≤ 03:29.",
    ar: "لا يمكن أن يتقاطع وقت الاستلام مع إعادة الضبط اليومية (03:30). ابدأ في 03:30 أو بعدها، أو انتهِ بحلول 03:29.",
  },
  'business.availability.crossResetHint': {
    en: "Pickup window can't cross 03:30 (daily reset). Start at 03:30 or later, or end at 03:29 or earlier.",
    fr: "Le créneau ne doit pas traverser 03:30 (réinitialisation quotidienne). Commencez ≥ 03:30 ou terminez ≤ 03:29.",
    ar: "يجب ألا يتقاطع وقت الاستلام مع 03:30 (إعادة الضبط اليومية). ابدأ من 03:30 أو انتهِ بحلول 03:29.",
  },
  'business.createBasket.dailyResetNotice': {
    en: 'Baskets reset to their daily quantity every day at {{time}} (Tunisia time).',
    fr: 'Les paniers sont réinitialisés à leur quantité quotidienne chaque jour à {{time}} (heure tunisienne).',
    ar: 'تتم إعادة ضبط الأكياس إلى كميتها اليومية كل يوم في الساعة {{time}} (بتوقيت تونس).',
  },
  'business.availability.pauseTitle': {
    en: 'Pause reservations',
    fr: 'Pause des réservations',
    ar: 'إيقاف الحجوزات مؤقتًا',
  },
  'business.availability.pauseDesc': {
    en: 'Temporarily blocks customers from reserving. Your basket counts are kept.',
    fr: 'Empêche temporairement les clients de réserver. Vos quantités sont conservées.',
    ar: 'يمنع العملاء مؤقتًا من الحجز. تبقى كميات الأكياس محفوظة.',
  },
  'business.baskets.pausedBadge': {
    en: 'Paused', fr: 'Pausé', ar: 'متوقف',
  },
  'business.baskets.pauseBasket': {
    en: 'Pause', fr: 'Pause', ar: 'إيقاف مؤقت',
  },
  'business.baskets.resumeBasket': {
    en: 'Resume', fr: 'Reprendre', ar: 'استئناف',
  },
  'orders.impactCo2Label': {
    en: 'CO₂ avoided', fr: 'CO₂ évité', ar: 'CO₂ المتجنب',
  },
  'orders.impactMoneyLabel': {
    en: 'Saved', fr: 'Économisé', ar: 'وفّرت',
  },
  'business.createBasket.pickExistingTitle': {
    en: 'Add a basket', fr: 'Ajouter un panier', ar: 'إضافة كيس',
  },
  'business.createBasket.createManually': {
    en: 'Create a new basket', fr: 'Créer un nouveau panier', ar: 'إنشاء كيس جديد',
  },
  'business.createBasket.createManuallyHint': {
    en: 'Fill out the form from scratch',
    fr: 'Remplir le formulaire à partir de zéro',
    ar: 'املأ النموذج من البداية',
  },
  'business.createBasket.orPickExisting': {
    en: 'Or pick an existing basket',
    fr: 'Ou choisissez un panier existant',
    ar: 'أو اختر كيسًا موجودًا',
  },
  'business.createBasket.noOrgBaskets': {
    en: 'No baskets in your organization yet.',
    fr: 'Aucun panier dans votre organisation pour le moment.',
    ar: 'لا توجد أكياس في مؤسستك حتى الآن.',
  },
  'business.createBasket.useThis': {
    en: 'Use', fr: 'Utiliser', ar: 'استخدام',
  },
  'business.createBasket.alreadyHere': {
    en: 'Already here', fr: 'Déjà ici', ar: 'موجود هنا',
  },
  'business.createBasket.oneLocationChip': {
    en: '1 location', fr: '1 emplacement', ar: 'موقع واحد',
  },
  'business.createBasket.manyLocationsChip': {
    en: '{{count}} locations',
    fr: '{{count}} emplacements',
    ar: '{{count}} مواقع',
  },
  'business.createBasket.noLocationChip': {
    en: 'No location', fr: 'Sans emplacement', ar: 'بدون موقع',
  },
  'business.createBasket.useForAllLocations': {
    en: 'Available across all locations',
    fr: 'Disponible dans tous les emplacements',
    ar: 'متاح في جميع المواقع',
  },
  'business.createBasket.useForAllLocationsHint': {
    en: 'Creates a copy of this basket in each of the {{count}} locations in the organization.',
    fr: "Crée une copie de ce panier dans chacun des {{count}} emplacements de l'organisation.",
    ar: 'ينشئ نسخة من هذا الكيس في كل من المواقع {{count}} في المؤسسة.',
  },
  'business.createBasket.replicateFailed': {
    en: 'Basket created, but copying to other locations failed.',
    fr: 'Panier créé mais la copie vers les autres emplacements a échoué.',
    ar: 'تم إنشاء الكيس ولكن فشل نسخه إلى المواقع الأخرى.',
  },
  'business.team.changeRoleRetry': {
    en: "Couldn't update this role right now. Please try again.",
    fr: 'Impossible de mettre à jour ce rôle pour le moment. Veuillez réessayer.',
    ar: 'تعذر تحديث هذا الدور الآن. يرجى المحاولة مرة أخرى.',
  },
  'business.settings.roleDisplay.orgAdmin': {
    en: 'Admin of {{org}}',
    fr: 'Admin de {{org}}',
    ar: 'مسؤول {{org}}',
  },
  'business.settings.roleDisplay.locationAdmin': {
    en: 'Admin of {{org}} - {{location}}',
    fr: 'Admin de {{org}} - {{location}}',
    ar: 'مسؤول {{org}} - {{location}}',
  },
  'business.settings.roleDisplay.member': {
    en: 'Member of {{org}} - {{location}}',
    fr: 'Membre de {{org}} - {{location}}',
    ar: 'عضو {{org}} - {{location}}',
  },

  // FAQ — full translation set for app/faq.tsx categories + items.
  'faq.general.title': {
    en: 'General', fr: 'Général', ar: 'عام',
  },
  'faq.general.surprise.q': {
    en: 'What exactly is a "surprise basket"?',
    fr: "C'est quoi exactement un « panier surprise » ?",
    ar: 'ما هو "الكيس المفاجئ" بالضبط؟',
  },
  'faq.general.surprise.a': {
    en: 'The "surprise basket" is a set of various products from a food merchant (bakery, restaurant, café…). But what exactly? Surprise…',
    fr: "Le « panier surprise » est un lot qui contient divers produits d'un commerce alimentaire (boulangerie, restaurant, café…). Mais quoi exactement ? Surprise…",
    ar: 'الكيس المفاجئ هو مجموعة من المنتجات المتنوعة من تاجر أغذية (مخبزة، مطعم، مقهى...). لكن ما الذي يحتويه بالضبط؟ مفاجأة...',
  },
  'faq.general.why.q': {
    en: 'Why launch this concept in Tunisia?',
    fr: 'Pourquoi lancer ce concept en Tunisie ?',
    ar: 'لماذا إطلاق هذا المفهوم في تونس؟',
  },
  'faq.general.why.a': {
    en: 'Food waste costs the Tunisian population more than 500 million dinars per year. So you save money and in return, you save the planet!',
    fr: "Le gaspillage alimentaire coûte plus de 500 millions de dinars par an à la population tunisienne. Alors vous économisez de l'argent et en retour, vous sauvez la planète !",
    ar: 'يكلف هدر الطعام السكان التونسيين أكثر من 500 مليون دينار سنويا. إذن أنت توفر المال وفي المقابل تنقذ الكوكب!',
  },
  'faq.general.region.q': {
    en: 'In which region is Barakeat available?',
    fr: 'Dans quelle région est disponible Barakeat ?',
    ar: 'في أي منطقة يتوفر برَكات؟',
  },
  'faq.general.region.a': {
    en: 'Barakeat is currently available in all cities of Greater Tunis. We will keep you informed about our arrival in other regions.',
    fr: 'Actuellement, Barakeat est disponible dans toutes les villes du Grand Tunis. Nous vous tiendrons au courant de notre arrivée dans les autres régions.',
    ar: 'حاليا، يتوفر برَكات في جميع مدن تونس الكبرى. سنبقيك على اطلاع بوصولنا إلى المناطق الأخرى.',
  },
  'faq.general.impact.q': {
    en: 'Will I really help fight food waste?',
    fr: 'Est-ce que je vais vraiment aider à la lutte contre le gaspillage alimentaire ?',
    ar: 'هل سأساعد فعلا في محاربة هدر الطعام؟',
  },
  'faq.general.impact.a': {
    en: 'Yes, massively! Each saved basket prevents precious resources from ending up in the trash. Every action counts!',
    fr: 'Oui, massivement ! Chaque panier sauvé évite que des ressources précieuses ne finissent à la poubelle. Chaque geste compte !',
    ar: 'نعم، بشكل كبير! كل كيس يتم إنقاذه يمنع الموارد الثمينة من الانتهاء في القمامة. كل خطوة مهمة!',
  },

  'faq.orders.title': {
    en: 'Orders', fr: 'Commandes', ar: 'الطلبات',
  },
  'faq.orders.knowContent.q': {
    en: 'Do I know what is in my "surprise basket"?',
    fr: "Est-ce que je sais ce qu'il y a dans mon « panier surprise » ?",
    ar: 'هل أعرف ما يوجد في "كيسي المفاجئ"؟',
  },
  'faq.orders.knowContent.a': {
    en: "It's a surprise! Although you don't know the exact list of items in advance, you are guaranteed to receive products from the merchant in question!",
    fr: "C'est une surprise ! Mais bien que vous ne connaissiez pas la liste exacte des articles à l'avance, vous êtes garanti de recevoir les produits du commerce en question !",
    ar: 'إنها مفاجأة! رغم أنك لا تعرف القائمة الدقيقة للأصناف مسبقا، أنت مضمون لاستلام منتجات التاجر المعني!',
  },
  'faq.orders.whyUnknown.q': {
    en: 'Why don\'t I know what is in the "surprise basket"?',
    fr: 'Pourquoi je ne sais pas ce qu\'il y a dans le « panier surprise » ?',
    ar: 'لماذا لا أعرف ما يوجد في "الكيس المفاجئ"؟',
  },
  'faq.orders.whyUnknown.a': {
    en: "Because it's the day's unsold items. Merchants can't predict what they'll have left and promise you specific content.",
    fr: "Parce qu'il s'agit d'invendus du jour. Les commerces ne peuvent pas prédire ce qu'il leur reste et vous promettre un contenu spécifique.",
    ar: 'لأنها منتجات اليوم غير المباعة. لا تستطيع المتاجر التنبؤ بما سيتبقى ووعدك بمحتوى محدد.',
  },
  'faq.orders.stillGood.q': {
    en: 'Is the food I receive still good?',
    fr: 'Est-ce que la nourriture que je reçois est encore bonne ?',
    ar: 'هل الطعام الذي أتلقاه لا يزال جيدا؟',
  },
  'faq.orders.stillGood.a': {
    en: 'Absolutely! The products offered are from the same day, fresh, and perfectly fit for consumption.',
    fr: 'Absolument ! Les produits proposés sont ceux du jour même, frais, et parfaitement propres à la consommation.',
    ar: 'بالتأكيد! المنتجات المعروضة هي من نفس اليوم، طازجة، وصالحة تماما للاستهلاك.',
  },
  'faq.orders.pickup.q': {
    en: 'How does pickup work?',
    fr: 'Comment fonctionne le retrait ?',
    ar: 'كيف يعمل الاستلام؟',
  },
  'faq.orders.pickup.a': {
    en: 'After reserving a basket, you receive a pickup code. Go to the merchant during the indicated time slot, show your code, pay and leave with your basket!',
    fr: 'Après avoir réservé un panier, vous recevez un code de retrait. Rendez-vous au commerce pendant le créneau indiqué, présentez votre code, payez et repartez avec votre panier !',
    ar: 'بعد حجز كيس، تستلم رمز استلام. توجه إلى المتجر خلال الفترة الزمنية المحددة، اعرض رمزك، ادفع وغادر بكيسك!',
  },
  'faq.orders.cancel.q': {
    en: 'Can I cancel my order?',
    fr: 'Puis-je annuler ma commande ?',
    ar: 'هل يمكنني إلغاء طلبي؟',
  },
  'faq.orders.cancel.a': {
    en: 'Yes, you can cancel before the start of the pickup window. Late cancellations may affect your account.',
    fr: 'Oui, vous pouvez annuler avant le début du créneau de retrait. Les annulations tardives peuvent affecter votre compte.',
    ar: 'نعم، يمكنك الإلغاء قبل بداية فترة الاستلام. قد تؤثر الإلغاءات المتأخرة على حسابك.',
  },

  'faq.payment.title': {
    en: 'Payment', fr: 'Paiement', ar: 'الدفع',
  },
  'faq.payment.howToPay.q': {
    en: 'How do I pay?',
    fr: 'Comment je paie ?',
    ar: 'كيف أدفع؟',
  },
  'faq.payment.howToPay.a': {
    en: '« Payment is made either online by credit card, by Barakeat credits, or on-site directly at the merchant\'s establishment upon pickup »',
    fr: '« Le paiement se fait soit en ligne par carte bancaire, soit par crédits Barakeat, ou sur place directement à l\'établissement du commerce lors du retrait »',
    ar: '«يتم الدفع إما عبر الإنترنت بالبطاقة البنكية، أو برصيد برَكات، أو نقدا مباشرة في محل التاجر عند الاستلام»',
  },
  'faq.payment.credits.q': {
    en: 'What are Barakeat credits?',
    fr: 'Qu\'est-ce que les crédits Barakeat ?',
    ar: 'ما هي أرصدة برَكات؟',
  },
  'faq.payment.credits.a': {
    en: 'These are credits you earn by referring friends or via gift codes. They can be used to reduce the price of your next baskets.',
    fr: 'Ce sont des crédits que vous gagnez en parrainant des amis ou via des codes cadeaux. Ils peuvent être utilisés pour réduire le prix de vos prochains paniers.',
    ar: 'هذه أرصدة تكسبها من خلال إحالة الأصدقاء أو عبر رموز الهدايا. يمكن استخدامها لتقليل سعر أكياسك التالية.',
  },

  'faq.merchants.title': {
    en: 'Merchants', fr: 'Commerçants', ar: 'التجار',
  },
  'faq.merchants.become.q': {
    en: 'How to become a partner merchant?',
    fr: 'Comment devenir commerçant partenaire ?',
    ar: 'كيف أصبح تاجرا شريكا؟',
  },
  'faq.merchants.become.a': {
    en: "Sign up directly on the app as a merchant or contact us at contact@barakeat.tn. Registration is free!",
    fr: "Inscrivez-vous directement sur l'application en tant que commerçant ou contactez-nous à contact@barakeat.tn. L'inscription est gratuite !",
    ar: 'سجل مباشرة في التطبيق كتاجر أو اتصل بنا على contact@barakeat.tn. التسجيل مجاني!',
  },
};

function setDeep(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object' || Array.isArray(cur[p])) {
      cur[p] = {};
    }
    cur = cur[p];
  }
  const leaf = parts[parts.length - 1];
  if (cur[leaf] === undefined) {
    cur[leaf] = value;
    return true; // added
  }
  return false; // already present
}

const langs = ['en', 'fr', 'ar'];
const summary = {};

for (const lang of langs) {
  const file = path.join(localesDir, `${lang}.json`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  let added = 0;
  for (const [key, vals] of Object.entries(ADDITIONS)) {
    if (setDeep(json, key, vals[lang])) added++;
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  summary[lang] = added;
}

console.log('Added keys per locale:', summary);
console.log('Run `node -e "...JSON.parse..."` to validate JSON if you want a final check.');
