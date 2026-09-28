use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawalRequest {
    pub id: u64,
    pub investor: Address,
    pub amount: i128,
    pub filled_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueuePointers {
    pub head: u64,
    pub tail: u64,
    pub next_id: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum QueueStorageKey {
    Pointers,
    Request(u64),
}

pub struct WithdrawalQueue;

impl WithdrawalQueue {
    pub const MAX_QUEUE_LEN: u64 = 100;

    pub fn get_pointers(env: &Env) -> QueuePointers {
        env.storage()
            .persistent()
            .get(&QueueStorageKey::Pointers)
            .unwrap_or(QueuePointers {
                head: 0,
                tail: 0,
                next_id: 1,
            })
    }

    pub fn set_pointers(env: &Env, pointers: &QueuePointers) {
        env.storage()
            .persistent()
            .set(&QueueStorageKey::Pointers, pointers);
    }

    pub fn get_request(env: &Env, id: u64) -> Option<WithdrawalRequest> {
        env.storage().persistent().get(&QueueStorageKey::Request(id))
    }

    pub fn set_request(env: &Env, req: &WithdrawalRequest) {
        env.storage()
            .persistent()
            .set(&QueueStorageKey::Request(req.id), req);
    }

    pub fn remove_request(env: &Env, id: u64) {
        env.storage().persistent().remove(&QueueStorageKey::Request(id));
    }

    pub fn request_withdrawal(env: &Env, investor: Address, amount: i128) -> Result<u64, ()> {
        if amount <= 0 {
            return Err(());
        }
        let mut pointers = Self::get_pointers(env);
        let current_len = pointers.tail - pointers.head;
        if current_len >= Self::MAX_QUEUE_LEN {
            return Err(());
        }

        let req_id = pointers.next_id;
        let req = WithdrawalRequest {
            id: req_id,
            investor,
            amount,
            filled_amount: 0,
        };

        Self::set_request(env, &req);
        pointers.tail += 1;
        pointers.next_id += 1;
        Self::set_pointers(env, &pointers);

        Ok(req_id)
    }

    pub fn cancel_request(env: &Env, id: u64, investor: Address) -> Result<i128, ()> {
        investor.require_auth();
        let req = Self::get_request(env, id).ok_or(())?;
        if req.investor != investor {
            return Err(());
        }

        let remaining = req.amount.checked_sub(req.filled_amount).ok_or(())?;
        Self::remove_request(env, id);

        Ok(remaining)
    }

    pub fn process_queue<F>(env: &Env, mut available_liquidity: i128, mut fill_fn: F) -> i128
    where
        F: FnMut(&Address, i128) -> bool,
    {
        let mut pointers = Self::get_pointers(env);

        while pointers.head < pointers.tail && available_liquidity > 0 {
            let req_id = pointers.head;
            if let Some(mut req) = Self::get_request(env, req_id) {
                let remaining_req = req.amount - req.filled_amount;
                let fill_amount = remaining_req.min(available_liquidity);

                if fill_amount > 0 {
                    let success = fill_fn(&req.investor, fill_amount);
                    if !success {
                        break;
                    }
                    req.filled_amount += fill_amount;
                    available_liquidity -= fill_amount;

                    if req.filled_amount >= req.amount {
                        Self::remove_request(env, req_id);
                        pointers.head += 1;
                    } else {
                        Self::set_request(env, &req);
                    }
                } else {
                    break;
                }
            } else {
                // If request was cancelled or missing, increment head
                pointers.head += 1;
            }
        }

        Self::set_pointers(env, &pointers);
        available_liquidity
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_withdrawal_queue_fifo_and_partial_fill() {
        let env = Env::default();
        let inv1 = Address::generate(&env);
        let inv2 = Address::generate(&env);

        let req1 = WithdrawalQueue::request_withdrawal(&env, inv1.clone(), 100).unwrap();
        let req2 = WithdrawalQueue::request_withdrawal(&env, inv2.clone(), 200).unwrap();

        assert_eq!(req1, 1);
        assert_eq!(req2, 2);

        // Process queue with partial liquidity for req1
        let remaining = WithdrawalQueue::process_queue(&env, 40, |target, amt| {
            assert_eq!(target, &inv1);
            assert_eq!(amt, 40);
            true
        });
        assert_eq!(remaining, 0);

        let req1_state = WithdrawalQueue::get_request(&env, req1).unwrap();
        assert_eq!(req1_state.filled_amount, 40);

        // Process queue with enough liquidity to finish req1 and partially fill req2
        let remaining2 = WithdrawalQueue::process_queue(&env, 100, |target, amt| {
            if target == &inv1 {
                assert_eq!(amt, 60);
            } else if target == &inv2 {
                assert_eq!(amt, 40);
            }
            true
        });
        assert_eq!(remaining2, 0);

        assert!(WithdrawalQueue::get_request(&env, req1).is_none());
        let req2_state = WithdrawalQueue::get_request(&env, req2).unwrap();
        assert_eq!(req2_state.filled_amount, 40);
    }

    #[test]
    fn test_withdrawal_queue_cancellation() {
        let env = Env::default();
        let inv1 = Address::generate(&env);

        let req1 = WithdrawalQueue::request_withdrawal(&env, inv1.clone(), 100).unwrap();
        
        // Partial fill
        WithdrawalQueue::process_queue(&env, 30, |_, _| true);

        // Cancel remaining
        let remaining = WithdrawalQueue::cancel_request(&env, req1, inv1.clone()).unwrap();
        assert_eq!(remaining, 70);

        assert!(WithdrawalQueue::get_request(&env, req1).is_none());
    }
}
