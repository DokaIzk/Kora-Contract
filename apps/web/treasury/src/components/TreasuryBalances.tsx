/**
 * Treasury Balances Component
 * 
 * Displays current treasury holdings across all supported assets.
 * Each balance links to the on-chain token contract for verification.
 */

import React, { useEffect, useState } from 'react';
import { treasuryApi, TokenBalance } from '../services/treasuryApi';
import { formatNumber, formatUSD } from '../utils/format';

export const TreasuryBalances: React.FC = () => {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBalances();
    // Refresh every 30 seconds
    const interval = setInterval(loadBalances, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadBalances = async () => {
    try {
      setError(null);
      const data = await treasuryApi.getBalances();
      setBalances(data);
    } catch (err) {
      setError('Failed to load treasury balances');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const totalValueUsd = balances.reduce((sum, b) => {
    return sum + (parseFloat(b.usdValue || '0'));
  }, 0);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-4">Treasury Balances</h2>
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-4">Treasury Balances</h2>
        <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Treasury Balances</h2>
        <div className="text-sm text-gray-500">
          Live • Updated {new Date().toLocaleTimeString()}
        </div>
      </div>

      {balances.length === 0 ? (
        <div className="text-gray-500 text-center py-8">
          No balances to display
        </div>
      ) : (
        <>
          <div className="space-y-4 mb-6">
            {balances.map((balance) => (
              <div
                key={balance.asset}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 font-semibold text-sm">
                      {balance.assetCode.substring(0, 3)}
                    </span>
                  </div>
                  <div>
                    <div className="font-semibold text-lg">
                      {balance.assetCode}
                    </div>
                    <a
                      href={`https://stellar.expert/explorer/public/contract/${balance.contractAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                      title="View token contract on-chain"
                    >
                      {balance.contractAddress.substring(0, 8)}...
                      {balance.contractAddress.substring(balance.contractAddress.length - 6)}
                    </a>
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-bold text-xl">
                    {balance.balanceFormatted}
                  </div>
                  {balance.usdValue && (
                    <div className="text-sm text-gray-600">
                      ≈ {formatUSD(parseFloat(balance.usdValue))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {totalValueUsd > 0 && (
            <div className="border-t pt-4">
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold">Estimated Total Value</span>
                <span className="text-2xl font-bold text-blue-600">
                  {formatUSD(totalValueUsd)}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                * USD values are estimates based on current market prices.
                All balances are verifiable on-chain via the links above.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};
