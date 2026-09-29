//! TTL (Time-To-Live) Exhaustion Attack Protection
//!
//! Soroban's storage-rent/TTL model means state can be archived or become inaccessible
//! if not proactively extended. This module provides protections against an attacker
//! deliberately allowing critical storage entries to expire to disrupt protocol operation
//! or lock funds.
//!
//! ## Attack Vector
//!
//! A malicious or neglectful actor could:
//! 1. Let critical entries (active position, pool record) lapse
//! 2. Cause fund-lock behind expired state
//! 3. Disrupt operations by forcing expensive restoration
//! 4. Front-run restorations to extract MEV
//!
//! ## Defense Strategy
//!
//! 1. **Automatic extension on access:** Extend TTL as side effect of normal operations
//! 2. **Permissionless bump functions:** Anyone can extend TTL to prevent neglect
//! 3. **Critical-entry prioritization:** Keeper bots monitor high-risk entries
//! 4. **Grace period before archival:** Sufficient time for keeper intervention
//!
//! ## Usage
//!
//! ```ignore
//! use kora_shared::ttl_protection::{extend_critical_entry, CriticalEntryType};
//!
//! // Automatically extend on every access
//! let pool = env.storage().persistent().get(&DataKey::Pool(id));
//! extend_critical_entry(&env, &DataKey::Pool(id), CriticalEntryType::Pool);
//!
//! // Permissionless bump by keeper or user
//! pub fn bump_pool_ttl(env: Env, pool_id: u64) {
//!     extend_critical_entry(&env, &DataKey::Pool(pool_id), CriticalEntryType::Pool);
//! }
//! ```

use soroban_sdk::{Env, IntoVal, TryFromVal, Val};

/// Classification of storage entries by criticality
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CriticalEntryType {
    /// Active pool with investor funds
    Pool,
    /// Active investor position
    Position,
    /// Active invoice (canonical state machine)
    Invoice,
    /// Active marketplace listing
    Listing,
    /// SME profile (identity and credit history)
    SmeProfile,
    /// Verifier registration and stake
    Verifier,
    /// Configuration or admin data
    Config,
    /// Less critical: historical or cached data
    NonCritical,
}

impl CriticalEntryType {
    /// Get recommended TTL threshold for this entry type
    pub fn ttl_threshold(&self) -> u32 {
        match self {
            // High priority: extend when <30 days remain
            CriticalEntryType::Pool => 518_400,       // ~30 days
            CriticalEntryType::Position => 518_400,   // ~30 days
            CriticalEntryType::Invoice => 518_400,    // ~30 days
            CriticalEntryType::Listing => 518_400,    // ~30 days
            
            // Medium priority: extend when <15 days remain
            CriticalEntryType::SmeProfile => 259_200,  // ~15 days
            CriticalEntryType::Verifier => 259_200,    // ~15 days
            CriticalEntryType::Config => 259_200,      // ~15 days
            
            // Low priority: extend when <7 days remain
            CriticalEntryType::NonCritical => 120_960, // ~7 days
        }
    }

    /// Get TTL bump amount (how much to extend when bumping)
    pub fn ttl_bump(&self) -> u32 {
        match self {
            // High priority: extend for 60 days
            CriticalEntryType::Pool => 1_036_800,      // ~60 days
            CriticalEntryType::Position => 1_036_800,  // ~60 days
            CriticalEntryType::Invoice => 1_036_800,   // ~60 days
            CriticalEntryType::Listing => 1_036_800,   // ~60 days
            
            // Medium priority: extend for 30 days
            CriticalEntryType::SmeProfile => 518_400,  // ~30 days
            CriticalEntryType::Verifier => 518_400,    // ~30 days
            CriticalEntryType::Config => 518_400,      // ~30 days
            
            // Low priority: extend for 15 days
            CriticalEntryType::NonCritical => 259_200, // ~15 days
        }
    }

    /// Check if entry is fund-critical (archival would lock funds)
    pub fn is_fund_critical(&self) -> bool {
        matches!(
            self,
            CriticalEntryType::Pool
                | CriticalEntryType::Position
                | CriticalEntryType::Invoice
                | CriticalEntryType::Listing
        )
    }
}

/// Extend TTL of a critical storage entry
///
/// Call this on every access to critical entries to ensure they never expire.
/// Uses the entry type's recommended threshold and bump amount.
pub fn extend_critical_entry<K>(env: &Env, key: &K, entry_type: CriticalEntryType)
where
    K: IntoVal<Env, Val> + TryFromVal<Env, Val>,
{
    let threshold = entry_type.ttl_threshold();
    let bump = entry_type.ttl_bump();
    
    env.storage().persistent().extend_ttl(key, threshold, bump);
}

/// Extend TTL with custom threshold and bump
///
/// Use when default values aren't appropriate for specific use case.
pub fn extend_entry_custom<K>(env: &Env, key: &K, threshold: u32, bump: u32)
where
    K: IntoVal<Env, Val> + TryFromVal<Env, Val>,
{
    env.storage().persistent().extend_ttl(key, threshold, bump);
}

/// Extend instance storage TTL (single TTL shared by all instance keys)
pub fn extend_instance_storage(env: &Env, threshold: u32, bump: u32) {
    env.storage().instance().extend_ttl(threshold, bump);
}

/// Check if an entry is at risk of expiring soon
///
/// Note: Soroban SDK doesn't expose remaining TTL directly, so this function
/// documents the CHECK pattern that should be used off-chain by keeper bots.
///
/// Keeper implementation:
/// ```ignore
/// use stellar_sdk::getLedgerEntries;
///
/// let entry = getLedgerEntries([key]);
/// let remaining_ttl = entry.liveUntilLedger - currentLedger;
/// if remaining_ttl < threshold {
///     contract.bump_ttl(key);
/// }
/// ```
pub fn is_at_risk_doc() -> &'static str {
    "Check remaining TTL via Stellar RPC getLedgerEntries. \
     If liveUntilLedger - currentLedger < threshold, call bump function."
}

/// Calculate cost to extend TTL for a given entry size
///
/// Rough estimate: 0.0001 XLM per ledger per entry
/// Actual cost depends on entry byte size and current fee schedule.
pub fn estimate_extension_cost_stroops(entry_size_bytes: u32, ledgers: u32) -> i64 {
    let base_cost = 100i64; // Base transaction fee
    let storage_cost = (entry_size_bytes as i64) * (ledgers as i64) / 1000;
    base_cost + storage_cost
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_critical_entry_thresholds() {
        // Fund-critical entries have longest thresholds
        assert_eq!(CriticalEntryType::Pool.ttl_threshold(), 518_400);
        assert_eq!(CriticalEntryType::Position.ttl_threshold(), 518_400);
        assert_eq!(CriticalEntryType::Invoice.ttl_threshold(), 518_400);
        
        // Medium priority entries
        assert_eq!(CriticalEntryType::SmeProfile.ttl_threshold(), 259_200);
        assert_eq!(CriticalEntryType::Verifier.ttl_threshold(), 259_200);
        
        // Low priority entries
        assert_eq!(CriticalEntryType::NonCritical.ttl_threshold(), 120_960);
    }

    #[test]
    fn test_critical_entry_bumps() {
        // Fund-critical entries get longest extensions
        assert_eq!(CriticalEntryType::Pool.ttl_bump(), 1_036_800);
        assert_eq!(CriticalEntryType::Position.ttl_bump(), 1_036_800);
        
        // Medium priority entries
        assert_eq!(CriticalEntryType::SmeProfile.ttl_bump(), 518_400);
        
        // Low priority entries
        assert_eq!(CriticalEntryType::NonCritical.ttl_bump(), 259_200);
    }

    #[test]
    fn test_fund_critical_classification() {
        assert!(CriticalEntryType::Pool.is_fund_critical());
        assert!(CriticalEntryType::Position.is_fund_critical());
        assert!(CriticalEntryType::Invoice.is_fund_critical());
        assert!(CriticalEntryType::Listing.is_fund_critical());
        
        assert!(!CriticalEntryType::SmeProfile.is_fund_critical());
        assert!(!CriticalEntryType::Verifier.is_fund_critical());
        assert!(!CriticalEntryType::Config.is_fund_critical());
        assert!(!CriticalEntryType::NonCritical.is_fund_critical());
    }

    #[test]
    fn test_extension_cost_estimate() {
        // Small entry for 30 days
        let cost = estimate_extension_cost_stroops(1000, 518_400);
        assert!(cost > 0);
        assert!(cost < 1_000_000); // Should be reasonable
        
        // Large entry for 60 days
        let cost = estimate_extension_cost_stroops(10_000, 1_036_800);
        assert!(cost > 0);
    }

    #[test]
    fn test_cost_scales_with_size() {
        let small = estimate_extension_cost_stroops(1000, 518_400);
        let large = estimate_extension_cost_stroops(10_000, 518_400);
        assert!(large > small);
    }

    #[test]
    fn test_cost_scales_with_duration() {
        let short = estimate_extension_cost_stroops(1000, 259_200);
        let long = estimate_extension_cost_stroops(1000, 518_400);
        assert!(long > short);
    }
}
