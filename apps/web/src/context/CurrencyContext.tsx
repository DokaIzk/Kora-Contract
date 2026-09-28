import React, { createContext, useContext, useState, ReactNode } from 'react';
import { FxRateData, SupportedCurrency } from '../types/currency';
import { fxService } from '../services/fxService';

interface CurrencyContextType {
  currency: SupportedCurrency;
  setCurrency: (currency: SupportedCurrency) => void;
  convertAmount: (amountUsd: number) => {
    convertedAmount: number;
    formattedCanonical: string;
    formattedConverted: string;
    rateData: FxRateData;
  };
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export const CurrencyProvider: React.FC<{ children: ReactNode; initialCurrency?: SupportedCurrency }> = ({
  children,
  initialCurrency = 'USD',
}) => {
  const [currency, setCurrency] = useState<SupportedCurrency>(initialCurrency);

  const convertAmount = (amountUsd: number) => {
    const { convertedAmount, rateData } = fxService.convertFromUsd(amountUsd, currency);

    const formattedCanonical = `$${amountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;

    const currencySymbolMap: Record<SupportedCurrency, string> = {
      USD: '$',
      NGN: '₦',
      KES: 'KSh ',
      ZAR: 'R ',
      GHS: 'GH₵ ',
    };

    const symbol = currencySymbolMap[currency];
    const formattedConverted = `${symbol}${convertedAmount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${currency}`;

    return {
      convertedAmount,
      formattedCanonical,
      formattedConverted,
      rateData,
    };
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, convertAmount }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = (): CurrencyContextType => {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
};
