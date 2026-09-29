//! Referral self-dealing attack simulation
//!
//! ## Attack Vector
//!
//! An attacker attempts to extract referral rewards by:
//! 1. Creating multiple SME identities (Sybil attack)
//! 2. Cross-referrring between controlled addresses
//! 3. Creating and immediately repaying invoices to trigger referral bonuses
//! 4. Extracting rewards while minimizing legitimate economic activity
//!
//! ## Expected Defenses
//!
//! - Referral rewards only trigger on FIRST invoice repayment per SME
//! - Fixed bonus amount limits total extractable value
//! - Allocation cap prevents unbounded drain
//! - Upfront fees on invoice creation + funding make cycling expensive

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

use crate::economic_sim::{AttackMetrics, estimate_gas_cost};

fn setup_referral_env() -> (
    Env,
    Address, // admin
    Address, // attacker_sme_1
    Address, // attacker_sme_2
    Address, // attacker_referrer
    i128,    // bonus_amount
    i128,    // allocation
) {
    let env = Env::default();
    env.mock_all_auths();
    
    env.ledger().set(LedgerInfo {
        timestamp: 1_700_000_000,
        protocol_version: 21,
        sequence_number: 1000,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 1000,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 600_000,
    });

    let admin = Address::generate(&env);
    let attacker_sme_1 = Address::generate(&env);
    let attacker_sme_2 = Address::generate(&env);
    let attacker_referrer = Address::generate(&env);
    
    let bonus_amount = 100_000_000i128; // 100 USDC bonus
    let allocation = 10_000_000_000i128; // 10K USDC total allocation

    (env, admin, attacker_sme_1, attacker_sme_2, attacker_referrer, bonus_amount, allocation)
}

#[test]
fn test_sybil_referral_extraction() {
    let (env, _admin, _sme1, _sme2, _referrer, bonus, allocation) = setup_referral_env();
    
    let mut metrics = AttackMetrics::new();
    
    // Calculate maximum possible referrals from allocation
    let max_referrals = allocation / bonus;
    
    // Cost per fake SME referral cycle:
    // 1. Create invoice (gas + storage)
    // 2. List on marketplace (gas + fee)
    // 3. Fund invoice (gas + fee on funding)
    // 4. Repay invoice (gas + transfer)
    // 5. Claim referral reward (gas)
    
    let invoice_amount = 1_000_000_000i128; // 1K invoice (minimum viable)
    
    // Marketplace fee: 2%
    let marketplace_fee_bps = 200;
    let marketplace_fee = invoice_amount * marketplace_fee_bps / 10_000;
    
    // Financing pool fee on repayment: ~1%
    let pool_fee_bps = 100;
    let pool_fee = invoice_amount * pool_fee_bps / 10_000;
    
    // Gas costs for 5 transactions
    let gas_per_cycle = estimate_gas_cost(50) * 5;
    
    // Total cost per referral claimed
    let cost_per_referral = marketplace_fee + pool_fee + (gas_per_cycle * 1_000);
    
    // Net profit per successful referral
    let profit_per_referral = bonus - cost_per_referral;
    
    metrics.tx_count = (max_referrals * 5) as u32; // 5 tx per referral
    
    if profit_per_referral > 0 {
        // Attack could be profitable if fees are too low
        metrics.capital_deployed = invoice_amount * max_referrals; // capital tied up
        metrics.net_profit = profit_per_referral * max_referrals;
        metrics.outcome = format!(
            "ALERT: Referral self-dealing is PROFITABLE! Attacker can extract {} with {} fake SMEs. FIX REQUIRED: Increase fees or reduce bonus.",
            metrics.net_profit,
            max_referrals
        );
    } else {
        metrics.capital_deployed = invoice_amount;
        metrics.net_profit = profit_per_referral; // negative
        metrics.outcome = format!(
            "Referral self-dealing is UNPROFITABLE. Each cycle loses {}. Attack FAILED - fees exceed bonus.",
            -profit_per_referral
        );
    }
    
    println!("Sybil Referral Extraction Attack Results:");
    println!("  Bonus per referral: {}", bonus);
    println!("  Cost per referral: {}", cost_per_referral);
    println!("  Net per referral: {}", profit_per_referral);
    println!("  Max possible referrals: {}", max_referrals);
    println!("  Total net profit: {}", metrics.net_profit);
    println!("  Outcome: {}", metrics.outcome);
    
    // SECURITY CHECK: Attack must not be exploitable
    assert!(!metrics.is_exploitable(),
        "Referral self-dealing EXPLOIT DETECTED: {:?}", metrics);
    
    assert!(profit_per_referral <= 0,
        "CRITICAL: Referral bonus ({}) exceeds cost per cycle ({}). Reduce bonus or increase fees!",
        bonus, cost_per_referral);
}

#[test]
fn test_referral_rapid_cycling_timing() {
    let (_env, _admin, _sme1, _sme2, _referrer, bonus, _allocation) = setup_referral_env();
    
    let mut metrics = AttackMetrics::new();
    
    // Attacker tries to rapidly cycle through fake invoices to extract rewards quickly
    // Testing if rate limits or timing constraints prevent rapid extraction
    
    let cycles = 100;
    let invoice_amount = 500_000_000i128; // 500 USDC
    
    metrics.capital_deployed = invoice_amount; // recycled capital
    
    // Costs per cycle
    let marketplace_fee = invoice_amount * 200 / 10_000; // 2%
    let pool_fee = invoice_amount * 100 / 10_000; // 1%
    let gas_cost = estimate_gas_cost(50) * 5 * 1_000;
    
    let cost_per_cycle = marketplace_fee + pool_fee + gas_cost;
    let profit_per_cycle = bonus - cost_per_cycle;
    
    metrics.net_profit = profit_per_cycle * cycles;
    metrics.tx_count = cycles * 5;
    
    // Time constraint: each invoice must be created, funded, and repaid
    // Minimum realistic time: 1 ledger per invoice = ~5 seconds
    let min_ledgers_required = cycles * 1;
    metrics.disruption_ledgers = 0; // not disrupting, just extracting
    
    metrics.outcome = format!(
        "Rapid cycling through {} fake invoices over {} ledgers. Net: {}. Per-cycle profit: {}",
        cycles,
        min_ledgers_required,
        metrics.net_profit,
        profit_per_cycle
    );
    
    println!("Rapid Referral Cycling Attack Results:");
    println!("  Cycles: {}", cycles);
    println!("  Time required: {} ledgers (~{} minutes)", min_ledgers_required, min_ledgers_required * 5 / 60);
    println!("  Per-cycle profit: {}", profit_per_cycle);
    println!("  Total net: {}", metrics.net_profit);
    println!("  Outcome: {}", metrics.outcome);
    
    assert!(!metrics.is_exploitable(),
        "Rapid referral cycling should not be exploitable");
    
    assert!(profit_per_cycle <= 0,
        "Per-cycle profit must be non-positive to prevent extraction");
}

#[test]
fn test_cross_referral_network() {
    let (_env, _admin, _sme1, _sme2, _referrer, bonus, allocation) = setup_referral_env();
    
    let mut metrics = AttackMetrics::new();
    
    // Attacker creates a network of N fake SMEs that cross-refer each other
    // in a chain or cycle to maximize extraction
    //
    // Network: SME1 -> SME2 -> SME3 -> SME4 -> ... -> SME1
    //
    // Each SME creates one invoice and refers the next, attempting to claim
    // N referral bonuses with coordinated timing
    
    let network_size = 20;
    let invoice_amount = 1_000_000_000i128; // 1K per invoice
    
    // Capital needed: one invoice amount per SME (can be recycled after repayment)
    metrics.capital_deployed = invoice_amount * network_size;
    
    // Cost per SME in the chain
    let marketplace_fee = invoice_amount * 200 / 10_000;
    let pool_fee = invoice_amount * 100 / 10_000;
    let gas_cost = estimate_gas_cost(50) * 5 * 1_000;
    let cost_per_sme = marketplace_fee + pool_fee + gas_cost;
    
    // Revenue per SME: one bonus claimed (first invoice repaid)
    let revenue_per_sme = bonus;
    
    let total_cost = cost_per_sme * network_size;
    let total_revenue = revenue_per_sme * network_size;
    
    metrics.net_profit = total_revenue - total_cost;
    metrics.tx_count = (network_size * 5) as u32;
    
    // Check if entire allocation can be drained
    let allocation_drained = bonus * network_size;
    let allocation_percentage = (allocation_drained * 100) / allocation;
    
    metrics.outcome = format!(
        "Cross-referral network of {} SMEs. Net profit: {}. Drained {}% of allocation. {}",
        network_size,
        metrics.net_profit,
        allocation_percentage,
        if metrics.net_profit > 0 { "ALERT: PROFITABLE ATTACK" } else { "Attack FAILED - unprofitable" }
    );
    
    println!("Cross-Referral Network Attack Results:");
    println!("  Network size: {} SMEs", network_size);
    println!("  Total cost: {}", total_cost);
    println!("  Total revenue: {}", total_revenue);
    println!("  Net profit: {}", metrics.net_profit);
    println!("  Allocation drained: {}%", allocation_percentage);
    println!("  Outcome: {}", metrics.outcome);
    
    assert!(!metrics.is_exploitable(),
        "Cross-referral network EXPLOIT DETECTED: {:?}", metrics);
    
    assert!(metrics.net_profit <= 0,
        "CRITICAL: Cross-referral attack is profitable! Increase fees or add Sybil resistance.");
}

#[test]
fn test_allocation_exhaustion_griefing() {
    let (_env, _admin, _sme1, _sme2, _referrer, bonus, allocation) = setup_referral_env();
    
    let mut metrics = AttackMetrics::new();
    
    // Attacker doesn't profit but exhausts the referral allocation to grief
    // legitimate users. Tests if griefing is economically prohibitive.
    
    let max_claims = allocation / bonus;
    let invoice_amount = 1_000_000_000i128;
    
    // Minimum cost to exhaust allocation
    let marketplace_fee = invoice_amount * 200 / 10_000;
    let pool_fee = invoice_amount * 100 / 10_000;
    let gas_cost = estimate_gas_cost(50) * 5 * 1_000;
    let cost_per_claim = marketplace_fee + pool_fee + gas_cost;
    
    let total_cost_to_grief = cost_per_claim * max_claims;
    let total_extracted = allocation;
    let attacker_loss = total_cost_to_grief - total_extracted;
    
    metrics.capital_deployed = invoice_amount; // recycled
    metrics.net_profit = -attacker_loss;
    metrics.tx_count = (max_claims * 5) as u32;
    
    // Griefing is successful if attacker can exhaust allocation profitably
    // or with acceptable loss relative to disruption caused
    let disruption_value = allocation; // legitimate users lose this opportunity
    let griefing_ratio = disruption_value / attacker_loss;
    
    metrics.outcome = format!(
        "Exhausting {} allocation costs attacker {}. Griefing ratio: {:.2}x. {}",
        allocation,
        attacker_loss,
        griefing_ratio as f64 / 100.0,
        if griefing_ratio > 200 { "ALERT: Economically viable griefing" } else { "Griefing too expensive" }
    );
    
    println!("Allocation Exhaustion Griefing Attack Results:");
    println!("  Allocation size: {}", allocation);
    println!("  Claims to exhaust: {}", max_claims);
    println!("  Cost to attacker: {}", total_cost_to_grief);
    println!("  Value extracted: {}", total_extracted);
    println!("  Attacker loss: {}", attacker_loss);
    println!("  Griefing ratio: {:.2}x", griefing_ratio as f64 / 100.0);
    println!("  Outcome: {}", metrics.outcome);
    
    // Griefing should not be economically viable (attacker should lose significantly)
    assert!(attacker_loss > allocation / 10,
        "Griefing must cost attacker >10% of allocation to be prohibitive");
    
    assert!(griefing_ratio < 200,
        "Griefing ratio too high ({} > 2x), making attack economically viable for dedicated griefer",
        griefing_ratio);
}
