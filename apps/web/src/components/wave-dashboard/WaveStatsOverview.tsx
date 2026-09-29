/**
 * Wave Statistics Overview Component
 * Displays high-level statistics about the Wave program
 */

import React from 'react';
import type { WaveStats } from '../../types/wave';

interface WaveStatsOverviewProps {
  stats: WaveStats;
}

export const WaveStatsOverview: React.FC<WaveStatsOverviewProps> = ({ stats }) => {
  const completionRate =
    stats.totalIssues > 0 ? ((stats.completedIssues / stats.totalIssues) * 100).toFixed(1) : '0';
  const disbursementRate =
    stats.totalPointsAllocated > 0
      ? ((stats.totalDisbursed / stats.totalPointsAllocated) * 100).toFixed(1)
      : '0';

  return (
    <div className="wave-stats-overview">
      <h2>Wave Program Statistics</h2>

      <div className="stats-grid">
        <div className="stat-card total-issues">
          <div className="stat-value">{stats.totalIssues}</div>
          <div className="stat-label">Total Issues</div>
        </div>

        <div className="stat-card open-issues">
          <div className="stat-value">{stats.openIssues}</div>
          <div className="stat-label">Open Issues</div>
        </div>

        <div className="stat-card claimed-issues">
          <div className="stat-value">{stats.claimedIssues}</div>
          <div className="stat-label">In Progress</div>
        </div>

        <div className="stat-card completed-issues">
          <div className="stat-value">{stats.completedIssues}</div>
          <div className="stat-label">Completed</div>
        </div>

        <div className="stat-card completion-rate">
          <div className="stat-value">{completionRate}%</div>
          <div className="stat-label">Completion Rate</div>
        </div>

        <div className="stat-card active-contributors">
          <div className="stat-value">{stats.activeContributors}</div>
          <div className="stat-label">Contributors</div>
        </div>

        <div className="stat-card total-points">
          <div className="stat-value">{stats.totalPointsAllocated}</div>
          <div className="stat-label">Points Allocated</div>
        </div>

        <div className="stat-card total-disbursed">
          <div className="stat-value">{stats.totalDisbursed}</div>
          <div className="stat-label">Points Disbursed</div>
        </div>

        <div className="stat-card disbursement-rate">
          <div className="stat-value">{disbursementRate}%</div>
          <div className="stat-label">Disbursement Rate</div>
        </div>
      </div>

      <div className="stats-breakdown">
        <h3>Issue Status Breakdown</h3>
        <div className="breakdown-chart">
          <div
            className="bar open"
            style={{ width: `${(stats.openIssues / stats.totalIssues) * 100}%` }}
          >
            <span className="bar-label">Open: {stats.openIssues}</span>
          </div>
          <div
            className="bar claimed"
            style={{ width: `${(stats.claimedIssues / stats.totalIssues) * 100}%` }}
          >
            <span className="bar-label">In Progress: {stats.claimedIssues}</span>
          </div>
          <div
            className="bar completed"
            style={{ width: `${(stats.completedIssues / stats.totalIssues) * 100}%` }}
          >
            <span className="bar-label">Completed: {stats.completedIssues}</span>
          </div>
        </div>
      </div>

      <div className="stats-breakdown">
        <h3>Payout Breakdown</h3>
        <div className="breakdown-chart">
          <div
            className="bar disbursed"
            style={{
              width: `${(stats.totalDisbursed / stats.totalPointsAllocated) * 100}%`,
            }}
          >
            <span className="bar-label">Disbursed: {stats.totalDisbursed}</span>
          </div>
          <div
            className="bar pending"
            style={{
              width: `${
                ((stats.totalPointsAllocated - stats.totalDisbursed) /
                  stats.totalPointsAllocated) *
                100
              }%`,
            }}
          >
            <span className="bar-label">
              Pending: {stats.totalPointsAllocated - stats.totalDisbursed}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
