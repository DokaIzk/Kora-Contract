/**
 * Issue Card Component
 * 
 * Displays individual Wave issue with status, complexity, contributor,
 * and payout information.
 */

import React from 'react';
import type { WaveIssue } from '../../types/wave';
import { PayoutStatus as PayoutStatusComponent } from './PayoutStatus';

interface IssueCardProps {
  issue: WaveIssue;
}

export const IssueCard: React.FC<IssueCardProps> = ({ issue }) => {
  const isStale = issue.labels.includes('stale-claim');

  return (
    <div className={`issue-card status-${issue.status} ${isStale ? 'stale' : ''}`}>
      <div className="issue-header">
        <h3>
          <a href={issue.url} target="_blank" rel="noopener noreferrer">
            #{issue.id} {issue.title}
          </a>
        </h3>
        <div className="issue-badges">
          <span className={`complexity-badge complexity-${issue.complexityLabel.toLowerCase()}`}>
            {issue.complexityLabel} ({issue.complexity} pts)
          </span>
          <span className={`status-badge status-${issue.status}`}>
            {issue.status.replace('-', ' ')}
          </span>
          {isStale && <span className="stale-badge">⚠️ Stale</span>}
        </div>
      </div>

      <div className="issue-body">
        {issue.contributor && (
          <div className="contributor-info">
            <strong>Contributor:</strong>{' '}
            <a
              href={`https://github.com/${issue.contributor}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              @{issue.contributor}
            </a>
            {issue.contributorAddress && (
              <div className="contributor-address">
                <code>{issue.contributorAddress.substring(0, 16)}...</code>
              </div>
            )}
          </div>
        )}

        {issue.claimedAt && (
          <div className="timestamp">
            <strong>Claimed:</strong> {issue.claimedAt.toLocaleDateString()}
          </div>
        )}

        {issue.mergedAt && (
          <div className="timestamp">
            <strong>Merged:</strong> {issue.mergedAt.toLocaleDateString()}
          </div>
        )}

        {issue.prUrl && (
          <div className="pr-link">
            <a href={issue.prUrl} target="_blank" rel="noopener noreferrer">
              View Pull Request →
            </a>
          </div>
        )}
      </div>

      <div className="issue-payout">
        <PayoutStatusComponent
          status={issue.payoutStatus}
          amount={issue.payoutAmount}
          txHash={issue.payoutTxHash}
          proposalId={issue.treasuryProposalId}
        />
      </div>
    </div>
  );
};
