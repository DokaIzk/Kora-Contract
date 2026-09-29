/**
 * Treasury API Client
 * 
 * Fetches treasury data from the analytics service backend.
 * All data is read-only and publicly accessible.
 */

import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

export interface TokenBalance {
  asset: string;
  assetCode: string;
  balance: string;
  balanceFormatted: string;
  usdValue?: string;
  contractAddress: string;
  lastUpdated: number;
}

export interface FeeSweep {
  id: string;
  timestamp: number;
  source: string;
  asset: string;
  amount: string;
  amountFormatted: string;
  txHash: string;
  blockExplorerUrl: string;
}

export interface GrantDisbursement {
  id: string;
  timestamp: number;
  recipient: string;
  recipientLabel?: string;
  purpose: string;
  asset: string;
  amount: string;
  amountFormatted: string;
  proposalId?: number;
  proposalUrl?: string;
  txHash: string;
  blockExplorerUrl: string;
  status: 'executed' | 'pending' | 'failed';
}

export interface GovernanceOutcome {
  proposalId: number;
  title: string;
  proposalType: string;
  votingMode: string;
  votesFor: string;
  votesAgainst: string;
  votesAbstain: string;
  quorumRequired: string;
  outcome: 'passed' | 'failed' | 'pending';
  executed: boolean;
  createdAt: number;
  expiresAt: number;
  executedAt?: number;
  forumUrl?: string;
  txHash?: string;
  blockExplorerUrl?: string;
}

export interface TreasuryStats {
  totalValueUsd?: string;
  totalFeesCollected: string;
  totalGrantsDisbursed: string;
  activeProposals: number;
  executedProposals: number;
}

class TreasuryApiClient {
  private api: AxiosInstance;

  constructor(baseUrl: string = API_BASE_URL) {
    this.api = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get current treasury balances across all assets
   */
  async getBalances(): Promise<TokenBalance[]> {
    const response = await this.api.get<TokenBalance[]>('/treasury/balances');
    return response.data;
  }

  /**
   * Get fee sweep history with pagination
   */
  async getFeeSweeps(params?: {
    limit?: number;
    offset?: number;
    asset?: string;
    fromDate?: number;
    toDate?: number;
  }): Promise<{ sweeps: FeeSweep[]; total: number }> {
    const response = await this.api.get('/treasury/fee-sweeps', { params });
    return response.data;
  }

  /**
   * Get grant disbursement history
   */
  async getGrants(params?: {
    limit?: number;
    offset?: number;
    status?: string;
    fromDate?: number;
    toDate?: number;
  }): Promise<{ grants: GrantDisbursement[]; total: number }> {
    const response = await this.api.get('/treasury/grants', { params });
    return response.data;
  }

  /**
   * Get governance proposal outcomes affecting treasury
   */
  async getGovernanceOutcomes(params?: {
    limit?: number;
    offset?: number;
    outcome?: string;
  }): Promise<{ proposals: GovernanceOutcome[]; total: number }> {
    const response = await this.api.get('/treasury/governance', { params });
    return response.data;
  }

  /**
   * Get treasury statistics summary
   */
  async getStats(): Promise<TreasuryStats> {
    const response = await this.api.get<TreasuryStats>('/treasury/stats');
    return response.data;
  }

  /**
   * Get fee sweep by transaction hash
   */
  async getFeeSweepByTxHash(txHash: string): Promise<FeeSweep> {
    const response = await this.api.get<FeeSweep>(`/treasury/fee-sweeps/${txHash}`);
    return response.data;
  }

  /**
   * Get grant disbursement by ID
   */
  async getGrantById(id: string): Promise<GrantDisbursement> {
    const response = await this.api.get<GrantDisbursement>(`/treasury/grants/${id}`);
    return response.data;
  }

  /**
   * Get governance proposal by ID
   */
  async getProposalById(id: number): Promise<GovernanceOutcome> {
    const response = await this.api.get<GovernanceOutcome>(`/treasury/governance/${id}`);
    return response.data;
  }
}

// Export singleton instance
export const treasuryApi = new TreasuryApiClient();

// Export class for testing
export { TreasuryApiClient };
