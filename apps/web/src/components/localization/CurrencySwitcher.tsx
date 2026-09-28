import React from 'react';
import { useCurrency } from '../../context/CurrencyContext';
import { SupportedCurrency } from '../../types/currency';

const CURRENCIES: Array<{ code: SupportedCurrency; label: string; symbol: string }> = [
  { code: 'USD', label: 'USD (USDC)', symbol: '$' },
  { code: 'NGN', label: 'NGN (Naira)', symbol: '₦' },
  { code: 'KES', label: 'KES (Shilling)', symbol: 'KSh' },
  { code: 'ZAR', label: 'ZAR (Rand)', symbol: 'R' },
  { code: 'GHS', label: 'GHS (Cedi)', symbol: 'GH₵' },
];

export const CurrencySwitcher: React.FC = () => {
  const { currency, setCurrency } = useCurrency();

  return (
    <div className="currency-switcher relative inline-block text-left">
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value as SupportedCurrency)}
        className="px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        aria-label="Select Preferred Currency"
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.symbol} {c.code}
          </option>
        ))}
      </select>
    </div>
  );
};
