import React from 'react';
import { useCurrency } from '../../context/CurrencyContext';

interface FormattedAmountProps {
  amountUsd: number;
  showCanonicalFirst?: boolean;
  className?: string;
}

export const FormattedAmount: React.FC<FormattedAmountProps> = ({
  amountUsd,
  showCanonicalFirst = true,
  className = '',
}) => {
  const { convertAmount } = useCurrency();
  const { formattedCanonical, formattedConverted, rateData } = convertAmount(amountUsd);

  return (
    <span className={`formatted-amount-container ${className}`}>
      {showCanonicalFirst ? (
        <>
          <span className="canonical-amount font-bold text-gray-900">{formattedCanonical}</span>
          <span className="converted-amount text-sm text-gray-500 ml-1.5">
            ({formattedConverted})
          </span>
        </>
      ) : (
        <>
          <span className="converted-amount font-bold text-gray-900">{formattedConverted}</span>
          <span className="canonical-amount text-sm text-gray-500 ml-1.5">
            ({formattedCanonical})
          </span>
        </>
      )}

      {rateData.isStale && (
        <span
          className="stale-badge inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 ml-2"
          title={`FX rate as of ${new Date(rateData.timestamp).toLocaleTimeString()} is stale`}
        >
          Rate Stale
        </span>
      )}
    </span>
  );
};
