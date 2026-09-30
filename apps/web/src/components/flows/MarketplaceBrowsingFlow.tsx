import React from 'react';
import { useI18n } from '../../context/LocaleContext';
import { FormattedAmount } from '../localization/FormattedAmount';

interface ListingItem {
  id: number;
  debtor: string;
  askingPriceUsd: number;
  faceValueUsd: number;
  riskScore: number;
  progressPercent: number;
  tenorDays: number;
  expectedYieldPercent: number;
}

const SAMPLE_LISTINGS: ListingItem[] = [
  {
    id: 101,
    debtor: 'Safari Telcom Ltd',
    askingPriceUsd: 9500,
    faceValueUsd: 10000,
    riskScore: 85,
    progressPercent: 75,
    tenorDays: 45,
    expectedYieldPercent: 5.26,
  },
  {
    id: 102,
    debtor: 'Lagos Logistics Hub',
    askingPriceUsd: 4750,
    faceValueUsd: 5000,
    riskScore: 92,
    progressPercent: 40,
    tenorDays: 30,
    expectedYieldPercent: 5.26,
  },
  {
    id: 103,
    debtor: 'Cape Agricultural Coop',
    askingPriceUsd: 14200,
    faceValueUsd: 15000,
    riskScore: 78,
    progressPercent: 10,
    tenorDays: 90,
    expectedYieldPercent: 5.63,
  },
];

interface MarketplaceBrowsingFlowProps {
  onSelectListingForFunding?: (id: number, amount: number) => void;
}

type RiskTier = 'all' | 'low' | 'medium' | 'high';
type FundingStatus = 'all' | 'open' | 'funded';
type SortKey = 'yield' | 'tenor' | 'risk' | 'progress';

export const MarketplaceBrowsingFlow: React.FC<MarketplaceBrowsingFlowProps> = ({
  onSelectListingForFunding,
}) => {
  const { t } = useI18n();

  return (
    <div className="flow-card space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{t('nav.marketplace')}</h2>
          <p className="text-xs text-gray-500">Browse verified SME invoice listings available for fractional funding.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SAMPLE_LISTINGS.map((listing) => (
          <div
            key={listing.id}
            className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
          >
            <div>
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                  #{listing.id}
                </span>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                  Score {listing.riskScore}/100
                </span>
              </div>

              <h3 className="text-sm font-bold text-gray-900 truncate">{listing.debtor}</h3>

              <div className="mt-3 space-y-1 text-xs">
                <div className="flex justify-between text-gray-500">
                  <span>Asking Price:</span>
                  <FormattedAmount amountUsd={listing.askingPriceUsd} />
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Face Value:</span>
                  <span className="font-semibold text-gray-800">${listing.faceValueUsd.toLocaleString()}</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-4">
                <div className="flex justify-between text-[11px] font-semibold text-gray-600 mb-1">
                  <span>Funding Progress</span>
                  <span>{listing.progressPercent}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-indigo-600 h-2 rounded-full"
                    style={{ width: `${listing.progressPercent}%` }}
                  />
                </div>
              </div>
            </div>

            <button
              onClick={() => onSelectListingForFunding && onSelectListingForFunding(listing.id, listing.askingPriceUsd)}
              className="mt-5 w-full py-2.5 bg-indigo-600 text-white font-semibold text-xs rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
            >
              Fund This Invoice
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
