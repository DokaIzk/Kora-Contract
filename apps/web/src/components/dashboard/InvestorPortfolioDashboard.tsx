/**
 * Investor Portfolio Dashboard Component (#775)
 * Displays aggregate investment metrics, risk/debtor exposure, active & historical positions.
 */

import React, { useState } from 'react';
import { InvestorPosition } from '../../types/portfolio';
import { PortfolioService } from '../../services/portfolioService';

interface Props {
  initialPositions?: InvestorPosition[];
}

const DEFAULT_POSITIONS: InvestorPosition[] = [
  {
    id: 'POS-001',
    poolId: 'POOL-ALPHA',
    invoiceId: 'INV-8821',
    debtorName: 'Acme Logistics',
    debtorHash: '0x89aef78c90b',
    riskTier: 'AAA',
    currency: 'USDC',
    investedAmount: 50_000_000n,
    currentValue: 52_500_000n,
    realizedYield: 0n,
    unrealizedYield: 2_500_000n,
    fundingTimestamp: 1700000000,
    maturityTimestamp: 1705000000,
    status: 'Active',
  },
  {
    id: 'POS-002',
    poolId: 'POOL-BETA',
    invoiceId: 'INV-9932',
    debtorName: 'Global Transporters',
    debtorHash: '0x71bde4411aa',
    riskTier: 'A',
    currency: 'USDC',
    investedAmount: 30_000_000n,
    currentValue: 31_200_000n,
    realizedYield: 0n,
    unrealizedYield: 1_200_000n,
    fundingTimestamp: 1701000000,
    maturityTimestamp: 1706000000,
    status: 'Active',
  },
  {
    id: 'POS-003',
    poolId: 'POOL-ALPHA',
    invoiceId: 'INV-7711',
    debtorName: 'Nexus Tech Supplies',
    debtorHash: '0x33cf88122bb',
    riskTier: 'AA',
    currency: 'USDC',
    investedAmount: 20_000_000n,
    currentValue: 20_000_000n,
    realizedYield: 1_800_000n,
    unrealizedYield: 0n,
    fundingTimestamp: 1690000000,
    maturityTimestamp: 1695000000,
    status: 'Completed',
  },
];

export const InvestorPortfolioDashboard: React.FC<Props> = ({ initialPositions = DEFAULT_POSITIONS }) => {
  const [positions, setPositions] = useState<InvestorPosition[]>(initialPositions);
  const [selectedPosition, setSelectedPosition] = useState<InvestorPosition | null>(null);

  const metrics = PortfolioService.computePortfolioMetrics(positions);
  const activePositions = PortfolioService.filterActivePositions(positions);
  const historicalPositions = PortfolioService.filterHistoricalPositions(positions);

  const handleTransferSecondary = (posId: string) => {
    const updated = PortfolioService.transferPositionOnSecondaryMarket(positions, posId);
    setPositions(updated);
    setSelectedPosition(null);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Investor Portfolio Dashboard</h2>

      {/* Aggregate Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase">Total Active Invested</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {Object.entries(metrics.totalInvestedByCurrency)
              .map(([curr, amt]) => `${(Number(amt) / 1e6).toFixed(2)} ${curr}`)
              .join(', ') || '0 USDC'}
          </p>
          <span className="text-xs text-gray-500 mt-1 inline-block">Across {metrics.activePositionsCount} active positions</span>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase">Total Realized Yield</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {Object.entries(metrics.totalRealizedYieldByCurrency)
              .map(([curr, amt]) => `+${(Number(amt) / 1e6).toFixed(2)} ${curr}`)
              .join(', ') || '0 USDC'}
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase">Unrealized Accrued Yield</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {Object.entries(metrics.totalUnrealizedYieldByCurrency)
              .map(([curr, amt]) => `+${(Number(amt) / 1e6).toFixed(2)} ${curr}`)
              .join(', ') || '0 USDC'}
          </p>
        </div>
      </div>

      {/* Exposure Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Risk Tier Exposure */}
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-3">Risk Tier Exposure</h3>
          <div className="space-y-2">
            {metrics.riskTierDistribution.map((item) => (
              <div key={item.riskTier} className="text-sm">
                <div className="flex justify-between font-medium">
                  <span>{item.riskTier}</span>
                  <span>{item.percentage}%</span>
                </div>
                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden mt-1">
                  <div className="bg-blue-600 h-full" style={{ width: `${item.percentage}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Debtor Exposure */}
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-3">Top Debtor Exposure</h3>
          <div className="space-y-2">
            {metrics.debtorDistribution.map((item) => (
              <div key={item.debtorHash} className="text-sm">
                <div className="flex justify-between font-medium">
                  <span>{item.debtorName}</span>
                  <span>{item.percentage}%</span>
                </div>
                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden mt-1">
                  <div className="bg-indigo-600 h-full" style={{ width: `${item.percentage}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active Positions Table */}
      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <h3 className="font-semibold text-gray-800 mb-3">Active Positions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-gray-500 font-semibold">
                <th className="pb-2">Invoice / Debtor</th>
                <th className="pb-2">Risk Tier</th>
                <th className="pb-2">Invested</th>
                <th className="pb-2">Yield</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {activePositions.map((pos) => (
                <tr key={pos.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 font-medium text-gray-900">{pos.debtorName} ({pos.invoiceId})</td>
                  <td className="py-3"><span className="px-2 py-1 bg-blue-50 text-blue-700 rounded font-semibold text-xs">{pos.riskTier}</span></td>
                  <td className="py-3 font-mono">{(Number(pos.investedAmount) / 1e6).toFixed(2)} {pos.currency}</td>
                  <td className="py-3 text-green-600 font-mono">+{(Number(pos.unrealizedYield) / 1e6).toFixed(2)}</td>
                  <td className="py-3">
                    <button
                      onClick={() => setSelectedPosition(pos)}
                      className="text-xs text-blue-600 hover:underline font-semibold"
                    >
                      View / Transfer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Historical Positions Table */}
      {historicalPositions.length > 0 && (
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-3">Historical / Transferred Positions</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead>
                <tr className="border-b text-gray-500 font-semibold">
                  <th className="pb-2">Position ID</th>
                  <th className="pb-2">Debtor</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Realized Yield</th>
                </tr>
              </thead>
              <tbody>
                {historicalPositions.map((pos) => (
                  <tr key={pos.id} className="border-b">
                    <td className="py-2 font-mono text-xs">{pos.id}</td>
                    <td className="py-2">{pos.debtorName}</td>
                    <td className="py-2"><span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{pos.status}</span></td>
                    <td className="py-2 font-mono text-green-600">+{(Number(pos.realizedYield) / 1e6).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Drill-down Modal */}
      {selectedPosition && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white p-6 rounded-xl max-w-md w-full space-y-4 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Position Details: {selectedPosition.id}</h3>
            <div className="space-y-2 text-sm text-gray-700">
              <p><strong>Debtor:</strong> {selectedPosition.debtorName}</p>
              <p><strong>Invoice ID:</strong> {selectedPosition.invoiceId}</p>
              <p><strong>Invested:</strong> {(Number(selectedPosition.investedAmount) / 1e6).toFixed(2)} {selectedPosition.currency}</p>
              <p><strong>Status:</strong> {selectedPosition.status}</p>
            </div>

            <div className="pt-4 flex justify-between">
              <button
                onClick={() => setSelectedPosition(null)}
                className="text-sm text-gray-600 hover:underline"
              >
                Close
              </button>
              {selectedPosition.status === 'Active' && (
                <button
                  onClick={() => handleTransferSecondary(selectedPosition.id)}
                  className="bg-amber-600 text-white font-medium text-xs px-4 py-2 rounded hover:bg-amber-700"
                >
                  Transfer Secondary Market
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
