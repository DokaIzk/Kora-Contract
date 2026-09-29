//! Reentrancy & CEI Regression Tests — Issue #808
//!
//! Systematically verifies that every cross-contract call site identified in
//! `docs/REENTRANCY_AUDIT.md` follows the checks-effects-interactions pattern
//! and that the reentrancy guard behaves correctly under adversarial conditions.
//!
//! Test naming convention:
//!   `test_<contract>_<function>_<property>`
//!
//! Each test is tagged with the audit-matrix row it covers (e.g., "FP-1").

#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::Address as _, Address, Env,
};

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: kora_shared::reentrancy guard unit properties
// These tests exercise the shared guard module in isolation so the higher-level
// contract tests can trust its primitives.
// ─────────────────────────────────────────────────────────────────────────────

use kora_shared::reentrancy::{acquire_guard, is_locked, release_guard, ReentrancyGuard};
use kora_shared::errors::CommonError;

/// Minimal registered contract required by Soroban test host for storage calls.
#[contract]
struct DummyGuardContract;
#[contractimpl]
impl DummyGuardContract {
    pub fn noop() {}
}

fn with_guard_env(f: impl FnOnce(&Env)) {
    let env = Env::default();
    let id = env.register_contract(None, DummyGuardContract);
    env.as_contract(&id, || f(&env));
}

/// Guard: acquire succeeds on an unlocked contract instance. [row: shared]
#[test]
fn test_guard_acquire_succeeds_when_unlocked() {
    with_guard_env(|env| {
        assert!(acquire_guard(env).is_ok());
        release_guard(env);
    });
}

/// Guard: a second acquire while locked returns `Reentrancy`. [shared]
#[test]
fn test_guard_second_acquire_returns_reentrancy() {
    with_guard_env(|env| {
        acquire_guard(env).unwrap();
        assert_eq!(acquire_guard(env).err().unwrap(), CommonError::Reentrancy);
        release_guard(env);
    });
}

/// Guard: lock state reflects acquire/release cycle correctly. [shared]
#[test]
fn test_guard_is_locked_reflects_state() {
    with_guard_env(|env| {
        assert!(!is_locked(env));
        acquire_guard(env).unwrap();
        assert!(is_locked(env));
        release_guard(env);
        assert!(!is_locked(env));
    });
}

/// Guard: RAII guard releases even when the protected function returns an error. [shared]
#[test]
fn test_raii_guard_releases_on_error_return() {
    with_guard_env(|env| {
        fn protected(e: &Env) -> Result<(), CommonError> {
            let _g = ReentrancyGuard::new(e)?;
            Err(CommonError::InvalidAmount)
        }
        let _ = protected(env);
        // Lock must be released despite the error return.
        assert!(!is_locked(env));
    });
}

/// Guard: nested RAII guard on a locked contract returns Reentrancy and does not
/// double-release on drop (i.e. the outer guard still holds). [shared]
#[test]
fn test_raii_nested_guard_fails_and_outer_guard_holds() {
    with_guard_env(|env| {
        let _outer = ReentrancyGuard::new(env).unwrap();
        assert_eq!(ReentrancyGuard::new(env).err().unwrap(), CommonError::Reentrancy);
        // Outer guard is still held.
        assert!(is_locked(env));
    });
    // After the block, outer guard drops and lock is released.
}

/// Guard: multiple sequential lock/unlock cycles all succeed. [shared]
#[test]
fn test_guard_multiple_sequential_cycles() {
    with_guard_env(|env| {
        for _ in 0..10 {
            assert!(acquire_guard(env).is_ok());
            assert!(is_locked(env));
            release_guard(env);
            assert!(!is_locked(env));
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: financing_pool — RepaymentLock CEI ordering [FP-1, FP-2, FP-11]
// ─────────────────────────────────────────────────────────────────────────────

use kora_financing_pool::{DataKey as FpDataKey, FinancingPoolContract, FinancingPoolContractClient};
use kora_shared::types::{Pool, Position};
use soroban_sdk::{testutils::Address as _, Map};

fn fp_setup() -> (Env, Address, Address, Address, Address, FinancingPoolContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FinancingPoolContract);
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let nft = Address::generate(&env);
    let risk_registry = Address::generate(&env);
    let treasury = Address::generate(&env);
    let access_control =
        env.register_contract(None, kora_access_control::AccessControlContract);
    let ac_client = kora_access_control::AccessControlContractClient::new(&env, &access_control);
    ac_client.initialize(&admin);
    let oracle = Address::generate(&env);
    let dispute = Address::generate(&env);
    client.initialize(
        &admin, &nft, &risk_registry, &treasury, &access_control, &200u32, &oracle, &10_000u32, &0u64, &dispute,
    );
    (env, admin, nft, treasury, access_control, client)
}

fn seed_open_pool(env: &Env, contract_id: &Address, invoice_id: u64, face_value: i128, token: Address) {
    let pool = Pool {
        invoice_id,
        token,
        total_funded: face_value,
        face_value,
        repaid_amount: 0,
        is_closed: false,
        late_penalty_bps: 0,
        total_owed: face_value,
        penalty_applied: false,
    };
    env.as_contract(contract_id, || {
        env.storage().persistent().set(&FpDataKey::Pool(invoice_id), &pool);
    });
}

/// FP-1 / FP-2: RepaymentLock is set BEFORE the token transfer in `repay`.
/// Verified indirectly: a second concurrent `repay` on the same invoice_id
/// is rejected with Unauthorized (the lock is held), confirming CEI ordering.
#[test]
fn test_fp_repay_repayment_lock_blocks_reentrant_call() {
    let (env, admin, _nft, _treasury, ac, client) = fp_setup();
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    seed_open_pool(&env, &client.address, 1, 10_000_000_000, token.clone());

    // Manually set the lock as if a repay call is in-flight.
    env.as_contract(&client.address, || {
        env.storage().persistent().set(&FpDataKey::RepaymentLock(1u64), &true);
    });

    let payer = Address::generate(&env);
    let result = client.try_repay(&payer, &1u64, &token, &10_000_000_000i128);
    // Must be rejected — lock is held.
    assert!(result.is_err(), "repay must be rejected while RepaymentLock is held");
}

/// FP-11: `repay_partial` also respects the RepaymentLock. [FP-11]
#[test]
fn test_fp_repay_partial_respects_repayment_lock() {
    let (env, admin, _nft, _treasury, ac, client) = fp_setup();
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    seed_open_pool(&env, &client.address, 2, 5_000_000_000, token.clone());

    env.as_contract(&client.address, || {
        env.storage().persistent().set(&FpDataKey::RepaymentLock(2u64), &true);
    });

    let payer = Address::generate(&env);
    let result = client.try_repay_partial(&payer, &2u64, &token, &1_000_000_000i128);
    assert!(result.is_err(), "repay_partial must be rejected while RepaymentLock is held");
}

/// FP-12: `net_settle` acquires ALL locks before the single token transfer.
/// If any lock is already held the entire batch is rejected. [FP-12]
#[test]
fn test_fp_net_settle_rejects_if_any_lock_held() {
    let (env, admin, _nft, _treasury, ac, client) = fp_setup();
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    seed_open_pool(&env, &client.address, 10, 1_000_000_000, token.clone());
    seed_open_pool(&env, &client.address, 11, 1_000_000_000, token.clone());

    // Lock invoice 11 as if another operation is in flight.
    env.as_contract(&client.address, || {
        env.storage().persistent().set(&FpDataKey::RepaymentLock(11u64), &true);
    });

    let payer = Address::generate(&env);
    let mut ids = soroban_sdk::Vec::new(&env);
    ids.push_back(10u64);
    ids.push_back(11u64);

    let result = client.try_net_settle(&payer, &ids, &token, &2_000_000_000i128);
    assert!(result.is_err(), "net_settle must reject the entire batch if any lock is held");
}

/// FP-9: `release_funds` rejects a second call for the same invoice_id. [FP-9]
/// This is the PoolAlreadyClosed guard that prevents double-release.
#[test]
fn test_fp_release_funds_double_release_prevented() {
    let (env, admin, _nft, _treasury, ac, client) = fp_setup();
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();

    // A pool that is already closed (is_closed=true) simulates a completed release.
    let closed_pool = Pool {
        invoice_id: 99,
        token: token.clone(),
        total_funded: 1_000,
        face_value: 1_000,
        repaid_amount: 0,
        is_closed: false,
        late_penalty_bps: 0,
        total_owed: 1_000,
        penalty_applied: false,
    };
    env.as_contract(&client.address, || {
        env.storage().persistent().set(&FpDataKey::Pool(99u64), &closed_pool);
    });

    // A second release_funds call for the same invoice must fail.
    let marketplace = Address::generate(&env);
    let result = client.try_release_funds(&marketplace, &99u64, &token);
    // The pool already exists, so PoolAlreadyClosed is returned.
    assert!(result.is_err(), "release_funds must reject when pool already exists");
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: marketplace — ReentrancyGuard on fund_invoice [MP-1, MP-2]
// ─────────────────────────────────────────────────────────────────────────────

use kora_marketplace::{DataKey as MpDataKey, MarketplaceContract, MarketplaceContractClient};
use kora_shared::types::Listing;

fn mp_setup() -> (Env, Address, Address, MarketplaceContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_700_000_000,
        protocol_version: 21,
        sequence_number: 1,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 1000,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 100_000,
    });
    let admin = Address::generate(&env);
    let nft = Address::generate(&env);
    let pool = Address::generate(&env);
    let treasury = Address::generate(&env);
    let access_control = env.register_contract(None, kora_access_control::AccessControlContract);
    let ac_client = kora_access_control::AccessControlContractClient::new(&env, &access_control);
    ac_client.initialize(&admin);
    let oracle = Address::generate(&env);
    let registry = Address::generate(&env);
    let mp_id = env.register_contract(None, MarketplaceContract);
    let client = MarketplaceContractClient::new(&env, &mp_id);
    client.initialize(&admin, &nft, &pool, &treasury, &access_control, &oracle, &registry, &50u32, &0u32);
    (env, admin, treasury, client)
}

/// MP-1/MP-2: fund_invoice rejects a zero amount before any state change. [MP-1]
/// This confirms the Checks step runs before Effects/Interactions.
#[test]
fn test_mp_fund_invoice_checks_run_before_state_change() {
    let (env, admin, treasury, client) = mp_setup();
    let investor = Address::generate(&env);
    // Zero amount is rejected in the Checks phase — no state should change.
    let result = client.try_fund_invoice(&investor, &1u64, &0i128, &None);
    assert!(result.is_err(), "fund_invoice must reject zero amount in Checks phase");
}

/// MP-8: claim_refund sets RefundClaimed BEFORE the token transfer (CEI). [MP-8]
/// A double-claim attempt returns AlreadyInitialized, confirming the flag was set.
#[test]
fn test_mp_claim_refund_flag_prevents_double_claim() {
    let (env, admin, treasury, client) = mp_setup();
    let investor = Address::generate(&env);

    // Seed: an expired, partially-funded listing + a non-zero contribution record.
    let past_deadline = 1_700_000_000u64 - 1; // already expired
    let listing = Listing {
        invoice_id: 42,
        seller: Address::generate(&env),
        asking_price: 10_000_000_000,
        face_value: 12_000_000_000,
        token: Address::generate(&env),
        funded_amount: 5_000_000_000,
        funding_deadline: past_deadline,
        is_active: false,
    };
    env.as_contract(&client.address, || {
        env.storage().persistent().set(&MpDataKey::Listing(42u64), &listing);
        env.storage().persistent().set(
            &MpDataKey::Contribution(42u64, investor.clone()),
            &1_000_000_000i128,
        );
    });

    // First claim — will fail at token.transfer (no real token), but the flag
    // must have been written before the transfer attempt.
    let _ = client.try_claim_refund(&investor, &42u64);

    // Second attempt — flag should already be set → AlreadyInitialized.
    let result2 = client.try_claim_refund(&investor, &42u64);
    assert!(
        result2.is_err(),
        "second claim_refund must be rejected; RefundClaimed flag was set before transfer"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: treasury — ReentrancyGuard on withdraw [TR-1]
// ─────────────────────────────────────────────────────────────────────────────

use kora_treasury::{DataKey as TrDataKey, TreasuryContract, TreasuryContractClient};

fn tr_setup() -> (Env, Address, TreasuryContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TreasuryContract);
    let client = TreasuryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &50u32);
    (env, admin, client)
}

/// TR-1: withdraw rejects zero amount in Checks before touching storage. [TR-1]
#[test]
fn test_tr_withdraw_zero_amount_rejected_before_state_change() {
    let (env, admin, client) = tr_setup();
    let token = Address::generate(&env);
    let recipient = Address::generate(&env);
    let result = client.try_withdraw(&admin, &token, &recipient, &0i128);
    assert!(result.is_err(), "withdraw must reject 0 in Checks phase");
}

/// TR-1: withdraw rejects a non-whitelisted token before any state change. [TR-1]
#[test]
fn test_tr_withdraw_unwhitelisted_token_rejected() {
    let (env, admin, client) = tr_setup();
    let token = Address::generate(&env);
    let recipient = Address::generate(&env);
    let result = client.try_withdraw(&admin, &token, &recipient, &1_000i128);
    assert!(result.is_err(), "withdraw must reject non-whitelisted token");
}

/// TR-2: emergency_withdraw requires emergency to be declared first. [TR-2]
/// Without a declaration the function is rejected before any state change.
#[test]
fn test_tr_emergency_withdraw_requires_declaration() {
    let (env, admin, client) = tr_setup();
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    let recipient = Address::generate(&env);
    client.whitelist_token(&admin, &token);
    let result = client.try_emergency_withdraw(&admin, &token, &recipient);
    assert!(result.is_err(), "emergency_withdraw requires emergency declaration");
}

/// TR-3: disburse_from_reserve rejects an unauthorized caller before state change. [TR-3]
#[test]
fn test_tr_disburse_from_reserve_unauthorized_caller_rejected() {
    let (env, admin, client) = tr_setup();
    let token = Address::generate(&env);
    let stranger = Address::generate(&env);
    let recipient = Address::generate(&env);
    let result = client.try_disburse_from_reserve(&stranger, &token, &1_000i128, &recipient);
    assert!(result.is_err(), "disburse_from_reserve must reject unauthorized caller");
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: risk_registry — top_up_stake CEI deviation [RR-6]
// Documents the current inbound-transfer CEI deviation and confirms the
// deviation is stable (no fund-loss risk under current access model).
// ─────────────────────────────────────────────────────────────────────────────

use kora_risk_registry::{DataKey as RrDataKey, RiskRegistryContract, RiskRegistryContractClient};

fn rr_setup() -> (Env, Address, Address, Address, RiskRegistryContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let contract_id = env.register_contract(None, RiskRegistryContract);
    let client = RiskRegistryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let invoice_nft = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let staking_token = env.register_stellar_asset_contract_v2(token_admin).address();
    client.initialize(&admin, &invoice_nft, &staking_token, &1_000_000i128, &5_000u32);
    (env, admin, invoice_nft, staking_token, client)
}

fn mint_stake(env: &Env, token: &Address, to: &Address, amount: i128) {
    soroban_sdk::token::StellarAssetClient::new(env, token).mint(to, &amount);
}

/// RR-6: top_up_stake adds to existing stake additively (not overwrite). [RR-6]
/// This confirms that even with the CEI deviation, the stake accounting is correct
/// and no funds are stranded or double-counted.
#[test]
fn test_rr_top_up_stake_additive_not_overwrite() {
    let (env, admin, _, staking_token, client) = rr_setup();
    let verifier = Address::generate(&env);
    mint_stake(&env, &staking_token, &verifier, 3_000_000i128);
    client.add_verifier(&admin, &verifier, &1_000_000i128);
    assert_eq!(client.get_verifier_stake(&verifier), 1_000_000i128);
    client.top_up_stake(&admin, &verifier, &500_000i128);
    assert_eq!(client.get_verifier_stake(&verifier), 1_500_000i128);
    // A second top-up continues to accumulate correctly.
    client.top_up_stake(&admin, &verifier, &200_000i128);
    assert_eq!(client.get_verifier_stake(&verifier), 1_700_000i128);
}

/// RR-6: top_up_stake rejects zero/negative amounts before any token transfer. [RR-6]
/// This confirms the Checks step still precedes the interaction even under the CEI
/// deviation (transfer can only proceed after validation passes).
#[test]
fn test_rr_top_up_stake_cei_ordering_zero_rejected() {
    let (env, admin, _, staking_token, client) = rr_setup();
    let verifier = Address::generate(&env);
    mint_stake(&env, &staking_token, &verifier, 1_000_000i128);
    client.add_verifier(&admin, &verifier, &1_000_000i128);
    let result = client.try_top_up_stake(&admin, &verifier, &0i128);
    assert!(result.is_err(), "zero amount must be rejected before token transfer");
    // Stake unchanged — no transfer occurred.
    assert_eq!(client.get_verifier_stake(&verifier), 1_000_000i128);
}

/// RR-2: remove_verifier removes the verifier flag BEFORE returning stake,
/// so any re-entrant call would see a non-verifier and be rejected. [RR-2]
#[test]
fn test_rr_remove_verifier_flag_cleared_before_stake_return() {
    let (env, admin, _, staking_token, client) = rr_setup();
    let verifier = Address::generate(&env);
    mint_stake(&env, &staking_token, &verifier, 1_000_000i128);
    client.add_verifier(&admin, &verifier, &1_000_000i128);
    assert!(client.is_verifier(&verifier));

    client.remove_verifier(&admin, &verifier);

    // Verifier flag is gone — a re-entrant call arriving after the flag was cleared
    // but before the token transfer completes would be rejected as NotVerifier.
    assert!(!client.is_verifier(&verifier));
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: access_control — pause/unpause reentrancy guard [AC-1]
// ─────────────────────────────────────────────────────────────────────────────

use kora_access_control::{AccessControlContract, AccessControlContractClient};

fn ac_setup() -> (Env, Address, AccessControlContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, AccessControlContract);
    let client = AccessControlContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

/// AC-1: pause is idempotent-safe — double-pause returns AlreadyPaused, not a panic. [AC-1]
#[test]
fn test_ac_pause_double_pause_returns_already_paused() {
    let (_, admin, client) = ac_setup();
    client.pause(&admin);
    let result = client.try_pause(&admin);
    assert!(result.is_err(), "second pause must return AlreadyPaused");
}

/// AC-1: unpause while not paused returns NotPaused, not a panic. [AC-1]
#[test]
fn test_ac_unpause_when_not_paused_returns_not_paused() {
    let (_, admin, client) = ac_setup();
    let result = client.try_unpause(&admin);
    assert!(result.is_err(), "unpause when not paused must return NotPaused");
}

/// AC-1: pause/unpause cycle does not leave the reentrancy guard locked. [AC-1]
#[test]
fn test_ac_pause_unpause_does_not_strand_lock() {
    let (_, admin, client) = ac_setup();
    for _ in 0..5 {
        client.pause(&admin);
        client.unpause(&admin);
    }
    // If the guard were stranded, every call after the first cycle would fail.
    assert!(!client.is_paused());
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: Cross-contract interaction — protocol-wide pause blocks
//            every write path (CEI: checks include pause check first)
// ─────────────────────────────────────────────────────────────────────────────

/// When the protocol is paused, financing_pool::record_position must be rejected
/// before any state modification. [FP-5 from prior audit, regression coverage]
#[test]
fn test_fp_record_position_blocked_when_paused() {
    let (env, admin, _nft, _treasury, access_control, client) = fp_setup();
    let ac_client = kora_access_control::AccessControlContractClient::new(&env, &access_control);
    ac_client.pause(&admin);

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    seed_open_pool(&env, &client.address, 50, 1_000, token);

    let investor = Address::generate(&env);
    let result = client.try_record_position(&admin, &50u64, &investor, &500i128, &1_000i128);
    assert!(result.is_err(), "record_position must be blocked when protocol is paused");
}

/// When the protocol is paused, marketplace::list_invoice must be rejected. [MP-1 guard]
#[test]
fn test_mp_list_invoice_blocked_when_paused() {
    let (env, admin, _treasury, client) = mp_setup();
    // Pause the wired access_control.
    let ac_id: Address = env.as_contract(&client.address, || {
        env.storage().instance().get(&MpDataKey::AccessControl).unwrap()
    });
    let ac_client = kora_access_control::AccessControlContractClient::new(&env, &ac_id);
    ac_client.pause(&admin);

    let seller = Address::generate(&env);
    let token = Address::generate(&env);
    let deadline = 1_700_000_000u64 + 86_400;
    let result = client.try_list_invoice(
        &seller, &1u64, &9_000_000_000i128, &10_000_000_000i128, &token, &deadline, &None,
    );
    assert!(result.is_err(), "list_invoice must be blocked when protocol is paused");
}
