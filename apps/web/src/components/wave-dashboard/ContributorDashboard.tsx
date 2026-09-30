/**
 * Wave Contributor Dashboard
 * 
 * Public dashboard tracking Wave contributor initiatives with visibility
 * into work allocation and on-chain payouts.
 */

import React, { useEffect, useState } from 'react';
import type { WaveIssue, ContributorStats, WaveSummary, WaveDashboardFilters } from '../../types/wave';
import {
  fetchWaveDashboard,
  calculateContributorStats,
  calculateWaveSummary,
  filterIssues,
  detectStaleClaims,
} from '../../services/waveService';
import { IssueCard } from './IssueCard';
import { PayoutStatus } from './PayoutStatus';
import { WaveStats } from './WaveStats';

export const ContributorDashboard: React.FC = () => {
  const [issues, setIssues] = useState<WaveIssue[]>([]);
  const [filteredIssues, setFilteredIssues] = useState<WaveIssue[]>([]);
  const [contributorStats, setContributorStats] = useState<ContributorStats[]>([]);
  const [summary, setSummary] = useState<WaveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<WaveDashboardFilters>({});
  const [viewMode, setViewMode] = useState<'issues' | 'contributors'>('issues');

  useEffect(() => {
    loadDashboardData();
  }, []);

  useEffect(() => {
    if (issues.length > 0) {
      const filtered = filterIssues(issues, filters);
      setFilteredIssues(filtered);
    }
  }, [issues, filters]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      const rawIssues = await fetchWaveDashboard();
      const issuesWithStaleDetection = detectStaleClaims(rawIssues);
      
      setIssues(issuesWithStaleDetection);
      setFilteredIssues(issuesWithStaleDetection);
      setContributorStats(calculateContributorStats(issuesWithStaleDetection));
      setSummary(calculateWaveSummary(issuesWithStaleDetection));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (newFilters: Partial<WaveDashboardFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  };

  const clearFilters = () => {
    setFilters({});
  };

  if (loading) {
    return (
      <div className="wave-dashboard loading">
        <div className="spinner">Loading Wave Dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wave-dashboard error">
        <h2>Error Loading Dashboard</h2>
        <p>{error}</p>
        <button onClick={loadDashboardData}>Retry</button>
      </div>
    );
  }

  return (
    <div className="wave-dashboard">
      <header className="dashboard-header">
        <h1>Wave Contributor Dashboard</h1>
        <p className="subtitle">
          Track contributor initiatives, rewards, and on-chain payouts for the Kora Protocol Wave program.
        </p>
      </header>

      {summary && <WaveStats summary={summary} />}

      <div className="view-mode-toggle">
        <button
          className={viewMode === 'issues' ? 'active' : ''}
          onClick={() => setViewMode('issues')}
        >
          Issues View
        </button>
        <button
          className={viewMode === 'contributors' ? 'active' : ''}
          onClick={() => setViewMode('contributors')}
        >
          Contributors View
        </button>
      </div>

      <div className="dashboard-filters">
        <h3>Filters</h3>
        
        <div className="filter-group">
          <label>Status:</label>
          <select
            multiple
            value={filters.status || []}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions).map(o => o.value as any);
              handleFilterChange({ status: selected.length > 0 ? selected : undefined });
            }}
          >
            <option value="open">Open</option>
            <option value="claimed">Claimed</option>
            <option value="in-progress">In Progress</option>
            <option value="merged">Merged</option>
            <option value="paid">Paid</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Payout Status:</label>
          <select
            multiple
            value={filters.payoutStatus || []}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions).map(o => o.value as any);
              handleFilterChange({ payoutStatus: selected.length > 0 ? selected : undefined });
            }}
          >
            <option value="none">None</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="declined">Declined</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Contributor:</label>
          <input
            type="text"
            placeholder="GitHub username"
            value={filters.contributor || ''}
            onChange={(e) => handleFilterChange({ contributor: e.target.value || undefined })}
          />
        </div>

        <button className="clear-filters" onClick={clearFilters}>
          Clear All Filters
        </button>
      </div>

      {viewMode === 'issues' ? (
        <div className="issues-view">
          <h2>Issues ({filteredIssues.length})</h2>
          <div className="issues-grid">
            {filteredIssues.map(issue => (
              <IssueCard key={issue.id} issue={issue} />
            ))}
          </div>
        </div>
      ) : (
        <div className="contributors-view">
          <h2>Contributors ({contributorStats.length})</h2>
          <div className="contributors-table">
            <table>
              <thead>
                <tr>
                  <th>Contributor</th>
                  <th>Address</th>
                  <th>Issues Claimed</th>
                  <th>Issues Merged</th>
                  <th>Points Earned</th>
                  <th>Total Payout</th>
                </tr>
              </thead>
              <tbody>
                {contributorStats.map(stats => (
                  <tr key={stats.username}>
                    <td>
                      <a
                        href={`https://github.com/${stats.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {stats.username}
                      </a>
                    </td>
                    <td className="address">
                      {stats.address ? (
                        <code>{stats.address.substring(0, 12)}...</code>
                      ) : (
                        <span className="no-address">Not linked</span>
                      )}
                    </td>
                    <td>{stats.totalIssuesClaimed}</td>
                    <td>{stats.totalIssuesMerged}</td>
                    <td className="points">{stats.totalPointsEarned}</td>
                    <td className="payout">{stats.totalPayoutAmount} USDC</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <footer className="dashboard-footer">
        <p>
          Data refreshed: {new Date().toLocaleString()} |{' '}
          <button onClick={loadDashboardData}>Refresh Now</button>
        </p>
        <p>
          <a href="https://github.com/kora-finance/contracts/issues?q=label%3Awave" target="_blank" rel="noopener noreferrer">
            View on GitHub
          </a>
          {' | '}
          <a href="https://docs.kora.finance/wave" target="_blank" rel="noopener noreferrer">
            Wave Documentation
          </a>
        </p>
      </footer>
    </div>
  );
};
