/**
 * Contributor Leaderboard Component
 * Displays contributor rankings by points, completed issues, and payouts
 */

import React from 'react';
import type { Contributor } from '../../types/wave';

interface ContributorLeaderboardProps {
  contributors: Contributor[];
}

export const ContributorLeaderboard: React.FC<ContributorLeaderboardProps> = ({
  contributors,
}) => {
  return (
    <div className="contributor-leaderboard">
      <h2>Contributor Leaderboard</h2>
      <p>Top contributors by total points earned</p>

      <table className="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Contributor</th>
            <th>Total Issues</th>
            <th>Completed</th>
            <th>Total Points</th>
            <th>Disbursed</th>
            <th>Pending</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {contributors.map((contributor, index) => (
            <tr key={contributor.address} className={index < 3 ? `rank-${index + 1}` : ''}>
              <td className="rank">
                {index === 0 && '🥇'}
                {index === 1 && '🥈'}
                {index === 2 && '🥉'}
                {index > 2 && index + 1}
              </td>
              <td className="contributor-name">
                {contributor.githubUsername ? (
                  <a
                    href={`https://github.com/${contributor.githubUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    @{contributor.githubUsername}
                  </a>
                ) : (
                  <span className="address">{contributor.address}</span>
                )}
              </td>
              <td>{contributor.totalIssues}</td>
              <td>{contributor.completedIssues}</td>
              <td className="points">{contributor.totalPoints}</td>
              <td className="disbursed">{contributor.totalPayout}</td>
              <td className="pending">{contributor.pendingPayout}</td>
              <td>{new Date(contributor.joinedAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {contributors.length === 0 && (
        <div className="no-contributors">
          <p>No contributors yet. Be the first to claim a Wave issue!</p>
        </div>
      )}
    </div>
  );
};
