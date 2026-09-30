import React, { useState } from 'react';
import { diversificationService } from '../../services/diversificationService';
import { FormattedAmount } from '../localization/FormattedAmount';

const MOCK_POSITIONS = [
  { debtor: 'Acme Global Ltd', amountUsd: 3000, riskScore: 35, tenorDays: 30 },
  { debtor: 'Safari Telcom', amountUsd: 2500, riskScore: 65, tenorDays: 60 },
  { debtor: 'Lagos Logistics', amountUsd: 1500, riskScore: 85, tenorDays: 90 },
];

export const DiversificationInsightsWidget: React.FC = () => {
  const [positions] = useState(MOCK_POSITIONS);
  const diversification = diversificationService.calculateDiversification(positions);

  return (
    <div className="diversification-widget bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-5">
      <div className="flex justify-between items-center border-b pb-3">
        <div>
          <h3 className="text-base font-bold text-gray-900">Portfolio Diversification Insights</h3>
          <p className="text-xs text-gray-500">
            Real-time concentration cap monitoring across risk tiers, debtors, and tenors.
          </p>
        </div>
        <div className="text-right">
          <span className="text-xs text-gray-400 block">Total Portfolio</span>
          <FormattedAmount amountUsd={diversification.totalPortfolioUsd} />
        </div>
      </div>

      {/* Warnings Banner */}
      {diversification.warnings.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
          <div className="text-xs font-semibold text-amber-800 flex items-center space-x-1">
            <span>⚠️</span>
            <span>Concentration Warnings & Alerts</span>
          </div>
          {diversification.warnings.map((warn, i) => (
            <p key={i} className="text-[11px] text-amber-700">
              • {warn}
            </p>
          ))}
        </div>
      )}

      {/* Risk Tiers */}
      <div>
        <h4 className="text-xs font-bold text-gray-700 mb-2 uppercase tracking-wider">Risk Tier Exposure</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(Object.keys(diversification.riskTierExposure) as Array<keyof typeof diversification.riskTierExposure>).map((key) => {
            const item = diversification.riskTierExposure[key];
            return (
              <div key={key} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="font-semibold text-gray-800">{item.name}</span>
                  <span
                    className={`font-bold ${
                      item.status === 'BREACHED' ? 'text-red-600' : item.status === 'WARNING' ? 'text-amber-600' : 'text-emerald-600'
                    }`}
                  >
                    {item.percentage.toFixed(1)}% / {item.capPercent}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-1.5 rounded-full ${
                      item.status === 'BREACHED' ? 'bg-red-500' : item.status === 'WARNING' ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(item.percentage, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Debtor Exposures */}
      <div>
        <h4 className="text-xs font-bold text-gray-700 mb-2 uppercase tracking-wider">Debtor Exposure vs Cap (30%)</h4>
        <div className="space-y-2">
          {diversification.debtorExposures.map((d) => (
            <div key={d.key} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-xl text-xs">
              <span className="font-medium text-gray-800 w-1/3 truncate">{d.name}</span>
              <div className="w-1/3 px-2">
                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-1.5 rounded-full ${
                      d.status === 'BREACHED' ? 'bg-red-500' : d.status === 'WARNING' ? 'bg-amber-500' : 'bg-indigo-600'
                    }`}
                    style={{ width: `${Math.min(d.percentage, 100)}%` }}
                  />
                </div>
              </div>
              <div className="w-1/3 text-right">
                <span className="font-bold text-gray-900">${d.amountUsd.toLocaleString()}</span>
                <span className="text-gray-400 text-[10px] block">({d.percentage.toFixed(1)}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
