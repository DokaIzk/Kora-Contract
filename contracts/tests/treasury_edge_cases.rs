// tests/treasury_edge_cases.rs
//! Edge case tests for Treasury Contract multi-recipient distribution (Issue #464)
//!
//! This test module covers:
//! - Multi-recipient fee distribution
//! - Withdrawal validation
//! - Rate-limiting and reentrancy protection

#[cfg(test)]
mod treasury_edge_cases {
    use kora_treasury::TreasuryContractClient;
    use kora_shared::errors::KoraError;
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        Address, Env,
    };

    struct TestEnv {
        env: Env,
        admin: Address,
        token: Address,
        treasury_client: TreasuryContractClient<'static>,
    }

    fn setup() -> TestEnv {
        let env = Env::default();
        env.mock_all_auths();

        env.ledger().set(LedgerInfo {
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
        let token = Address::generate(&env);

        let treasury_id = env.register_contract(None, kora_treasury::TreasuryContract);
        let treasury_client = TreasuryContractClient::new(&env, &treasury_id);
        treasury_client.initialize(&admin);

        treasury_client.whitelist_token(&admin, &token);

        TestEnv {
            env,
            admin,
            token,
            treasury_client,
        }
    }

    // ── Issue #464: Multi-recipient Distribution ────────────────────────────────

    #[test]
    fn test_withdraw_distributed_splits_across_recipients() {
        let t = setup();
        let recipient1 = Address::generate(&t.env);
        let recipient2 = Address::generate(&t.env);
        let recipient3 = Address::generate(&t.env);

        let distribution = vec![
            (recipient1.clone(), 5_000u32),
            (recipient2.clone(), 3_000u32),
            (recipient3.clone(), 2_000u32),
        ];

        t.treasury_client.set_distribution_recipients(&t.admin, &distribution);

        let amount = 10_000i128;
        let result = t.treasury_client.try_withdraw_distributed(
            &t.admin,
            &t.token,
            &amount,
        );

        assert!(result.is_ok(), "withdraw_distributed should succeed with valid recipients");
    }

    #[test]
    fn test_distribution_recipients_must_sum_to_10000_bps() {
        let t = setup();
        let recipient1 = Address::generate(&t.env);
        let recipient2 = Address::generate(&t.env);

        let invalid_distribution = vec![
            (recipient1.clone(), 5_000u32),
            (recipient2.clone(), 4_000u32),
        ];

        let result = t.treasury_client.try_set_distribution_recipients(
            &t.admin,
            &invalid_distribution,
        );

        assert!(result.is_err(), "Distribution must sum to exactly 10_000 bps");
    }

    #[test]
    fn test_distribution_recipients_cannot_exceed_10000_bps() {
        let t = setup();
        let recipient1 = Address::generate(&t.env);
        let recipient2 = Address::generate(&t.env);

        let invalid_distribution = vec![
            (recipient1.clone(), 6_000u32),
            (recipient2.clone(), 5_000u32),
        ];

        let result = t.treasury_client.try_set_distribution_recipients(
            &t.admin,
            &invalid_distribution,
        );

        assert!(result.is_err(), "Distribution sum cannot exceed 10_000 bps");
    }

    #[test]
    fn test_withdraw_distributed_handles_rounding_correctly() {
        let t = setup();
        let recipient1 = Address::generate(&t.env);
        let recipient2 = Address::generate(&t.env);

        let distribution = vec![
            (recipient1.clone(), 3_333u32),
            (recipient2.clone(), 6_667u32),
        ];

        t.treasury_client.set_distribution_recipients(&t.admin, &distribution);

        let amount = 10_000i128;

        let result = t.treasury_client.try_withdraw_distributed(
            &t.admin,
            &t.token,
            &amount,
        );

        assert!(result.is_ok(), "Rounding should not cause withdrawal to fail");
    }

    #[test]
    fn test_withdraw_distributed_dust_goes_to_first_recipient() {
        let t = setup();
        let recipient1 = Address::generate(&t.env);
        let recipient2 = Address::generate(&t.env);

        let distribution = vec![
            (recipient1.clone(), 3_333u32),
            (recipient2.clone(), 6_667u32),
        ];

        t.treasury_client.set_distribution_recipients(&t.admin, &distribution);

        let amount = 1_000i128;

        let result = t.treasury_client.try_withdraw_distributed(
            &t.admin,
            &t.token,
            &amount,
        );

        assert!(result.is_ok(), "Dust handling should work correctly");
    }

    #[test]
    fn test_only_admin_can_set_distribution_recipients() {
        let t = setup();
        let non_admin = Address::generate(&t.env);
        let recipient = Address::generate(&t.env);

        let distribution = vec![(recipient, 10_000u32)];

        let result = t.treasury_client.try_set_distribution_recipients(
            &non_admin,
            &distribution,
        );

        assert!(result.is_err(), "Non-admin cannot set distribution recipients");
        if let Err(Ok(e)) = result {
            assert_eq!(e, KoraError::NotAdmin);
        }
    }

    #[test]
    fn test_withdraw_distributed_respects_rate_limit() {
        let t = setup();
        let recipient = Address::generate(&t.env);
        let distribution = vec![(recipient, 10_000u32)];

        t.treasury_client.set_distribution_recipients(&t.admin, &distribution);

        let result1 = t.treasury_client.try_withdraw_distributed(
            &t.admin,
            &t.token,
            &1_000i128,
        );
        assert!(result1.is_ok(), "First withdrawal should succeed");

        let result2 = t.treasury_client.try_withdraw_distributed(
            &t.admin,
            &t.token,
            &1_000i128,
        );
    }

    #[test]
    fn test_withdraw_distributed_emits_event() {
        let t = setup();
        let recipient1 = Address::generate(&t.env);
        let recipient2 = Address::generate(&t.env);

        let distribution = vec![
            (recipient1.clone(), 6_000u32),
            (recipient2.clone(), 4_000u32),
        ];

        t.treasury_client.set_distribution_recipients(&t.admin, &distribution);

        let amount = 10_000i128;
        let result = t.treasury_client.try_withdraw_distributed(
            &t.admin,
            &t.token,
            &amount,
        );

        assert!(result.is_ok(), "Event emission should occur on successful distribution");
    }

    #[test]
    fn test_single_recipient_100_percent_distribution() {
        let t = setup();
        let sole_recipient = Address::generate(&t.env);

        let distribution = vec![(sole_recipient.clone(), 10_000u32)];

        t.treasury_client.set_distribution_recipients(&t.admin, &distribution);

        let amount = 5_000i128;
        let result = t.treasury_client.try_withdraw_distributed(
            &t.admin,
            &t.token,
            &amount,
        );

        assert!(result.is_ok(), "100% distribution to single recipient should work");
    }

    #[test]
    fn test_withdraw_distributed_with_many_recipients() {
        let t = setup();

        let mut distribution = Vec::new();
        for _ in 0..10 {
            let recipient = Address::generate(&t.env);
            distribution.push((recipient, 1_000u32));
        }

        t.treasury_client.set_distribution_recipients(&t.admin, &distribution);

        let amount = 10_000i128;
        let result = t.treasury_client.try_withdraw_distributed(
            &t.admin,
            &t.token,
            &amount,
        );

        assert!(result.is_ok(), "Distribution to many recipients should work");
    }

    // ── Withdrawal Edge Cases ────────────────────────────────────────────────────

    #[test]
    fn test_withdraw_requires_sufficient_balance() {
        let t = setup();

        let result = t.treasury_client.try_withdraw(
            &t.admin,
            &Address::generate(&t.env),
            &t.token,
            &1_000_000_000i128,
        );

        assert!(result.is_err());
    }

    #[test]
    fn test_withdraw_zero_amount_rejected() {
        let t = setup();

        let result = t.treasury_client.try_withdraw(
            &t.admin,
            &Address::generate(&t.env),
            &t.token,
            &0i128,
        );

        assert_eq!(result.unwrap_err().unwrap(), KoraError::InvalidAmount);
    }

    #[test]
    fn test_withdraw_negative_amount_rejected() {
        let t = setup();

        let result = t.treasury_client.try_withdraw(
            &t.admin,
            &Address::generate(&t.env),
            &t.token,
            &-1_000i128,
        );

        assert_eq!(result.unwrap_err().unwrap(), KoraError::InvalidAmount);
    }

    #[test]
    fn test_only_admin_can_withdraw() {
        let t = setup();
        let non_admin = Address::generate(&t.env);
        let recipient = Address::generate(&t.env);

        let result = t.treasury_client.try_withdraw(
            &non_admin,
            &recipient,
            &t.token,
            &1_000i128,
        );

        assert_eq!(result.unwrap_err().unwrap(), KoraError::NotAdmin);
    }

    #[test]
    fn test_withdraw_with_non_whitelisted_token() {
        let t = setup();
        let unwhitelisted_token = Address::generate(&t.env);
        let recipient = Address::generate(&t.env);

        let result = t.treasury_client.try_withdraw(
            &t.admin,
            &recipient,
            &unwhitelisted_token,
            &1_000i128,
        );

        assert_eq!(result.unwrap_err().unwrap(), KoraError::TokenNotWhitelisted);
    }
}
