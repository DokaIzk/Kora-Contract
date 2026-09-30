#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env, Vec};

const MAX_NOMINATIONS: u64 = 50;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum NominationError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAdmin = 3,
    InvalidAmount = 4,
    NotFound = 5,
    Closed = 6,
    StakeCapExceeded = 7,
    NotStale = 8,
    NotNominee = 9,
    NoEligibleCandidate = 10,
    TooManyNominations = 11,
    ArithmeticOverflow = 12,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NominationStatus {
    Open,
    Selected,
    Accepted,
    Declined,
    Expired,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Nomination {
    pub id: u64,
    pub candidate: Address,
    pub total_stake: i128,
    pub created_at: u64,
    pub selected_at: u64,
    pub status: NominationStatus,
    pub supporters: Vec<Address>,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Token,
    MinimumStake,
    PerAddressCap,
    Window,
    NextId,
    Nomination(u64),
    Stake(u64, Address),
}

#[contract]
pub struct VerifierNominationContract;

#[contractimpl]
impl VerifierNominationContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        token_address: Address,
        minimum_stake: i128,
        per_address_cap: i128,
        nomination_window: u64,
    ) -> Result<(), NominationError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(NominationError::AlreadyInitialized);
        }
        if minimum_stake <= 0 || per_address_cap < minimum_stake || nomination_window == 0 {
            return Err(NominationError::InvalidAmount);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token_address);
        env.storage().instance().set(&DataKey::MinimumStake, &minimum_stake);
        env.storage().instance().set(&DataKey::PerAddressCap, &per_address_cap);
        env.storage().instance().set(&DataKey::Window, &nomination_window);
        env.storage().instance().set(&DataKey::NextId, &0u64);
        Ok(())
    }

    pub fn nominate(
        env: Env,
        supporter: Address,
        candidate: Address,
        amount: i128,
    ) -> Result<u64, NominationError> {
        supporter.require_auth();
        let id: u64 = env.storage().instance().get(&DataKey::NextId).ok_or(NominationError::NotInitialized)?;
        if id >= MAX_NOMINATIONS {
            return Err(NominationError::TooManyNominations);
        }
        let next_id = id.checked_add(1).ok_or(NominationError::ArithmeticOverflow)?;
        let nomination = Nomination {
            id,
            candidate,
            total_stake: 0,
            created_at: env.ledger().timestamp(),
            selected_at: 0,
            status: NominationStatus::Open,
            supporters: Vec::new(&env),
        };
        env.storage().persistent().set(&DataKey::Nomination(id), &nomination);
        env.storage().instance().set(&DataKey::NextId, &next_id);
        Self::stake_internal(&env, id, &supporter, amount)?;
        Ok(id)
    }

    pub fn stake(env: Env, supporter: Address, nomination_id: u64, amount: i128) -> Result<(), NominationError> {
        supporter.require_auth();
        Self::stake_internal(&env, nomination_id, &supporter, amount)
    }

    pub fn select_candidate(env: Env) -> Result<u64, NominationError> {
        let count: u64 = env.storage().instance().get(&DataKey::NextId).ok_or(NominationError::NotInitialized)?;
        let minimum_stake: i128 = env.storage().instance().get(&DataKey::MinimumStake).unwrap_or(0);
        let window: u64 = env.storage().instance().get(&DataKey::Window).unwrap_or(0);
        let now = env.ledger().timestamp();
        let mut winner: Option<Nomination> = None;
        for id in 0..count {
            let Some(nomination) = env.storage().persistent().get::<_, Nomination>(&DataKey::Nomination(id)) else {
                continue;
            };
            if nomination.status != NominationStatus::Open
                || nomination.total_stake < minimum_stake
                || now >= nomination.created_at.saturating_add(window)
            {
                continue;
            }
            if winner.as_ref().map_or(true, |current| nomination.total_stake > current.total_stake) {
                winner = Some(nomination);
            }
        }
        let mut selected = winner.ok_or(NominationError::NoEligibleCandidate)?;
        selected.status = NominationStatus::Selected;
        selected.selected_at = now;
        env.storage().persistent().set(&DataKey::Nomination(selected.id), &selected);
        Ok(selected.id)
    }

    pub fn accept_onboarding(env: Env, candidate: Address, nomination_id: u64) -> Result<(), NominationError> {
        candidate.require_auth();
        let mut nomination = Self::load(&env, nomination_id)?;
        if nomination.candidate != candidate {
            return Err(NominationError::NotNominee);
        }
        if nomination.status != NominationStatus::Selected {
            return Err(NominationError::Closed);
        }
        nomination.status = NominationStatus::Accepted;
        env.storage().persistent().set(&DataKey::Nomination(nomination_id), &nomination);
        Ok(())
    }

    pub fn decline_onboarding(env: Env, candidate: Address, nomination_id: u64) -> Result<(), NominationError> {
        candidate.require_auth();
        let mut nomination = Self::load(&env, nomination_id)?;
        if nomination.candidate != candidate {
            return Err(NominationError::NotNominee);
        }
        if nomination.status != NominationStatus::Selected {
            return Err(NominationError::Closed);
        }
        nomination.status = NominationStatus::Declined;
        env.storage().persistent().set(&DataKey::Nomination(nomination_id), &nomination);
        Ok(())
    }

    pub fn withdraw(env: Env, supporter: Address, nomination_id: u64) -> Result<i128, NominationError> {
        supporter.require_auth();
        let nomination = Self::load(&env, nomination_id)?;
        let window: u64 = env.storage().instance().get(&DataKey::Window).unwrap_or(0);
        let stale = nomination.status == NominationStatus::Open
            && env.ledger().timestamp() >= nomination.created_at.saturating_add(window);
        let declined = nomination.status == NominationStatus::Declined;
        let selection_expired = (nomination.status == NominationStatus::Selected
            || nomination.status == NominationStatus::Accepted)
            && env.ledger().timestamp() >= nomination.selected_at.saturating_add(window);
        let already_expired = nomination.status == NominationStatus::Expired;
        if !stale && !declined && !selection_expired && !already_expired {
            return Err(NominationError::NotStale);
        }
        let amount: i128 = env.storage().persistent().get(&DataKey::Stake(nomination_id, supporter.clone())).unwrap_or(0);
        if amount <= 0 {
            return Err(NominationError::InvalidAmount);
        }
        env.storage().persistent().remove(&DataKey::Stake(nomination_id, supporter.clone()));
        let mut updated = nomination;
        updated.total_stake -= amount;
        if stale || selection_expired {
            updated.status = NominationStatus::Expired;
        }
        env.storage().persistent().set(&DataKey::Nomination(nomination_id), &updated);
        let token_address: Address = env.storage().instance().get(&DataKey::Token).ok_or(NominationError::NotInitialized)?;
        token::Client::new(&env, &token_address).transfer(&env.current_contract_address(), &supporter, &amount);
        Ok(amount)
    }

    pub fn get_nomination(env: Env, nomination_id: u64) -> Result<Nomination, NominationError> {
        Self::load(&env, nomination_id)
    }

    pub fn get_stake(env: Env, nomination_id: u64, supporter: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Stake(nomination_id, supporter)).unwrap_or(0)
    }

    pub fn is_eligible(env: Env, nomination_id: u64) -> bool {
        Self::load(&env, nomination_id).map(|n| n.status == NominationStatus::Accepted).unwrap_or(false)
    }

    fn stake_internal(env: &Env, nomination_id: u64, supporter: &Address, amount: i128) -> Result<(), NominationError> {
        if amount <= 0 {
            return Err(NominationError::InvalidAmount);
        }
        let mut nomination = Self::load(env, nomination_id)?;
        if nomination.status != NominationStatus::Open {
            return Err(NominationError::Closed);
        }
        let window: u64 = env.storage().instance().get(&DataKey::Window).unwrap_or(0);
        if env.ledger().timestamp() >= nomination.created_at.saturating_add(window) {
            return Err(NominationError::Closed);
        }
        let cap: i128 = env.storage().instance().get(&DataKey::PerAddressCap).unwrap_or(0);
        let current: i128 = env.storage().persistent().get(&DataKey::Stake(nomination_id, supporter.clone())).unwrap_or(0);
        let new_stake = current.checked_add(amount).ok_or(NominationError::ArithmeticOverflow)?;
        if new_stake > cap {
            return Err(NominationError::StakeCapExceeded);
        }
        nomination.total_stake = nomination.total_stake.checked_add(amount).ok_or(NominationError::ArithmeticOverflow)?;
        if current == 0 {
            nomination.supporters.push_back(supporter.clone());
        }
        let token_address: Address = env.storage().instance().get(&DataKey::Token).ok_or(NominationError::NotInitialized)?;
        token::Client::new(env, &token_address).transfer(supporter, &env.current_contract_address(), &amount);
        env.storage().persistent().set(&DataKey::Stake(nomination_id, supporter.clone()), &new_stake);
        env.storage().persistent().set(&DataKey::Nomination(nomination_id), &nomination);
        Ok(())
    }

    fn load(env: &Env, nomination_id: u64) -> Result<Nomination, NominationError> {
        env.storage().persistent().get(&DataKey::Nomination(nomination_id)).ok_or(NominationError::NotFound)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger, LedgerInfo}, Env};

    fn setup() -> (Env, Address, VerifierNominationContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
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
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register_contract(None, VerifierNominationContract);
        let client = VerifierNominationContractClient::new(&env, &contract_id);
        client.initialize(&admin, &token, &50, &100, &100);
        (env, token, client, admin)
    }

    fn fund(env: &Env, token: &Address, address: &Address) {
        token::StellarAssetClient::new(env, token).mint(address, &500);
    }

    #[test]
    fn enforces_per_address_cap_for_each_nomination() {
        let (env, token, client, _) = setup();
        let supporter = Address::generate(&env);
        let candidate = Address::generate(&env);
        fund(&env, &token, &supporter);
        let id = client.nominate(&supporter, &candidate, &60);
        assert!(client.try_stake(&supporter, &id, &41).is_err());
        client.stake(&supporter, &id, &40);
        assert_eq!(client.get_stake(&id, &supporter), 100);
    }

    #[test]
    fn permits_withdrawal_when_nomination_window_is_stale() {
        let (env, token, client, _) = setup();
        let supporter = Address::generate(&env);
        let candidate = Address::generate(&env);
        fund(&env, &token, &supporter);
        let id = client.nominate(&supporter, &candidate, &50);
        env.ledger().set(LedgerInfo {
            timestamp: 201,
            protocol_version: 21,
            sequence_number: 2,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1_000,
            min_persistent_entry_ttl: 1_000,
            max_entry_ttl: 1_000_000,
        });
        assert_eq!(client.withdraw(&supporter, &id), 50);
        assert_eq!(token::Client::new(&env, &token).balance(&supporter), 500);
    }

    #[test]
    fn declined_candidate_unlocks_support_and_accepted_candidate_does_not() {
        let (env, token, client, _) = setup();
        let supporter = Address::generate(&env);
        let candidate = Address::generate(&env);
        fund(&env, &token, &supporter);
        let id = client.nominate(&supporter, &candidate, &50);
        client.select_candidate();
        client.accept_onboarding(&candidate, &id);
        assert!(client.try_withdraw(&supporter, &id).is_err());
        // A declined selection releases support immediately.
        let other_candidate = Address::generate(&env);
        let other_id = client.nominate(&supporter, &other_candidate, &50);
        // The first nomination was accepted, so the second is selected from the remaining open set.
        client.select_candidate();
        client.decline_onboarding(&other_candidate, &other_id);
        assert_eq!(client.withdraw(&supporter, &other_id), 50);
    }
}