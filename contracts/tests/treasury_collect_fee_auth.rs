// tests/treasury_collect_fee_auth.rs
//! Tests for Treasury collect_fee authorization (Issue #465)

#[cfg(test)]
mod treasury_collect_fee_auth {
    use kora_treasury::TreasuryContractClient;
    use kora_shared::errors::KoraError;
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        Address, Env,
    };

    struct TestEnv {
        env: Env,
        admin: Address,
        marketplace: Address,
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
        let marketplace = Address::generate(&env);
        let token = Address::generate(&env);

        let treasury_id = env.register_contract(None, kora_treasury::TreasuryContract);
        let treasury_client = TreasuryContractClient::new(&env, &treasury_id);
        treasury_client.initialize(&admin);

        treasury_client.whitelist_token(&admin, &token);

        TestEnv {
            env,
            admin,
            marketplace,
            token,
            treasury_client,
        }
    }

    #[test]
    fn test_collect_fee_requires_authorized_caller() {
        let t = setup();
        let unauthorized_caller = Address::generate(&t.env);
        let amount = 1_000i128;

        let result = t.treasury_client.try_collect_fee(
            &unauthorized_caller,
            &t.token,
            &amount,
        );

        assert!(result.is_err(), "Unauthorized caller should not be able to call collect_fee");
        if let Err(Ok(e)) = result {
            assert_eq!(e, KoraError::UnauthorizedCaller, "Error should be UnauthorizedCaller");
        }
    }

    #[test]
    fn test_collect_fee_accepts_authorized_caller() {
        let t = setup();

        t.treasury_client.set_authorized_caller(&t.admin, &t.marketplace, &true);

        let amount = 1_000i128;
        let result = t.treasury_client.try_collect_fee(
            &t.marketplace,
            &t.token,
            &amount,
        );

        assert!(result.is_ok(), "Authorized caller should be able to call collect_fee");
    }

    #[test]
    fn test_collect_fee_authorization_revocation() {
        let t = setup();

        t.treasury_client.set_authorized_caller(&t.admin, &t.marketplace, &true);
        t.treasury_client.set_authorized_caller(&t.admin, &t.marketplace, &false);

        let amount = 1_000i128;
        let result = t.treasury_client.try_collect_fee(
            &t.marketplace,
            &t.token,
            &amount,
        );

        assert!(result.is_err(), "Revoked caller should not be able to call collect_fee");
    }

    #[test]
    fn test_collect_fee_cannot_inflate_collected_ledger() {
        let t = setup();
        let unauthorized_caller = Address::generate(&t.env);

        let initial_collected = t.treasury_client.get_collected(&t.token);

        let arbitrary_amount = 1_000_000_000i128;
        let _result = t.treasury_client.try_collect_fee(
            &unauthorized_caller,
            &t.token,
            &arbitrary_amount,
        );

        let final_collected = t.treasury_client.get_collected(&t.token);
        assert_eq!(
            initial_collected, final_collected,
            "Unauthorized caller cannot inflate Collected ledger"
        );
    }

    #[test]
    fn test_only_admin_can_set_authorized_callers() {
        let t = setup();
        let non_admin = Address::generate(&t.env);
        let caller_to_authorize = Address::generate(&t.env);

        let result = t.treasury_client.try_set_authorized_caller(
            &non_admin,
            &caller_to_authorize,
            &true,
        );

        assert!(result.is_err(), "Non-admin should not be able to set authorized callers");
        if let Err(Ok(e)) = result {
            assert_eq!(e, KoraError::NotAdmin);
        }
    }

    #[test]
    fn test_multiple_authorized_callers() {
        let t = setup();
        let marketplace1 = Address::generate(&t.env);
        let marketplace2 = Address::generate(&t.env);

        t.treasury_client.set_authorized_caller(&t.admin, &marketplace1, &true);
        t.treasury_client.set_authorized_caller(&t.admin, &marketplace2, &true);

        let amount = 500i128;

        let result1 = t.treasury_client.try_collect_fee(&marketplace1, &t.token, &amount);
        let result2 = t.treasury_client.try_collect_fee(&marketplace2, &t.token, &amount);

        assert!(result1.is_ok(), "First authorized caller should succeed");
        assert!(result2.is_ok(), "Second authorized caller should succeed");
    }
}
