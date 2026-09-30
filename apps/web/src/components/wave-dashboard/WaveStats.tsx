/**
 * Wave Statistics Component
 * 
 * Displays summary statistics for the Wave program.
 */

import React from 'react';
import type { WaveSummary } from '../../types/wave';

interface WaveStatsProps {
  summary: WaveSummary;
}

export const WaveStats: React.FC<WaveStatsProps> = ({ summary }) => {
  return (
    <div className="wave-stats">
      <div className="stat-card">
        <div className="stat-value">{summary.totalIssues}</div>
        <div className="stat-label">Total Issues</div>
      </div>

      <div className="stat-card">
        <div className="stat-value">{summary.openIssues}</div>
        <div className="stat-label">Open Issues</div>
      </div>

      <div className="stat-card">
        <div className="stat-value">{summary.claimedIssues}</div>
        <div className="stat-label">In Progress</div>
      </div>

      <div className="stat-card">
        <div className="stat-value">{summary.mergedIssues}</div>
        <div className="stat-label">Merged</div>
      </div>

      <div className="stat-card">
        <div className="stat-value">{summary.paidIssues}</div>
        <div className="stat-label">Paid Out</div>
      </div>

      <div className="stat-card highlight">
        <div className="stat-value">{summary.totalPointsAwarded.toLocaleString()}</div>
        <div className="stat-label">Total Points Awarded</div>
      </div>

      <div className="stat-card highlight">
        <div className="stat-value">{summary.totalPayoutAmount} USDC</div>
        <div className="stat-label">Total Payouts</div>
      </div>

      <div className="stat-card">
        <div className="stat-value">{summary.contributors}</div>
        <div className="stat-label">Contributors</div>
      </div>
    </div>
  );
};
