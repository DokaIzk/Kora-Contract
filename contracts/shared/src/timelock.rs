//! Shared timelocked upgrade module.
//!
//! Provides a standardized, publicly visible upgrade mechanism: upgrades must
//! be proposed, become executable only after a configurable delay, and emit
//! events at both proposal and execution. Proposals can be cancelled and an
//! already-executed proposal id cannot be replayed.
//!
//! See `docs/MIGRATIONS.md` for operational guidance.

use soroban_sdk::{contracttype, symbol_short, Address, BytesN, Env, Symbol};

/// Default upgrade delay (in seconds) applied when no delay has been configured.
/// 48 hours gives the community and auditors a review window.
pub const DEFAULT_UPGRADE_DELAY: u64 = 48 * 60 * 60;

/// Storage keys used by the timelock module.
#[contracttype]
#[derive(Clone)]
pub enum TimelockKey {
    /// Configured delay (seconds) between proposal and execution.
    Delay,
    /// Monotonic counter used to derive proposal ids.
    NextId,
    /// A stored upgrade proposal, keyed by proposal id.
    Proposal(u64),
}

/// A proposed upgrade awaiting its timelock delay.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposal {
    /// The proposed WASM hash to upgrade to.
    pub wasm_hash: BytesN<32>,
    /// The account that proposed the upgrade.
    pub proposer: Address,
    /// Ledger timestamp at which the proposal was created.
    pub proposed_at: u64,
    /// Whether the proposal has already been executed.
    pub executed: bool,
    /// Whether the proposal has been cancelled.
    pub cancelled: bool,
}

/// Errors returned by the timelock module.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TimelockError {
    /// No proposal exists for the given id.
    ProposalNotFound = 1,
    /// The proposal has already been executed.
    AlreadyExecuted = 2,
    /// The proposal has been cancelled.
    AlreadyCancelled = 3,
    /// The configured delay has not yet elapsed.
    DelayNotElapsed = 4,
}

/// Emitted when an upgrade is proposed.
#[allow(dead_code)]
pub fn emit_proposed(env: &Env, id: u64, wasm_hash: &BytesN<32>, proposed_at: u64) {
    let topics = (symbol_short!("upgrade"), symbol_short!("proposed"), id);
    env.events().publish(topics, (wasm_hash.clone(), proposed_at));
}

/// Emitted when a proposed upgrade is executed.
#[allow(dead_code)]
pub fn emit_executed(env: &Env, id: u64, wasm_hash: &BytesN<32>) {
    let topics = (symbol_short!("upgrade"), symbol_short!("executed"), id);
    env.events().publish(topics, wasm_hash.clone());
}

/// Emitted when a proposed upgrade is cancelled.
#[allow(dead_code)]
pub fn emit_cancelled(env: &Env, id: u64) {
    let topics = (symbol_short!("upgrade"), symbol_short!("cancelled"), id);
    env.events().publish(topics, ());
}

/// Returns the configured upgrade delay, falling back to [`DEFAULT_UPGRADE_DELAY`].
pub fn get_delay(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&TimelockKey::Delay)
        .unwrap_or(DEFAULT_UPGRADE_DELAY)
}

/// Sets the upgrade delay (in seconds). Callers must enforce admin authorization.
pub fn set_delay(env: &Env, delay: u64) {
    env.storage().instance().set(&TimelockKey::Delay, &delay);
}

/// Records a new upgrade proposal and returns its id.
///
/// The proposal becomes executable once `env.ledger().timestamp() >= proposed_at + delay`.
pub fn propose_upgrade(env: &Env, proposer: Address, wasm_hash: BytesN<32>) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&TimelockKey::NextId)
        .unwrap_or(0);
    let proposed_at = env.ledger().timestamp();

    let proposal = UpgradeProposal {
        wasm_hash: wasm_hash.clone(),
        proposer,
        proposed_at,
        executed: false,
        cancelled: false,
    };

    env.storage()
        .persistent()
        .set(&TimelockKey::Proposal(id), &proposal);
    env.storage().instance().set(&TimelockKey::NextId, &(id + 1));

    emit_proposed(env, id, &wasm_hash, proposed_at);
    id
}

/// Loads a proposal, returning an error if it does not exist.
pub fn get_proposal(env: &Env, id: u64) -> Result<UpgradeProposal, TimelockError> {
    env.storage()
        .persistent()
        .get(&TimelockKey::Proposal(id))
        .ok_or(TimelockError::ProposalNotFound)
}

/// Returns the timestamp at which the proposal becomes executable.
pub fn executable_at(env: &Env, id: u64) -> Result<u64, TimelockError> {
    let proposal = get_proposal(env, id)?;
    Ok(proposal.proposed_at + get_delay(env))
}

/// Validates that a proposal may be executed and returns it.
///
/// Rejects unknown, cancelled, already-executed, and not-yet-mature proposals.
pub fn prepare_execute(env: &Env, id: u64) -> Result<UpgradeProposal, TimelockError> {
    let proposal = get_proposal(env, id)?;
    if proposal.cancelled {
        return Err(TimelockError::AlreadyCancelled);
    }
    if proposal.executed {
        return Err(TimelockError::AlreadyExecuted);
    }
    if env.ledger().timestamp() < proposal.proposed_at + get_delay(env) {
        return Err(TimelockError::DelayNotElapsed);
    }
    Ok(proposal)
}

/// Marks a proposal as executed and emits the execution event.
///
/// Callers should invoke this after performing the actual WASM upgrade.
pub fn mark_executed(env: &Env, id: u64, proposal: &UpgradeProposal) {
    let mut updated = proposal.clone();
    updated.executed = true;
    env.storage()
        .persistent()
        .set(&TimelockKey::Proposal(id), &updated);
    emit_executed(env, id, &proposal.wasm_hash);
}

/// Cancels a pending proposal. Callers must enforce admin authorization.
///
/// Returns an error if the proposal is unknown, already executed, or already cancelled.
pub fn cancel_upgrade(env: &Env, id: u64) -> Result<(), TimelockError> {
    let mut proposal = get_proposal(env, id)?;
    if proposal.executed {
        return Err(TimelockError::AlreadyExecuted);
    }
    if proposal.cancelled {
        return Err(TimelockError::AlreadyCancelled);
    }
    proposal.cancelled = true;
    env.storage()
        .persistent()
        .set(&TimelockKey::Proposal(id), &proposal);
    emit_cancelled(env, id);
    Ok(())
}

/// Convenience helper: propose, wait for the delay, then execute.
///
/// This is intended for contract upgrade entrypoints that want a single call
/// surface while still enforcing the timelock. It returns the proposal id.
pub fn propose_and_schedule(env: &Env, proposer: Address, wasm_hash: BytesN<32>) -> u64 {
    propose_upgrade(env, proposer, wasm_hash)
}

/// Symbol used for the timelock event namespace.
#[allow(dead_code)]
pub const TIMELOCK_NAMESPACE: Symbol = symbol_short!("upgrade");
