/**
 * Wave Contributor Dashboard
 * Public dashboard tracking Wave issues, contributors, points/rewards, and payout status
 */

import React, { useState, useEffect } from 'react';
import { waveService } from '../../services/waveService';
import type { WaveIssue, Contributor, WaveStats } from '../../types/wave';
import { WaveIssueList } from './WaveIssueList';
import { ContributorLeaderboard } from './ContributorLeaderboard';
import { WaveStatsOverview } from './WaveStatsOverview';

type View = 'issues' | 'contributors' | 'stats';

export const WaveDashboard: React.FC = () => {
  const [view, setView] = useState<View>('issues');
  const [issues, setIssues] = useState<WaveIssue[]>([]);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [stats, setStats] = useState<WaveStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [issuesData, contributorsData, statsData] = await Promise.all([
        waveService.fetchWaveIssuesWithDisbursements(),
        waveService.fetchContributors(),
        waveService.fetchWaveStats(),
      ]);

      setIssues(issuesData);
      setContributors(contributorsData);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Wave data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="wave-dashboard loading">
        <p>Loading Wave dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wave-dashboard error">
        <p>Error: {error}</p>
        <button onClick={loadData}>Retry</button>
      </div>
    );
  }

  return (
    <div className="wave-dashboard">
      <header className="dashboard-header">
        <h1>Wave Contributor Dashboard</h1>
        <p>Transparent tracking of contributor work, points, and payouts</p>
      </header>

      <nav className="dashboard-nav">
        <button
          className={view === 'issues' ? 'active' : ''}
          onClick={() => setView('issues')}
        >
          Issues ({stats?.totalIssues || 0})
        </button>
        <button
          className={view === 'contributors' ? 'active' : ''}
          onClick={() => setView('contributors')}
        >
          Contributors ({contributors.length})
        </button>
        <button
          className={view === 'stats' ? 'active' : ''}
          onClick={() => setView('stats')}
        >
          Statistics
        </button>
      </nav>

      <div className="dashboard-content">
        {view === 'issues' && <WaveIssueList issues={issues} />}
        {view === 'contributors' && <ContributorLeaderboard contributors={contributors} />}
        {view === 'stats' && stats && <WaveStatsOverview stats={stats} />}
      </div>

      <footer className="dashboard-footer">
        <button onClick={loadData}>Refresh Data</button>
        <p className="last-updated">
          Last updated: {new Date().toLocaleString()}
        </p>
      </footer>
    </div>
  );
};
