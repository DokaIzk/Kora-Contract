/**
 * Wave Issue List Component
 * Displays list of Wave issues with filtering and sorting
 */

import React, { useState, useMemo } from 'react';
import type { WaveIssue } from '../../types/wave';
import { WaveIssueStatus, PayoutStatus } from '../../types/wave';

interface WaveIssueListProps {
  issues: WaveIssue[];
}

type FilterStatus = 'all' | WaveIssueStatus;
type FilterPayout = 'all' | PayoutStatus;
type SortKey = 'pointValue' | 'createdAt' | 'updatedAt' | 'issueNumber';

export const WaveIssueList: React.FC<WaveIssueListProps> = ({ issues }) => {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [payoutFilter, setPayoutFilter] = useState<FilterPayout>('all');
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDesc, setSortDesc] = useState(true);

  const filteredAndSorted = useMemo(() => {
    let filtered = issues;

    if (statusFilter !== 'all') {
      filtered = filtered.filter((i) => i.status === statusFilter);
    }

    if (payoutFilter !== 'all') {
      filtered = filtered.filter((i) => i.payoutStatus === payoutFilter);
    }

    return [...filtered].sort((a, b) => {
      let aVal: any = a[sortKey];
      let bVal: any = b[sortKey];

      if (sortKey === 'createdAt' || sortKey === 'updatedAt') {
        aVal = aVal.getTime();
        bVal = bVal.getTime();
      }

      if (sortDesc) {
        return bVal > aVal ? 1 : -1;
      }
      return aVal > bVal ? 1 : -1;
    });
  }, [issues, statusFilter, payoutFilter, sortKey, sortDesc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  return (
    <div className="wave-issue-list">
      <div className="filters">
        <div className="filter-group">
          <label>Status:</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}>
            <option value="all">All</option>
            <option value={WaveIssueStatus.OPEN}>Open</option>
            <option value={WaveIssueStatus.CLAIMED}>Claimed</option>
            <option value={WaveIssueStatus.IN_PROGRESS}>In Progress</option>
            <option value={WaveIssueStatus.COMPLETED}>Completed</option>
            <option value={WaveIssueStatus.ABANDONED}>Abandoned</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Payout:</label>
          <select value={payoutFilter} onChange={(e) => setPayoutFilter(e.target.value as FilterPayout)}>
            <option value="all">All</option>
            <option value={PayoutStatus.PENDING}>Pending</option>
            <option value={PayoutStatus.APPROVED}>Approved</option>
            <option value={PayoutStatus.DISBURSED}>Disbursed</option>
            <option value={PayoutStatus.REJECTED}>Rejected</option>
            <option value={PayoutStatus.NOT_ELIGIBLE}>Not Eligible</option>
          </select>
        </div>
      </div>

      <table className="issue-table">
        <thead>
          <tr>
            <th onClick={() => handleSort('issueNumber')}>
              Issue {sortKey === 'issueNumber' && (sortDesc ? '↓' : '↑')}
            </th>
            <th>Title</th>
            <th onClick={() => handleSort('pointValue')}>
              Points {sortKey === 'pointValue' && (sortDesc ? '↓' : '↑')}
            </th>
            <th>Status</th>
            <th>Claimed By</th>
            <th>PR</th>
            <th>Payout Status</th>
            <th>Grant ID</th>
            <th onClick={() => handleSort('updatedAt')}>
              Updated {sortKey === 'updatedAt' && (sortDesc ? '↓' : '↑')}
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredAndSorted.map((issue) => (
            <tr key={issue.id} className={`status-${issue.status}`}>
              <td>
                <a
                  href={`https://github.com/kora-finance/contracts/issues/${issue.issueNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  #{issue.issueNumber}
                </a>
              </td>
              <td className="issue-title">{issue.title}</td>
              <td className={`complexity-${issue.complexity.toLowerCase()}`}>
                {issue.pointValue}
              </td>
              <td>
                <span className={`status-badge ${issue.status}`}>
                  {issue.status.replace('_', ' ')}
                </span>
              </td>
              <td>{issue.claimedBy || '-'}</td>
              <td>
                {issue.prNumber ? (
                  <a
                    href={`https://github.com/kora-finance/contracts/pull/${issue.prNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    #{issue.prNumber}
                  </a>
                ) : (
                  '-'
                )}
              </td>
              <td>
                <span className={`payout-badge ${issue.payoutStatus}`}>
                  {issue.payoutStatus.replace('_', ' ')}
                </span>
                {issue.disbursementTxHash && (
                  <a
                    href={`https://stellarchain.io/tx/${issue.disbursementTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tx-link"
                    title="View transaction"
                  >
                    🔗
                  </a>
                )}
              </td>
              <td>{issue.grantProposalId ? `#${issue.grantProposalId}` : '-'}</td>
              <td>{new Date(issue.updatedAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {filteredAndSorted.length === 0 && (
        <div className="no-results">
          <p>No issues match the selected filters.</p>
        </div>
      )}
    </div>
  );
};
