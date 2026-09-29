import { Keypair } from '@stellar/stellar-sdk';
import { createHash } from 'node:crypto';

export type VoteChoice = 'for' | 'against';
export type Vote = { proposalId: string; voter: string; choice: VoteChoice; weight: bigint; signature: string };
export type VotingRules = { quorum: bigint; thresholdBps: number; votingEndsAt: number; executeFromResult: boolean };
export type Tally = { for: bigint; against: bigint; total: bigint; passed: boolean };

export interface GovernanceSource {
  votingWeight(proposalId: string, voter: string): Promise<bigint>;
  rules(proposalId: string): Promise<VotingRules>;
  onChainVotingOpen(proposalId: string): Promise<boolean>;
  offchainVotingEnabled(proposalId: string): Promise<boolean>;
  anchorResult(proposalId: string, summaryHash: string, summary: Tally): Promise<void>;
  executeGovernanceProposal(proposalId: string, summaryHash: string): Promise<void>;
}

export interface VoteStore {
  reserveMode(proposalId: string, mode: 'onchain' | 'offchain'): Promise<boolean>;
  recordVoteIfAbsent(vote: Vote): Promise<boolean>;
  votes(proposalId: string): Promise<Vote[]>;
}

export class MemoryVoteStore implements VoteStore {
  private readonly modes = new Map<string, 'onchain' | 'offchain'>();
  private readonly entries = new Map<string, Vote>();

  async reserveMode(proposalId: string, mode: 'onchain' | 'offchain'): Promise<boolean> {
    const existing = this.modes.get(proposalId);
    if (existing && existing !== mode) return false;
    this.modes.set(proposalId, mode);
    return true;
  }

  async recordVoteIfAbsent(vote: Vote): Promise<boolean> {
    const key = `${vote.proposalId}:${vote.voter}`;
    if (this.entries.has(key)) return false;
    this.entries.set(key, vote);
    return true;
  }

  async votes(proposalId: string): Promise<Vote[]> {
    return [...this.entries.values()].filter((vote) => vote.proposalId === proposalId);
  }
}

export function voteMessage(chainId: string, proposalId: string, voter: string, choice: VoteChoice): Buffer {
  return Buffer.from(`KORA_OFFCHAIN_VOTE_V1\n${chainId}\n${proposalId}\n${voter}\n${choice}`, 'utf8');
}

export class OffchainVotingService {
  constructor(
    private readonly chainId: string,
    private readonly source: GovernanceSource,
    private readonly store: VoteStore,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async open(proposalId: string): Promise<void> {
    if (await this.source.onChainVotingOpen(proposalId) || !(await this.source.offchainVotingEnabled(proposalId))) {
      throw new Error('Proposal is not designated for off-chain voting');
    }
    if (!(await this.store.reserveMode(proposalId, 'offchain'))) throw new Error('Proposal already uses another voting path');
  }

  async cast(proposalId: string, voter: string, choice: VoteChoice, signature: string): Promise<Vote> {
    if (await this.source.onChainVotingOpen(proposalId) || !(await this.source.offchainVotingEnabled(proposalId))) {
      throw new Error('Proposal is not designated for off-chain voting');
    }
    if (!(await this.store.reserveMode(proposalId, 'offchain'))) throw new Error('Proposal already uses another voting path');
    const rules = await this.source.rules(proposalId);
    if (this.now() >= rules.votingEndsAt) throw new Error('Voting is closed');
    const weight = await this.source.votingWeight(proposalId, voter);
    if (weight <= 0n) throw new Error('Voter is not eligible');
    const message = voteMessage(this.chainId, proposalId, voter, choice);
    let valid = false;
    try {
      valid = Keypair.fromPublicKey(voter).verify(message, Buffer.from(signature, 'base64'));
    } catch {
      valid = false;
    }
    if (!valid) throw new Error('Invalid vote signature');
    const vote = { proposalId, voter, choice, weight, signature };
    if (!(await this.store.recordVoteIfAbsent(vote))) throw new Error('Already voted');
    return vote;
  }

  async finalize(proposalId: string): Promise<{ summary: Tally; hash: string }> {
    const rules = await this.source.rules(proposalId);
    if (this.now() < rules.votingEndsAt) throw new Error('Voting is still open');
    const summary = (await this.store.votes(proposalId)).reduce<Tally>((tally, vote) => {
      tally[vote.choice] += vote.weight;
      tally.total += vote.weight;
      return tally;
    }, { for: 0n, against: 0n, total: 0n, passed: false });
    summary.passed = summary.total >= rules.quorum && summary.total > 0n
      && (summary.for * 10_000n) / summary.total >= BigInt(rules.thresholdBps);
    const canonical = `${proposalId}:${summary.for}:${summary.against}:${summary.total}:${summary.passed}`;
    const hash = createHash('sha256').update(canonical).digest('hex');
    await this.source.anchorResult(proposalId, hash, summary);
    if (summary.passed && rules.executeFromResult) {
      await this.source.executeGovernanceProposal(proposalId, hash);
    }
    return { summary, hash };
  }
}