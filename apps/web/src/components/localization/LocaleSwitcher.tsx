import React from 'react';
import { SUPPORTED_LOCALES, useI18n } from '../../context/LocaleContext';
import { SupportedLocale } from '../../types/i18n';

export const LocaleSwitcher: React.FC = () => {
  const { locale, setLocale } = useI18n();

  return (
    <div className="locale-switcher relative inline-block text-left">
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as SupportedLocale)}
        className="px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        aria-label="Select Language Locale"
      >
        {(Object.keys(SUPPORTED_LOCALES) as SupportedLocale[]).map((locKey) => {
          const loc = SUPPORTED_LOCALES[locKey];
          return (
            <option key={loc.code} value={loc.code}>
              {loc.flag} {loc.nativeName} ({loc.code.toUpperCase()})
            </option>
          );
        })}
      </select>
    </div>
  );
};
