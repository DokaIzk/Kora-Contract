#![no_std]

use kora_shared::timelock::propose_upgrade;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum GovernanceError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InsufficientStake = 4,
    ProposalNotFound = 5,
    ProposalClosed = 6,
    ProposalNotPassed = 7,
    AlreadyVoted = 8,
    TargetChangedOrStale = 9,
    ArithmeticOverflow = 10,
    InvalidVotingMode = 11,
    ResultAlreadyAnchored = 12,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Active,
    Passed,
    Failed,
    Executed,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VotingMode {
    OnChain,
    OffChain,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OffchainResult {
    pub votes_for: i128,
    pub votes_against: i128,
    pub summary_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalType {
    Standard,
    FastTrack,
}

/// Fast-track proposal for critical security fixes.
/// Requires higher threshold but shorter timelock than standard proposals.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FastTrackProposal {
    pub id: u64,
    pub proposer: Address,
    pub action_hash: BytesN<32>,
    pub target_contract: Address,
    pub bug_bounty_report_id: u64,  // Link to confirmed critical bug report
    pub votes_for: i128,
    pub votes_against: i128,
    pub voting_end_time: u64,
    pub status: ProposalStatus,
    pub initial_target_hash: BytesN<32>,
    pub proposal_size_bytes: u32,   // Enforces minimal scope
    pub created_at: u64,
    pub disclosure_published: bool,  // Post-hoc disclosure requirement
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GovProposal {
    pub id: u64,
    pub proposer: Address,
    pub action_hash: BytesN<32>,
    pub target_contract: Address,
    pub votes_for: i128,
    pub votes_against: i128,
    pub voting_end_time: u64,
    pub status: ProposalStatus,
    pub initial_target_hash: BytesN<32>,
    pub voting_mode: VotingMode,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    AccessControl,
    MinStakeToPropose,
    Quorum,
    ThresholdBps,
    VotingDuration,
    Proposal(u64),
    ProposalCount,
    Voted(u64, Address),
    StakedBalance(Address),
    TargetCurrentHash(Address),
    OffchainResult(u64),
}

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        access_control: Address,
        min_stake: i128,
        quorum: i128,
        threshold_bps: u32,
        voting_duration: u64,
    ) -> Result<(), GovernanceError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(GovernanceError::AlreadyInitialized);
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::AccessControl, &access_control);
        env.storage().persistent().set(&DataKey::MinStakeToPropose, &min_stake);
        env.storage().persistent().set(&DataKey::Quorum, &quorum);
        env.storage().persistent().set(&DataKey::ThresholdBps, &threshold_bps);
        env.storage().persistent().set(&DataKey::VotingDuration, &voting_duration);
        env.storage().persistent().set(&DataKey::ProposalCount, &0u64);
        Ok(())
    }

    pub fn set_stake(env: Env, voter: Address, amount: i128) -> Result<(), GovernanceError> {
        let admin: Address = env.storage().persistent().get(&DataKey::Admin).ok_or(GovernanceError::NotInitialized)?;
        admin.require_auth();
        env.storage().persistent().set(&DataKey::StakedBalance(voter), &amount);
        Ok(())
    }

    pub fn set_target_hash(env: Env, target: Address, hash: BytesN<32>) -> Result<(), GovernanceError> {
        let admin: Address = env.storage().persistent().get(&DataKey::Admin).ok_or(GovernanceError::NotInitialized)?;
        admin.require_auth();
        env.storage().persistent().set(&DataKey::TargetCurrentHash(target), &hash);
        Ok(())
    }

    pub fn create_proposal(
        env: Env,
        proposer: Address,
        target_contract: Address,
        action_hash: BytesN<32>,
    ) -> Result<u64, GovernanceError> {
        proposer.require_auth();

        let min_stake: i128 = env.storage().persistent().get(&DataKey::MinStakeToPropose).unwrap_or(0);
        let proposer_stake: i128 = env.storage().persistent().get(&DataKey::StakedBalance(proposer.clone())).unwrap_or(0);

        if proposer_stake < min_stake {
            return Err(GovernanceError::InsufficientStake);
        }

        let voting_duration: u64 = env.storage().persistent().get(&DataKey::VotingDuration).unwrap_or(86400);
        let mut count: u64 = env.storage().persistent().get(&DataKey::ProposalCount).unwrap_or(0);
        count += 1;

        let current_target_hash: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::TargetCurrentHash(target_contract.clone()))
            .unwrap_or(BytesN::from_array(&env, &[0u8; 32]));

        let prop = GovProposal {
            id: count,
            proposer,
            action_hash,
            target_contract,
            votes_for: 0,
            votes_against: 0,
            voting_end_time: env.ledger().timestamp() + voting_duration,
            status: ProposalStatus::Active,
            initial_target_hash: current_target_hash,
            voting_mode: VotingMode::OnChain,
        };

        env.storage().persistent().set(&DataKey::Proposal(count), &prop);
        env.storage().persistent().set(&DataKey::ProposalCount, &count);

        Ok(count)
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<GovProposal, GovernanceError> {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(GovernanceError::ProposalNotFound)
    }

    pub fn designate_offchain_voting(env: Env, proposal_id: u64) -> Result<(), GovernanceError> {
        let admin: Address = env.storage().persistent().get(&DataKey::Admin).ok_or(GovernanceError::NotInitialized)?;
        admin.require_auth();
        let mut prop: GovProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(GovernanceError::ProposalNotFound)?;
        if prop.status != ProposalStatus::Active
            || prop.votes_for != 0
            || prop.votes_against != 0
            || prop.voting_mode != VotingMode::OnChain
        {
            return Err(GovernanceError::InvalidVotingMode);
        }
        prop.voting_mode = VotingMode::OffChain;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &prop);
        Ok(())
    }

    pub fn anchor_offchain_result(
        env: Env,
        proposal_id: u64,
        votes_for: i128,
        votes_against: i128,
        summary_hash: BytesN<32>,
    ) -> Result<(), GovernanceError> {
        let admin: Address = env.storage().persistent().get(&DataKey::Admin).ok_or(GovernanceError::NotInitialized)?;
        admin.require_auth();
        let prop: GovProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(GovernanceError::ProposalNotFound)?;
        if prop.status != ProposalStatus::Active
            || prop.voting_mode != VotingMode::OffChain
            || env.ledger().timestamp() < prop.voting_end_time
        {
            return Err(GovernanceError::InvalidVotingMode);
        }
        if votes_for < 0 || votes_against < 0 {
            return Err(GovernanceError::ProposalNotPassed);
        }
        let result_key = DataKey::OffchainResult(proposal_id);
        if env.storage().persistent().has(&result_key) {
            return Err(GovernanceError::ResultAlreadyAnchored);
        }
        env.storage().persistent().set(
            &result_key,
            &OffchainResult { votes_for, votes_against, summary_hash },
        );
        Ok(())
    }

    pub fn get_offchain_result(env: Env, proposal_id: u64) -> Option<OffchainResult> {
        env.storage().persistent().get(&DataKey::OffchainResult(proposal_id))
    }

    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool) -> Result<(), GovernanceError> {
        voter.require_auth();

        let mut prop: GovProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(GovernanceError::ProposalNotFound)?;

        if prop.status != ProposalStatus::Active || env.ledger().timestamp() >= prop.voting_end_time {
            return Err(GovernanceError::ProposalClosed);
        }
        if prop.voting_mode != VotingMode::OnChain {
            return Err(GovernanceError::InvalidVotingMode);
        }

        if env.storage().persistent().has(&DataKey::Voted(proposal_id, voter.clone())) {
            return Err(GovernanceError::AlreadyVoted);
        }

        let weight: i128 = env.storage().persistent().get(&DataKey::StakedBalance(voter.clone())).unwrap_or(0);
        if weight <= 0 {
            return Err(GovernanceError::InsufficientStake);
        }

        if support {
            prop.votes_for = prop.votes_for.checked_add(weight).ok_or(GovernanceError::ArithmeticOverflow)?;
        } else {
            prop.votes_against = prop.votes_against.checked_add(weight).ok_or(GovernanceError::ArithmeticOverflow)?;
        }

        env.storage().persistent().set(&DataKey::Voted(proposal_id, voter), &true);
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &prop);

        Ok(())
    }

    pub fn execute_proposal(env: Env, proposal_id: u64) -> Result<(), GovernanceError> {
        let mut prop: GovProposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(GovernanceError::ProposalNotFound)?;

        if prop.status == ProposalStatus::Executed {
            return Ok(());
        }

        let (votes_for, votes_against) = match prop.voting_mode {
            VotingMode::OnChain => (prop.votes_for, prop.votes_against),
            VotingMode::OffChain => {
                let result: OffchainResult = env
                    .storage()
                    .persistent()
                    .get(&DataKey::OffchainResult(proposal_id))
                    .ok_or(GovernanceError::ProposalNotPassed)?;
                (result.votes_for, result.votes_against)
            }
        };
        let total_votes = votes_for.checked_add(votes_against).ok_or(GovernanceError::ArithmeticOverflow)?;
        let quorum: i128 = env.storage().persistent().get(&DataKey::Quorum).unwrap_or(0);
        let threshold_bps: u32 = env.storage().persistent().get(&DataKey::ThresholdBps).unwrap_or(5000);

        if total_votes < quorum {
            prop.status = ProposalStatus::Failed;
            env.storage().persistent().set(&DataKey::Proposal(proposal_id), &prop);
            return Err(GovernanceError::ProposalNotPassed);
        }

        let approval_bps = votes_for.checked_mul(10000).ok_or(GovernanceError::ArithmeticOverflow)? / total_votes;
        if approval_bps < threshold_bps as i128 {
            prop.status = ProposalStatus::Failed;
            env.storage().persistent().set(&DataKey::Proposal(proposal_id), &prop);
            return Err(GovernanceError::ProposalNotPassed);
        }

        // Safe failure check if target parameter was changed by another mechanism
        let current_target_hash: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::TargetCurrentHash(prop.target_contract.clone()))
            .unwrap_or(BytesN::from_array(&env, &[0u8; 32]));

        if current_target_hash != prop.initial_target_hash {
            prop.status = ProposalStatus::Failed;
            env.storage().persistent().set(&DataKey::Proposal(proposal_id), &prop);
            return Err(GovernanceError::TargetChangedOrStale);
        }

        prop.status = ProposalStatus::Passed;
        // Schedule in shared timelock mechanism
        propose_upgrade(&env, prop.proposer.clone(), prop.action_hash.clone());

        prop.status = ProposalStatus::Executed;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &prop);

        Ok(())
    }

    // ── Fast-Track Governance ─────────────────────────────────────────────────

    /// Configure fast-track governance parameters. Admin only.
    pub fn configure_fast_track(
        env: Env,
        admin: Address,
        enabled: bool,
        threshold_bps: u32,
        timelock_seconds: u64,
        max_proposal_size: u32,
    ) -> Result<(), GovernanceError> {
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).ok_or(GovernanceError::NotInitialized)?;
        admin.require_auth();
        if admin != stored_admin {
            return Err(GovernanceError::Unauthorized);
        }

        env.storage().persistent().set(&DataKey::FastTrackEnabled, &enabled);
        env.storage().persistent().set(&DataKey::FastTrackThresholdBps, &threshold_bps);
        env.storage().persistent().set(&DataKey::FastTrackTimelock, &timelock_seconds);
        env.storage().persistent().set(&DataKey::FastTrackMaxProposalSize, &max_proposal_size);

        Ok(())
    }

    /// Register a critical bug bounty report (called by bug bounty system). Admin only.
    pub fn register_critical_bug_report(
        env: Env,
        admin: Address,
        report_id: u64,
    ) -> Result<(), GovernanceError> {
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).ok_or(GovernanceError::NotInitialized)?;
        admin.require_auth();
        if admin != stored_admin {
            return Err(GovernanceError::Unauthorized);
        }

        env.storage().persistent().set(&DataKey::BugBountyReportSeverity(report_id), &true);
        Ok(())
    }

    /// Create a fast-track proposal for critical security fixes.
    /// 
    /// **Requirements:**
    /// - Must be linked to a confirmed critical bug bounty report
    /// - Proposal size must be within max_proposal_size limit
    /// - Fast-track must be enabled
    pub fn create_fast_track_proposal(
        env: Env,
        proposer: Address,
        target_contract: Address,
        action_hash: BytesN<32>,
        bug_bounty_report_id: u64,
        proposal_size_bytes: u32,
    ) -> Result<u64, GovernanceError> {
        proposer.require_auth();

        // Check fast-track is enabled
        let enabled: bool = env.storage().persistent().get(&DataKey::FastTrackEnabled).unwrap_or(false);
        if !enabled {
            return Err(GovernanceError::NotEligibleForFastTrack);
        }

        // Verify bug bounty report is registered as critical
        let is_critical: bool = env
            .storage()
            .persistent()
            .get(&DataKey::BugBountyReportSeverity(bug_bounty_report_id))
            .unwrap_or(false);
        if !is_critical {
            return Err(GovernanceError::NoBugBountyReportLinked);
        }

        // Check proposal size constraint
        let max_size: u32 = env.storage().persistent().get(&DataKey::FastTrackMaxProposalSize).unwrap_or(1000);
        if proposal_size_bytes > max_size {
            return Err(GovernanceError::ProposalTooLarge);
        }

        // Check proposer stake
        let min_stake: i128 = env.storage().persistent().get(&DataKey::MinStakeToPropose).unwrap_or(0);
        let proposer_stake: i128 = env.storage().persistent().get(&DataKey::StakedBalance(proposer.clone())).unwrap_or(0);
        if proposer_stake < min_stake {
            return Err(GovernanceError::InsufficientStake);
        }

        let mut count: u64 = env.storage().persistent().get(&DataKey::ProposalCount).unwrap_or(0);
        count += 1;

        let timelock: u64 = env.storage().persistent().get(&DataKey::FastTrackTimelock).unwrap_or(7200);

        let current_target_hash: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::TargetCurrentHash(target_contract.clone()))
            .unwrap_or(BytesN::from_array(&env, &[0u8; 32]));

        let fast_track_prop = FastTrackProposal {
            id: count,
            proposer,
            action_hash,
            target_contract,
            bug_bounty_report_id,
            votes_for: 0,
            votes_against: 0,
            voting_end_time: env.ledger().timestamp() + timelock,
            status: ProposalStatus::Active,
            initial_target_hash: current_target_hash,
            proposal_size_bytes,
            created_at: env.ledger().timestamp(),
            disclosure_published: false,
        };

        env.storage().persistent().set(&DataKey::FastTrackProposal(count), &fast_track_prop);
        env.storage().persistent().set(&DataKey::ProposalCount, &count);

        Ok(count)
    }

    /// Vote on a fast-track proposal (same voting mechanism as standard).
    pub fn vote_fast_track(
        env: Env,
        voter: Address,
        proposal_id: u64,
        support: bool,
    ) -> Result<(), GovernanceError> {
        voter.require_auth();

        let mut prop: FastTrackProposal = env
            .storage()
            .persistent()
            .get(&DataKey::FastTrackProposal(proposal_id))
            .ok_or(GovernanceError::ProposalNotFound)?;

        if prop.status != ProposalStatus::Active || env.ledger().timestamp() >= prop.voting_end_time {
            return Err(GovernanceError::ProposalClosed);
        }

        if env.storage().persistent().has(&DataKey::Voted(proposal_id, voter.clone())) {
            return Err(GovernanceError::AlreadyVoted);
        }

        let weight: i128 = env.storage().persistent().get(&DataKey::StakedBalance(voter.clone())).unwrap_or(0);
        if weight <= 0 {
            return Err(GovernanceError::InsufficientStake);
        }

        if support {
            prop.votes_for = prop.votes_for.checked_add(weight).ok_or(GovernanceError::ArithmeticOverflow)?;
        } else {
            prop.votes_against = prop.votes_against.checked_add(weight).ok_or(GovernanceError::ArithmeticOverflow)?;
        }

        env.storage().persistent().set(&DataKey::Voted(proposal_id, voter), &true);
        env.storage().persistent().set(&DataKey::FastTrackProposal(proposal_id), &prop);

        Ok(())
    }

    /// Execute a fast-track proposal with higher threshold and shorter timelock.
    pub fn execute_fast_track_proposal(env: Env, proposal_id: u64) -> Result<(), GovernanceError> {
        let mut prop: FastTrackProposal = env
            .storage()
            .persistent()
            .get(&DataKey::FastTrackProposal(proposal_id))
            .ok_or(GovernanceError::ProposalNotFound)?;

        if prop.status == ProposalStatus::Executed {
            return Ok(());
        }

        // Check fast-track timelock elapsed
        let timelock: u64 = env.storage().persistent().get(&DataKey::FastTrackTimelock).unwrap_or(7200);
        if env.ledger().timestamp() < prop.created_at + timelock {
            return Err(GovernanceError::FastTrackTimelockNotElapsed);
        }

        let total_votes = prop.votes_for + prop.votes_against;
        let quorum: i128 = env.storage().persistent().get(&DataKey::Quorum).unwrap_or(0);
        let fast_track_threshold: u32 = env.storage().persistent().get(&DataKey::FastTrackThresholdBps).unwrap_or(7500);

        if total_votes < quorum {
            prop.status = ProposalStatus::Failed;
            env.storage().persistent().set(&DataKey::FastTrackProposal(proposal_id), &prop);
            return Err(GovernanceError::ProposalNotPassed);
        }

        let approval_bps = (prop.votes_for * 10000) / total_votes;
        if approval_bps < fast_track_threshold as i128 {
            prop.status = ProposalStatus::Failed;
            env.storage().persistent().set(&DataKey::FastTrackProposal(proposal_id), &prop);
            return Err(GovernanceError::FastTrackThresholdNotMet);
        }

        // Verify target hasn't changed
        let current_target_hash: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::TargetCurrentHash(prop.target_contract.clone()))
            .unwrap_or(BytesN::from_array(&env, &[0u8; 32]));

        if current_target_hash != prop.initial_target_hash {
            prop.status = ProposalStatus::Failed;
            env.storage().persistent().set(&DataKey::FastTrackProposal(proposal_id), &prop);
            return Err(GovernanceError::TargetChangedOrStale);
        }

        prop.status = ProposalStatus::Executed;
        env.storage().persistent().set(&DataKey::FastTrackProposal(proposal_id), &prop);

        // Execute immediately (no standard timelock delay)
        propose_upgrade(&env, prop.proposer.clone(), prop.action_hash.clone());

        Ok(())
    }

    /// Mark fast-track proposal disclosure as published (mandatory post-hoc).
    pub fn publish_fast_track_disclosure(
        env: Env,
        admin: Address,
        proposal_id: u64,
    ) -> Result<(), GovernanceError> {
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).ok_or(GovernanceError::NotInitialized)?;
        admin.require_auth();
        if admin != stored_admin {
            return Err(GovernanceError::Unauthorized);
        }

        let mut prop: FastTrackProposal = env
            .storage()
            .persistent()
            .get(&DataKey::FastTrackProposal(proposal_id))
            .ok_or(GovernanceError::ProposalNotFound)?;

        prop.disclosure_published = true;
        env.storage().persistent().set(&DataKey::FastTrackProposal(proposal_id), &prop);

        Ok(())
    }

    /// Get fast-track proposal details.
    pub fn get_fast_track_proposal(env: Env, proposal_id: u64) -> Option<FastTrackProposal> {
        env.storage().persistent().get(&DataKey::FastTrackProposal(proposal_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger, LedgerInfo};
    use soroban_sdk::Env;

    #[test]
    fn test_governance_flow() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let acc_control = Address::generate(&env);
        let target = Address::generate(&env);
        let voter1 = Address::generate(&env);

        GovernanceContract::initialize(
            env.clone(),
            admin.clone(),
            acc_control,
            100,
            500,
            5000,
            86400,
        ).unwrap();

        GovernanceContract::set_stake(env.clone(), voter1.clone(), 1000).unwrap();

        let action_hash = BytesN::from_array(&env, &[1u8; 32]);
        let prop_id = GovernanceContract::create_proposal(env.clone(), voter1.clone(), target.clone(), action_hash.clone()).unwrap();

        GovernanceContract::vote(env.clone(), voter1.clone(), prop_id, true).unwrap();
        GovernanceContract::execute_proposal(env.clone(), prop_id).unwrap();

        let prop: GovProposal = env.storage().persistent().get(&DataKey::Proposal(prop_id)).unwrap();
        assert_eq!(prop.status, ProposalStatus::Executed);
    }

    #[test]
    fn offchain_path_anchors_once_and_executes_anchored_tally() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set(LedgerInfo {
            timestamp: 100,
            protocol_version: 21,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1_000,
            min_persistent_entry_ttl: 1_000,
            max_entry_ttl: 1_000_000,
        });
        let admin = Address::generate(&env);
        let voter = Address::generate(&env);
        let target = Address::generate(&env);
        GovernanceContract::initialize(
            env.clone(),
            admin.clone(),
            Address::generate(&env),
            1,
            10,
            5_000,
            10,
        ).unwrap();
        GovernanceContract::set_stake(env.clone(), voter.clone(), 100).unwrap();
        let proposal_id = GovernanceContract::create_proposal(
            env.clone(),
            voter.clone(),
            target,
            BytesN::from_array(&env, &[1u8; 32]),
        ).unwrap();
        GovernanceContract::designate_offchain_voting(env.clone(), proposal_id).unwrap();
        assert!(GovernanceContract::vote(env.clone(), voter, proposal_id, true).is_err());

        env.ledger().set(LedgerInfo {
            timestamp: 110,
            protocol_version: 21,
            sequence_number: 2,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1_000,
            min_persistent_entry_ttl: 1_000,
            max_entry_ttl: 1_000_000,
        });
        let hash = BytesN::from_array(&env, &[2u8; 32]);
        GovernanceContract::anchor_offchain_result(env.clone(), proposal_id, 100, 0, hash.clone()).unwrap();
        assert!(GovernanceContract::anchor_offchain_result(
            env.clone(), proposal_id, 100, 0, hash.clone()
        ).is_err());
        GovernanceContract::execute_proposal(env.clone(), proposal_id).unwrap();
        let result = GovernanceContract::get_offchain_result(env.clone(), proposal_id).unwrap();
        assert_eq!(result.summary_hash, hash);
        let proposal: GovProposal = env.storage().persistent().get(&DataKey::Proposal(proposal_id)).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Executed);
    }
}
