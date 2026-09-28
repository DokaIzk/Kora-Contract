export type SupportedLocale = 'en' | 'sw' | 'fr' | 'yo' | 'ha';

export interface LocaleInfo {
  code: SupportedLocale;
  name: string;
  nativeName: string;
  flag: string;
  isRtl?: boolean;
}

export type TranslationDictionary = Record<string, string>;
