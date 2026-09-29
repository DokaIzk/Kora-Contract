/**
 * Treasury Dashboard Application
 * 
 * Public-facing dashboard for Kora Protocol treasury transparency.
 * Displays balances, fee sweeps, grants, and governance outcomes.
 */

import React, { useState } from 'react';
import { TreasuryBalances } from './components/TreasuryBalances';
import { FeeSweepHistory } from './components/FeeSweepHistory';
import { GrantDisbursements } from './components/GrantDisbursements';

type Tab = 'overview' | 'sweeps' | 'grants' | 'governance';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const tabs: { id: Tab; label: string; description: string }[] = [
    {
      id: 'overview',
      label: 'Overview',
      description: 'Current treasury balances and summary',
    },
    {
      id: 'sweeps',
      label: 'Fee Sweeps',
      description: 'Protocol fee collection history',
    },
    {
      id: 'grants',
      label: 'Grants',
      description: 'Treasury disbursements and grants',
    },
    {
      id: 'governance',
      label: 'Governance',
      description: 'Proposal outcomes affecting treasury',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Kora Protocol Treasury
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                Real-time transparency into protocol treasury activity
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-gray-600">Live</span>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${
                    activeTab === tab.id
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Info Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-blue-600"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-blue-900">
                Transparency & Verification
              </h3>
              <div className="mt-1 text-sm text-blue-700">
                <p>
                  All displayed figures are sourced directly from on-chain data. Every transaction
                  and balance links to the underlying blockchain state for independent verification.
                  No login required — this dashboard is publicly accessible.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="space-y-8">
          {activeTab === 'overview' && (
            <>
              <TreasuryBalances />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="text-sm text-gray-600 mb-1">Total Fees Collected</div>
                  <div className="text-3xl font-bold text-blue-600">-</div>
                  <div className="text-xs text-gray-500 mt-2">All-time across all assets</div>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="text-sm text-gray-600 mb-1">Grants Disbursed</div>
                  <div className="text-3xl font-bold text-green-600">-</div>
                  <div className="text-xs text-gray-500 mt-2">Executed governance proposals</div>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="text-sm text-gray-600 mb-1">Active Proposals</div>
                  <div className="text-3xl font-bold text-purple-600">-</div>
                  <div className="text-xs text-gray-500 mt-2">Currently in voting period</div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'sweeps' && <FeeSweepHistory />}

          {activeTab === 'grants' && <GrantDisbursements />}

          {activeTab === 'governance' && (
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold mb-4">Governance Outcomes</h2>
              <div className="text-gray-500 text-center py-8">
                Governance outcomes component (to be implemented)
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-center text-sm text-gray-600">
            <div>
              <a
                href="https://github.com/Creed1759/Kora-Contract"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-600"
              >
                Kora Protocol
              </a>
              {' • '}
              <a
                href="https://docs.kora.finance"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-600"
              >
                Documentation
              </a>
            </div>
            <div>
              All data sourced from Stellar blockchain
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
