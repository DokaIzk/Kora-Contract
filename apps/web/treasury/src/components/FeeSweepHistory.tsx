/**
 * Fee Sweep History Component
 * 
 * Displays chronological log of all fee collections from protocol contracts.
 * Each entry links to the underlying transaction for verification.
 */

import React, { useEffect, useState } from 'react';
import { treasuryApi, FeeSweep } from '../services/treasuryApi';
import { formatDate, formatDateTime } from '../utils/format';

export const FeeSweepHistory: React.FC = () => {
  const [sweeps, setSweeps] = useState<FeeSweep[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    loadSweeps();
  }, [page]);

  const loadSweeps = async () => {
    try {
      setError(null);
      setLoading(true);
      const data = await treasuryApi.getFeeSweeps({
        limit: pageSize,
        offset: page * pageSize,
      });
      setSweeps(data.sweeps);
      setTotal(data.total);
    } catch (err) {
      setError('Failed to load fee sweep history');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading && sweeps.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-4">Fee Sweep History</h2>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold mb-4">Fee Sweep History</h2>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700 mb-4">
          {error}
        </div>
      )}

      {sweeps.length === 0 ? (
        <div className="text-gray-500 text-center py-8">
          No fee sweeps recorded yet
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold">Date</th>
                  <th className="text-left py-3 px-4 font-semibold">Source</th>
                  <th className="text-left py-3 px-4 font-semibold">Asset</th>
                  <th className="text-right py-3 px-4 font-semibold">Amount</th>
                  <th className="text-center py-3 px-4 font-semibold">Verification</th>
                </tr>
              </thead>
              <tbody>
                {sweeps.map((sweep) => (
                  <tr
                    key={sweep.id}
                    className="border-b hover:bg-gray-50 transition-colors"
                  >
                    <td className="py-3 px-4 text-sm">
                      <div>{formatDate(sweep.timestamp)}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(sweep.timestamp * 1000).toLocaleTimeString()}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-block px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                        {sweep.source}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-sm">
                      {sweep.asset}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-green-600">
                      +{sweep.amountFormatted}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <a
                        href={sweep.blockExplorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-sm"
                        title="View transaction on block explorer"
                      >
                        View Tx →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex justify-between items-center mt-6 pt-4 border-t">
              <div className="text-sm text-gray-600">
                Showing {page * pageSize + 1} - {Math.min((page + 1) * pageSize, total)} of {total}
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={(page + 1) * pageSize >= total}
                  className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
