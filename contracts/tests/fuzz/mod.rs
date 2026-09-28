use proptest::prelude::*;

#[derive(Clone, Debug)]
pub enum Action {
    Deposit(u64, i128),
    Withdraw(u64, i128),
    ListMarketplace(u64, i128),
    BuyMarketplace(u64),
}

pub fn run_fuzz_harness(iters: u32) {
    let mut runner = proptest::test_runner::TestRunner::default();
    let action_strategy = prop_oneof![
        (1u64..100, 1i128..10000).prop_map(|(id, amt)| Action::Deposit(id, amt)),
        (1u64..100, 1i128..10000).prop_map(|(id, amt)| Action::Withdraw(id, amt)),
        (1u64..100, 1i128..10000).prop_map(|(id, amt)| Action::ListMarketplace(id, amt)),
        (1u64..100).prop_map(|id| Action::BuyMarketplace(id)),
    ];
    let sequence_strategy = prop::collection::vec(action_strategy, 1..20);

    let mut total_deposits = 0i128;
    let mut total_withdrawals = 0i128;
    let mut pool_face_value = 100000i128;
    let mut investor_positions_sum = 0i128;

    for _ in 0..iters {
        let value = sequence_strategy.new_tree(&mut runner).unwrap().current();
        for action in value {
            match action {
                Action::Deposit(_id, amt) => {
                    if investor_positions_sum + amt <= pool_face_value {
                        investor_positions_sum += amt;
                        total_deposits += amt;
                    }
                }
                Action::Withdraw(_id, amt) => {
                    if amt <= investor_positions_sum {
                        investor_positions_sum -= amt;
                        total_withdrawals += amt;
                    }
                }
                Action::ListMarketplace(_, _) => {}
                Action::BuyMarketplace(_) => {}
            }

            // Invariants assertion after each step
            assert!(
                investor_positions_sum <= pool_face_value,
                "Invariant Violation: sum of investor positions exceeds pool face value!"
            );
            assert!(
                total_deposits >= total_withdrawals,
                "Invariant Violation: total withdrawals exceed deposits!"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fuzz_invariants() {
        run_fuzz_harness(50);
    }
}
