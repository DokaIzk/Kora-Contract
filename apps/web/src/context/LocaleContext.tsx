import React, { createContext, useContext, useState, ReactNode } from 'react';
import { LocaleInfo, SupportedLocale, TranslationDictionary } from '../types/i18n';

export const SUPPORTED_LOCALES: Record<SupportedLocale, LocaleInfo> = {
  en: { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  sw: { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', flag: '🇰🇪' },
  fr: { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  yo: { code: 'yo', name: 'Yoruba', nativeName: 'Yorùbá', flag: '🇳🇬' },
  ha: { code: 'ha', name: 'Hausa', nativeName: 'Hausa', flag: '🇳🇬' },
};

const TRANSLATIONS: Record<SupportedLocale, TranslationDictionary> = {
  en: {
    'nav.marketplace': 'Marketplace',
    'nav.invoices': 'Invoices',
    'nav.funding': 'Funding',
    'nav.repayment': 'Repayment',
    'nav.notifications': 'Notifications',
    'flow.submit_invoice': 'Submit Invoice',
    'flow.fund_invoice': 'Fund Invoice',
    'flow.repay_invoice': 'Repay Invoice',
    'sim.preview_title': 'Transaction Simulation Preview',
    'sim.confirm': 'Confirm & Sign',
    'sim.cancel': 'Cancel',
  },
  sw: {
    'nav.marketplace': 'Soko',
    'nav.invoices': 'Ankara',
    'nav.funding': 'Ufadhili',
    'nav.repayment': 'Malipo',
    'nav.notifications': 'Arifa',
    'flow.submit_invoice': 'Wasilisha Ankara',
    'flow.fund_invoice': 'Fadhili Ankara',
    'flow.repay_invoice': 'Lipa Ankara',
    'sim.preview_title': 'Uhakiki wa Uigizaji wa Muamala',
    'sim.confirm': 'Thibitisha na Weka Sahihi',
    'sim.cancel': 'Ghairi',
  },
  fr: {
    'nav.marketplace': 'Marché',
    'nav.invoices': 'Factures',
    'nav.funding': 'Financement',
    'nav.repayment': 'Remboursement',
    'nav.notifications': 'Notifications',
    'flow.submit_invoice': 'Soumettre la Facture',
    'flow.fund_invoice': 'Financer la Facture',
    'flow.repay_invoice': 'Rembourser la Facture',
    'sim.preview_title': 'Aperçu de la Simulation de Transaction',
    'sim.confirm': 'Confirmer et Signer',
    'sim.cancel': 'Annuler',
  },
  yo: {
    'nav.marketplace': 'Ọjà',
    'nav.invoices': 'Àwọn Íńfóìsì',
    'nav.funding': 'Ìfowósi',
    'nav.repayment': 'Ìsanpadà',
    'nav.notifications': 'Àwọn Ìfilọ̀',
    'flow.submit_invoice': 'Fi Íńfóìsì Sílẹ̀',
    'flow.fund_invoice': 'Sọ Fún Íńfóìsì',
    'flow.repay_invoice': 'San Íńfóìsì Padà',
    'sim.preview_title': 'Àwòfojúsun Ìfọwọ́sowọ́pọ̀',
    'sim.confirm': 'Fowósi & Buwọlu',
    'sim.cancel': 'Fagilee',
  },
  ha: {
    'nav.marketplace': 'Kasuwa',
    'nav.invoices': 'Inyoyoyi',
    'nav.funding': 'Taimakon Kudi',
    'nav.repayment': 'Biya Kudi',
    'nav.notifications': 'Sanarwoyi',
    'flow.submit_invoice': 'Mika Invois',
    'flow.fund_invoice': 'Bada Kudi Invois',
    'flow.repay_invoice': 'Biya Invois',
    'sim.preview_title': 'Samfura na Hada-hada',
    'sim.confirm': 'Tabbatar da Sa Hannu',
    'sim.cancel': 'Soke',
  },
};

interface LocaleContextType {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: string) => string;
  localeInfo: LocaleInfo;
}

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

export const LocaleProvider: React.FC<{ children: ReactNode; initialLocale?: SupportedLocale }> = ({
  children,
  initialLocale = 'en',
}) => {
  const [locale, setLocale] = useState<SupportedLocale>(initialLocale);

  const t = (key: string): string => {
    const dict = TRANSLATIONS[locale] || TRANSLATIONS['en'];
    return dict[key] || TRANSLATIONS['en'][key] || key;
  };

  const localeInfo = SUPPORTED_LOCALES[locale];

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t, localeInfo }}>
      {children}
    </LocaleContext.Provider>
  );
};

export const useI18n = (): LocaleContextType => {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useI18n must be used within a LocaleProvider');
  }
  return context;
};
