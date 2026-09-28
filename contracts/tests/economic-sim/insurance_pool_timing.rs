//! Insurance pool claim-timing manipulation attack simulation
//!
//! ## Attack Vector
//!
//! An attacker with knowledge of impending defaults attempts to:
//! 1. Time insurance claims to maximize payout before pool insolvency
//! 2. Manipulate pool reserves through coordinated claim timing
//! 3. Front-run legitimate claimants by observing pending defaults
//! 4. Drain pool reserves through strategic default timing if they control debtor
//!
//! ## Expected Defenses
//!
//! - Fair claim ordering (FIFO or timestamp-based, not gas-price auction)
//! - Grace periods preventing immediate claim after default
//! - Solvency checks preventing over-payment
//! - Default marking requires verification, preventing false claims

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

use crate::economic_sim::{AttackMetrics, estimate_gas_cost};

fn setup_insurance_env() -> (
    Env,
    Address, // admin
    Address, // attacker_investor
    Address, // attacker_debtor
    i128,    // pool_reserves
    i128,    // total_insured
) {
    let env = Env::default();
    env.mock_all_auths();
    
    env.ledger().set(LedgerInfo {
        timestamp: 1_700_000_000,
        protocol_version: 21,
        sequence_number: 10_000,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 1000,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 600_000,
    });

    let admin = Address::generate(&env);
    let attacker_investor = Address::generate(&env);
    let attacker_debtor = Address::generate(&env);
    
    // Pool is under-reserved (typical risk condition)
    let pool_reserves = 2_000_000_000_000i128; // 2M reserves
    let total_insured = 10_000_000_000_000i128; // 10M total insured value

    (env, admin, attacker_investor, attacker_debtor, pool_reserves, total_insured)
}

#[test]
fn test_front_running_insurance_claims() {
    let (env, _admin, attacker, _debtor, pool_reserves, _total_insured) = setup_insurance_env();
    
    let mut metrics = AttackMetrics::new();
    
    // Scenario: Attacker observes a large default about to be marked
    // They front-run by marking their own small default first to claim
    // before pool reserves are exhausted
    
    let attacker_position = 100_000_000_000i128; // 100K position
    let other_defaults_incoming = 3_000_000_000_000i128; // 3M in other defaults
    
    metrics.capital_deployed = attacker_position;
    
    // If attacker claims first, they get full insurance payout
    let insurance_payout = attacker_position; // assuming 100% coverage
    
    // Cost to front-run: gas for faster transaction
    let front_run_gas_premium = estimate_gas_cost(30) * 10; // 10x gas
    metrics.tx_count = 1;
    metrics.estimated_gas_cost = front_run_gas_premium;
    
    // After attacker claims, pool has reduced reserves
    let remaining_reserves = pool_reserves - insurance_payout;
    
    // Other claims get pro-rata share of remaining reserves
    let other_claimants_shortfall = other_defaults_incoming - remaining_reserves;
    
    if remaining_reserves < other_defaults_incoming {
        // Attacker successfully front-ran before insolvency
        metrics.net_profit = insurance_payout - attacker_position - (front_run_gas_premium * 1_000);
        metrics.outcome = format!(
            "Front-running SUCCESSFUL. Attacker got full payout while others face {}% shortfall. ALERT: No fair ordering!",
            (other_claimants_shortfall * 100) / other_defaults_incoming
        );
    } else {
        // Pool had enough reserves anyway
        metrics.net_profit = 0; // would have gotten paid anyway
        metrics.outcome = format!(
            "Front-running UNNECESSARY. Pool had sufficient reserves. No advantage gained."
        );
    }
    
    println!("Insurance Claim Front-Running Attack Results:");
    println!("  Pool reserves: {}", pool_reserves);
    println!("  Attacker position: {}", attacker_position);
    println!("  Other defaults: {}", other_defaults_incoming);
    println!("  Remaining after attacker: {}", remaining_reserves);
    println!("  Others' shortfall: {}", other_claimants_shortfall);
    println!("  Attacker net profit: {}", metrics.net_profit);
    println!("  Outcome: {}", metrics.outcome);
    
    // Defense: Claims should be ordered fairly (e.g., by default timestamp, not tx order)
    // This test documents the NEED for that defense
    if other_claimants_shortfall > 0 {
        println!("  RECOMMENDATION: Implement fair claim ordering (FIFO by default timestamp)");
    }
}

#[test]
fn test_strategic_default_timing() {
    let (env, _admin, attacker, attacker_debtor, pool_reserves, _total_insured) = setup_insurance_env();
    
    let mut metrics = AttackMetrics::new();
    
    // Scenario: Attacker controls both debtor and investor positions
    // They strategically time a controlled default when pool reserves are high
    // and competition for claims is low
    
    let attacker_invested = 500_000_000_000i128; // 500K invested
    let attacker_borrowed = 500_000_000_000i128; // 500K borrowed (as debtor)
    
    metrics.capital_deployed = attacker_invested;
    
    // Attacker defaults on the borrowed amount (loses debtor reputation/bond)
    let debtor_bond_lost = 50_000_000_000i128; // 50K bond forfeited
    
    // Attacker claims insurance on their investor position
    let insurance_claimed = attacker_invested; // full coverage
    
    // Net profit from strategic default
    metrics.net_profit = insurance_claimed - debtor_bond_lost;
    metrics.tx_count = 2; // mark default + claim insurance
    metrics.estimated_gas_cost = estimate_gas_cost(40) * 2;
    
    // Subtract gas
    metrics.net_profit -= metrics.estimated_gas_cost * 1_000;
    
    // Check if this is profitable
    if metrics.net_profit > 0 {
        metrics.outcome = format!(
            "ALERT: Strategic default is PROFITABLE! Attacker nets {} by defaulting and claiming insurance. FIX: Increase debtor bonds or reduce insurance coverage.",
            metrics.net_profit
        );
    } else {
        metrics.outcome = format!(
            "Strategic default is UNPROFITABLE. Attacker loses {} due to bond forfeiture. Attack FAILED.",
            -metrics.net_profit
        );
    }
    
    println!("Strategic Default Timing Attack Results:");
    println!("  Amount borrowed: {}", attacker_borrowed);
    println!("  Amount invested: {}", attacker_invested);
    println!("  Bond forfeited: {}", debtor_bond_lost);
    println!("  Insurance claimed: {}", insurance_claimed);
    println!("  Net profit: {}", metrics.net_profit);
    println!("  Outcome: {}", metrics.outcome);
    
    assert!(!metrics.is_exploitable(),
        "Strategic default EXPLOIT DETECTED: {:?}", metrics);
    
    assert!(metrics.net_profit <= 0,
        "CRITICAL: Strategic default is profitable! Debtor bonds ({}) must exceed insurance coverage ({})",
        debtor_bond_lost, insurance_claimed);
}

#[test]
fn test_pool_insolvency_cascade() {
    let (env, _admin, _attacker, _debtor, mut pool_reserves, total_insured) = setup_insurance_env();
    
    let mut metrics = AttackMetrics::new();
    
    // Scenario: Multiple coordinated attackers trigger defaults simultaneously
    // to exhaust pool reserves and create a "bank run" scenario
    
    let num_attackers = 10;
    let position_per_attacker = 300_000_000_000i128; // 300K each
    let total_default_value = position_per_attacker * num_attackers;
    
    metrics.capital_deployed = total_default_value;
    
    // Cost per attacker: bond forfeiture + gas
    let bond_per_attacker = 30_000_000_000i128; // 30K bond (10% of position)
    let total_bonds_lost = bond_per_attacker * num_attackers;
    
    metrics.tx_count = (num_attackers * 2) as u32;
    metrics.estimated_gas_cost = estimate_gas_cost(40) * (num_attackers * 2) as i128;
    
    // Process claims in order
    let mut claims_paid = 0i128;
    let mut claims_shortfall = 0i128;
    
    for i in 0..num_attackers {
        if pool_reserves >= position_per_attacker {
            // Full claim paid
            claims_paid += position_per_attacker;
            pool_reserves -= position_per_attacker;
        } else {
            // Partial or no payment
            claims_paid += pool_reserves;
            claims_shortfall += position_per_attacker - pool_reserves;
            pool_reserves = 0;
        }
    }
    
    // Net profit for attackers: insurance claims - bonds - capital
    // Note: attackers don't lose capital if they genuinely default, only bond
    metrics.net_profit = claims_paid - total_bonds_lost - (metrics.estimated_gas_cost * 1_000);
    
    let solvency_ratio = (claims_paid * 100) / total_default_value;
    
    metrics.outcome = format!(
        "Coordinated default cascade: {} simultaneous defaults. Pool paid {}% of claims. Attackers {} {}. {}",
        num_attackers,
        solvency_ratio,
        if metrics.net_profit > 0 { "profit" } else { "lose" },
        metrics.net_profit.abs(),
        if solvency_ratio < 50 { "ALERT: Pool insolvency exploitable!" } else { "Pool maintained solvency" }
    );
    
    println!("Pool Insolvency Cascade Attack Results:");
    println!("  Coordinated attackers: {}", num_attackers);
    println!("  Total defaults: {}", total_default_value);
    println!("  Claims paid: {}", claims_paid);
    println!("  Claims shortfall: {}", claims_shortfall);
    println!("  Solvency ratio: {}%", solvency_ratio);
    println!("  Total bonds lost: {}", total_bonds_lost);
    println!("  Attackers net: {}", metrics.net_profit);
    println!("  Outcome: {}", metrics.outcome);
    
    // Pool should maintain reasonable solvency ratio
    assert!(solvency_ratio >= 50,
        "CRITICAL: Pool insolvency too severe ({}%). Increase reserve requirements!",
        solvency_ratio);
    
    // Attack should not be profitable for coordinated defaulters
    assert!(!metrics.is_exploitable(),
        "Coordinated default cascade EXPLOIT DETECTED: {:?}", metrics);
}

#[test]
fn test_grace_period_gaming() {
    let (mut env, _admin, attacker, _debtor, pool_reserves, _total_insured) = setup_insurance_env();
    
    let mut metrics = AttackMetrics::new();
    
    // Scenario: Attacker tries to game grace period to maximize claim value
    // E.g., waiting until last moment of grace period to see if debtor repays
    // or claiming immediately to get ahead in queue
    
    let attacker_position = 200_000_000_000i128; // 200K position
    let grace_period_ledgers = 17_280; // ~1 day
    
    metrics.capital_deployed = attacker_position;
    
    // Strategy 1: Claim immediately after default
    // Pro: First in queue
    // Con: Might claim unnecessarily if debtor repays in grace period
    
    // Strategy 2: Wait until end of grace period
    // Pro: Know if debtor will repay
    // Con: Might be behind other claimants in queue
    
    // Simulate: 20% chance debtor repays during grace period
    let repayment_probability = 20; // 20%
    
    // Expected value of claiming immediately
    let ev_immediate = attacker_position; // always claims
    
    // Expected value of waiting
    // 80% * full_claim + 20% * (repaid, no claim needed) + queue_position_risk
    let queue_position_penalty = attacker_position / 20; // 5% penalty for being later in queue
    let ev_wait = (attacker_position * 80 / 100) - queue_position_penalty;
    
    let optimal_strategy = if ev_immediate > ev_wait { "immediate" } else { "wait" };
    let advantage = (ev_immediate - ev_wait).abs();
    
    metrics.tx_count = 1;
    metrics.estimated_gas_cost = estimate_gas_cost(30);
    
    // Net profit is just the claim (not really an "attack", more gaming)
    metrics.net_profit = if optimal_strategy == "immediate" { 0 } else { -queue_position_penalty };
    
    metrics.outcome = format!(
        "Grace period gaming: optimal strategy is '{}', advantage: {}. {}",
        optimal_strategy,
        advantage,
        if advantage > attacker_position / 10 { "ALERT: Significant gaming incentive" } else { "Minimal gaming benefit" }
    );
    
    println!("Grace Period Gaming Attack Results:");
    println!("  Position: {}", attacker_position);
    println!("  Grace period: {} ledgers", grace_period_ledgers);
    println!("  EV (claim immediately): {}", ev_immediate);
    println!("  EV (wait): {}", ev_wait);
    println!("  Optimal strategy: {}", optimal_strategy);
    println!("  Advantage: {}", advantage);
    println!("  Outcome: {}", metrics.outcome);
    
    // Gaming advantage should be minimal
    assert!(advantage < attacker_position / 20,
        "Grace period gaming advantage too high ({}), creates unfair queue manipulation",
        advantage);
}
