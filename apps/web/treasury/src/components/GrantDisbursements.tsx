/**
 * Grant Disbursements Component
 * 
 * Displays history of treasury grants with links to governance proposals.
 * Shows recipient, purpose, amount, and verification links.
 */

import React, { useEffect, useState } from 'react';
import { treasuryApi, GrantDisbursement } from '../services/treasuryApi';
import { formatDate } from '../utils/format';

export const GrantDisbursements: React.FC = () => {
  const [grants, setGrants] = useState<GrantDisbursement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const pageSize = 20;

  useEffect(() => {
    loadGrants();
  }, [page, filterStatus]);

  const loadGrants = async () => {
    try {
      setError(null);
      setLoading(true);
      const data = await treasuryApi.getGrants({
        limit: pageSize,
        offset: page * pageSize,
        status: filterStatus === 'all' ? undefined : filterStatus,
      });
      setGrants(data.grants);
      setTotal(data.total);
    } catch (err) {
      setError('Failed to load grant disbursements');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      executed: 'bg-green-100 text-green-800',
      pending: 'bg-yellow-100 text-yellow-800',
      failed: 'bg-red-100 text-red-800',
    };
    return styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800';
  };

  if (loading && grants.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-4">Grant Disbursements</h2>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Grant Disbursements</h2>
        
        <div className="flex space-x-2">
          {['all', 'executed', 'pending'].map(status => (
            <button
              key={status}
              onClick={() => {
                setFilterStatus(status);
                setPage(0);
              }}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                filterStatus === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700 mb-4">
          {error}
        </div>
      )}

      {grants.length === 0 ? (
        <div className="text-gray-500 text-center py-8">
          No grant disbursements found
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {grants.map((grant) => (
              <div
                key={grant.id}
                className="border rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <h3 className="font-semibold text-lg">{grant.purpose}</h3>
                      <span className={`px-2 py-1 text-xs rounded ${getStatusBadge(grant.status)}`}>
                        {grant.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      Recipient: {grant.recipientLabel || (
                        <span className="font-mono">
                          {grant.recipient.substring(0, 8)}...{grant.recipient.slice(-6)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-2xl font-bold text-blue-600">
                      {grant.amountFormatted}
                    </div>
                    <div className="text-sm text-gray-600">{grant.asset}</div>
                  </div>
                </div>

                <div className="flex justify-between items-center mt-3 pt-3 border-t">
                  <div className="text-sm text-gray-600">
                    {formatDate(grant.timestamp)}
                  </div>

                  <div className="flex space-x-4 text-sm">
                    {grant.proposalId && grant.proposalUrl && (
                      <a
                        href={grant.proposalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        Proposal #{grant.proposalId}
                      </a>
                    )}
                    <a
                      href={grant.blockExplorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      View Transaction →
                    </a>
                  </div>
                </div>
              </div>
            ))}
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
