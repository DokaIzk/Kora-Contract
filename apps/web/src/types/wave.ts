/**
 * Wave Contributor Dashboard Types
 * Tracks Wave-style contributor initiatives: issues claimed, PRs merged, points/rewards allocated, payout status
 */

export enum WaveIssueStatus {
  OPEN = 'open',
  CLAIMED = 'claimed',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}

export enum PayoutStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  DISBURSED = 'disbursed',
  REJECTED = 'rejected',
  NOT_ELIGIBLE = 'not_eligible',
}

export interface WaveIssue {
  id: string;
  issueNumber: number;
  title: string;
  description: string;
  complexity: 'Low' | 'Medium' | 'High';
  pointValue: number;
  status: WaveIssueStatus;
  claimedBy?: string;
  claimedAt?: Date;
  prNumber?: number;
  mergedAt?: Date;
  payoutStatus: PayoutStatus;
  grantProposalId?: number;
  disbursementTxHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Contributor {
  address: string;
  githubUsername?: string;
  totalIssues: number;
  completedIssues: number;
  totalPoints: number;
  totalPayout: number;
  pendingPayout: number;
  joinedAt: Date;
}

export interface GrantDisbursement {
  proposalId: number;
  recipient: string;
  amount: number;
  token: string;
  issueNumber: number;
  txHash: string;
  timestamp: Date;
}

export interface WaveStats {
  totalIssues: number;
  openIssues: number;
  claimedIssues: number;
  completedIssues: number;
  totalPointsAllocated: number;
  totalDisbursed: number;
  activeContributors: number;
}
