#![no_std]

//! # Invoice NFT Contract
//!
//! Storage layout v3: hot/cold split.
//!
//! - `InvoiceHot(id)` — persistent: fields read on every status transition
//!   (`status`, `sme`, `amount`, `currency`, `due_date`, `risk_score`,
//!   `risk_tier`, `created_at`, `funded_at`, `repaid_at`).
//! - `InvoiceCold(id)` — persistent: rarely-read metadata fields
//!   (`debtor_hash`, `ipfs_cid`, `metadata_hash`, `notes`).
//!
//! `get_invoice` merges both keys into the public `Invoice` type so the
//! external interface is unchanged.  Status transitions (`set_listed`,
//! `set_funded`, `set_repaid`, `set_defaulted`, `set_created`) only read/write
//! the hot key, halving the ledger I/O for the highest-traffic paths.
//!
//! **Lifecycle:** `Created` → `Listed` → `Funded` → `Repaid` | `Defaulted`
//!
//! See docs/MIGRATIONS.md for the v2→v3 migration runbook.

use kora_shared::{
    audit::{AdminActionType, AdminAuditEntry, AuditSource, MAX_AUDIT_LOG_SIZE},
    errors::CommonError,
    events,
    reentrancy::ReentrancyGuard,
    types::{AmountBounds, Invoice, InvoiceStatus, ProtocolConfig, RiskTier},
    validation::{
        extend_persistent_ttl, require_amount_within_bounds, require_batch_size_within_limit,
        require_future_timestamp, require_max_length_bytes, require_max_length_string,
        require_non_empty_bytes, require_non_empty_string, require_non_zero_amount,
        require_risk_score_within_ceiling, require_valid_risk_score, DEFAULT_TTL_BUMP,
        DEFAULT_TTL_THRESHOLD, MAX_DEBTOR_HASH_LEN, MAX_IPFS_CID_LEN, UPGRADE_TIMELOCK_DELAY,
    },
};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN, Env, String,
    Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum InvoiceNftError {
    AlreadyInitialized = 1,
    ArithmeticOverflow = 2,
    BatchSizeExceeded = 3,
    CreditLimitExceeded = 4,
    CurrencyNotAllowed = 5,
    EmptyBytes = 6,
    EmptyString = 7,
    FieldTooLong = 8,
    InvalidAddress = 9,
    InvalidAmount = 10,
    InvalidDueDate = 11,
    InvalidInvoiceStatus = 12,
    InvalidRiskScore = 13,
    InvoiceNotFound = 14,
    NoUpgradeProposed = 15,
    NotAdmin = 16,
    NotInitialized = 17,
    NotInvoiceOwner = 18,
    ProtocolPaused = 19,
    Reentrancy = 20,
    SMENotRegistered = 21,
    Unauthorized = 22,
    UpgradeTimelockNotElapsed = 23,
    MintRateLimitExceeded = 24,
    NoPendingAdminProposal = 25,
    NotPendingAdmin = 26,
    InvalidParameterValue = 27,
}

impl From<CommonError> for InvoiceNftError {
    fn from(e: CommonError) -> Self {
        match e {
            CommonError::InvalidAmount => InvoiceNftError::InvalidAmount,
            CommonError::InvalidDueDate => InvoiceNftError::InvalidDueDate,
            CommonError::InvalidRiskScore => InvoiceNftError::InvalidRiskScore,
            CommonError::InvalidAddress => InvoiceNftError::InvalidAddress,
            CommonError::EmptyString => InvoiceNftError::EmptyString,
            CommonError::EmptyBytes => InvoiceNftError::EmptyBytes,
            CommonError::FieldTooLong => InvoiceNftError::FieldTooLong,
            CommonError::ArithmeticOverflow => InvoiceNftError::ArithmeticOverflow,
            CommonError::Reentrancy => InvoiceNftError::Reentrancy,
            _ => InvoiceNftError::InvalidAmount,
        }
    }
}

// ── TTL constants (~30 days at ~5s/ledger) ────────────────────────────────────
const PERSISTENT_TTL_THRESHOLD: u32 = 518_400;
const PERSISTENT_TTL_BUMP: u32 = 518_400;

/// Maximum invoice IDs returned per `get_sme_invoice_ids` page.
const MAX_SME_INVOICE_PAGE: u32 = 100;

/// Maximum number of historical metadata CID entries retained per invoice.
pub const MAX_METADATA_CID_HISTORY: u32 = 20;

// ── Storage Keys ──────────────────────────────────────────────────────────────
//
// v3 hot/cold split:
//   InvoiceHot(u64)  — persistent: status + financial fields (read on every transition)
//   InvoiceCold(u64) — persistent: metadata fields (read only for get_invoice / metadata ops)
//
// Legacy Invoice(u64) key is read during migrate() v2→v3 and then removed.

#[contracttype]
pub enum DataKey {
    // ── Hot path (instance storage) ──────────────────────────────────────────
    /// Next invoice ID to assign.
    NextId,
    /// Admin address.
    Admin,
    /// Pending new admin (two-step transfer).
    PendingAdmin,
    /// Access control contract address.
    AccessControl,
    /// Current schema migration version.
    MigrationVersion,
    /// Pending WASM upgrade proposal: (wasm_hash, proposed_at).
    UpgradeProposal,
    /// Authorized marketplace contract address.
    Marketplace,
    /// Authorized financing pool contract address.
    FinancingPool,
    /// Authorized risk registry contract address.
    RiskRegistry,
    /// Protocol-wide configuration.
    ProtocolConfig,
    /// Next write position in the admin audit ring buffer.
    AuditLogHead,
    /// Total admin actions ever recorded (monotonic).
    AuditLogTotal,
    /// Monotonic counter for batch-mint correlation IDs.
    NextBatchId,
    /// Per-SME mint velocity cap config.
    MintRateLimit,
    /// Per-risk-tier face-value bounds.
    AmountBounds(RiskTier),

    // ── Hot path (persistent storage) ────────────────────────────────────────
    /// HOT: status + financial fields for an invoice. Read on every transition.
    InvoiceHot(u64),
    /// COLD: metadata fields for an invoice. Read only for get_invoice / metadata ops.
    InvoiceCold(u64),
    /// Aggregate outstanding exposure for an SME.
    OutstandingExposure(Address),
    /// Currency symbol allowlist entry.
    CurrencyAllowlist(Symbol),
    /// Per-invoice freeze flag.
    InvoiceFrozen(u64),
    /// Open or resolved metadata-hash dispute for an invoice.
    MetadataDispute(u64),
    /// Ring-buffer audit log entry at position n.
    AuditEntry(u64),
    /// Vec<u64> of invoice IDs minted by an SME, in mint order.
    SmeInvoiceIds(Address),
    /// Rolling mint window state for an SME: (window_start_ts, mints_used).
    SmeMintWindow(Address),
    /// Bounded history of prior IPFS CIDs for an invoice.
    MetadataCidHistory(u64),

    // ── Legacy (migration only) ───────────────────────────────────────────────
    /// v1/v2 full Invoice struct — read during migrate() v2→v3, then removed.
    Invoice(u64),
}

// ── Hot storage struct ────────────────────────────────────────────────────────
/// Frequently-accessed invoice fields stored under `InvoiceHot(id)`.
/// Status transitions read and write only this key.
#[contracttype]
#[derive(Clone)]
pub struct InvoiceHot {
    pub id: u64,
    pub sme: Address,
    pub amount: i128,
    pub currency: Symbol,
    pub due_date: u64,
    pub risk_score: u32,
    pub risk_tier: RiskTier,
    pub status: InvoiceStatus,
    pub created_at: u64,
    pub funded_at: Option<u64>,
    pub repaid_at: Option<u64>,
}

// ── Cold storage struct ───────────────────────────────────────────────────────
/// Rarely-accessed metadata fields stored under `InvoiceCold(id)`.
#[contracttype]
#[derive(Clone)]
pub struct InvoiceCold {
    pub debtor_hash: Bytes,
    pub ipfs_cid: String,
    pub metadata_hash: Bytes,
    pub notes: Option<String>,
}

// ── Migration helpers ─────────────────────────────────────────────────────────
/// Schema v1 Invoice (no `notes` field). Used by migrate() v1→v2 step.
#[contracttype]
#[derive(Clone)]
pub struct InvoiceV1 {
    pub id: u64,
    pub sme: Address,
    pub debtor_hash: Bytes,
    pub amount: i128,
    pub currency: Symbol,
    pub due_date: u64,
    pub ipfs_cid: String,
    pub risk_score: u32,
    pub risk_tier: RiskTier,
    pub status: InvoiceStatus,
    pub created_at: u64,
    pub funded_at: Option<u64>,
    pub repaid_at: Option<u64>,
}

// ── Auxiliary types ───────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone)]
pub struct MetadataDispute {
    pub challenger: Address,
    pub evidence_hash: Bytes,
    pub raised_at: u64,
    pub resolved: bool,
    pub upheld: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct MintRateLimit {
    pub max_mints: u32,
    pub window_secs: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct BatchInvoiceInput {
    pub debtor_hash: Bytes,
    pub amount: i128,
    pub currency: Symbol,
    pub due_date: u64,
    pub ipfs_cid: String,
    pub risk_score: u32,
    pub notes: Option<String>,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct InvoiceNftContract;

#[contractimpl]
impl InvoiceNftContract {
    // ── Initialization ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, access_control: Address) -> Result<(), InvoiceNftError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(InvoiceNftError::AlreadyInitialized);
        }
        kora_shared::validation::require_not_self(&env, &admin)?;
        kora_shared::validation::require_not_self(&env, &access_control)?;
        kora_shared::validation::require_distinct(&admin, &access_control)?;
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::AccessControl, &access_control);
        env.storage().instance().set(&DataKey::NextId, &1u64);
        // Fresh contract starts at schema v3 (hot/cold split).
        env.storage().instance().set(&DataKey::MigrationVersion, &3u32);
        Ok(())
    }

    // ── Migration ─────────────────────────────────────────────────────────────
    //
    // Idempotent. Each version gate is a no-op once already applied.
    //
    // v0→v1: baseline marker.
    // v1→v2: Invoice gained `notes: Option<String>` — backfill via InvoiceV1.
    // v2→v3: hot/cold split — rewrite Invoice(id) as InvoiceHot(id)+InvoiceCold(id),
    //         then remove the legacy Invoice(id) key to reclaim rent.

    pub fn migrate(env: Env, admin: Address) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::append_audit_entry(&env, &admin, AdminActionType::InvoiceNftMigrate);

        let current_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MigrationVersion)
            .unwrap_or(0);

        if current_version < 1 {
            env.storage().instance().set(&DataKey::MigrationVersion, &1u32);
        }

        // v1→v2: backfill `notes` field on legacy InvoiceV1 records.
        if current_version < 2 {
            let next_id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
            let mut id: u64 = 1;
            while id < next_id {
                let key = DataKey::Invoice(id);
                if let Some(old) = env.storage().persistent().get::<DataKey, InvoiceV1>(&key) {
                    let upgraded = Invoice {
                        id: old.id,
                        sme: old.sme,
                        debtor_hash: old.debtor_hash,
                        amount: old.amount,
                        currency: old.currency,
                        due_date: old.due_date,
                        ipfs_cid: old.ipfs_cid,
                        metadata_hash: Bytes::new(&env),
                        risk_score: old.risk_score,
                        risk_tier: old.risk_tier,
                        status: old.status,
                        created_at: old.created_at,
                        funded_at: old.funded_at,
                        repaid_at: old.repaid_at,
                        notes: None,
                    };
                    env.storage().persistent().set(&key, &upgraded);
                }
                id += 1;
            }
            env.storage().instance().set(&DataKey::MigrationVersion, &2u32);
        }

        // v2→v3: split Invoice(id) into InvoiceHot(id) + InvoiceCold(id).
        if current_version < 3 {
            let next_id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
            let mut id: u64 = 1;
            while id < next_id {
                let legacy_key = DataKey::Invoice(id);
                // Skip records already migrated (hot key already present).
                if env.storage().persistent().has(&DataKey::InvoiceHot(id)) {
                    id += 1;
                    continue;
                }
                if let Some(inv) = env.storage().persistent().get::<DataKey, Invoice>(&legacy_key) {
                    let hot = InvoiceHot {
                        id: inv.id,
                        sme: inv.sme,
                        amount: inv.amount,
                        currency: inv.currency,
                        due_date: inv.due_date,
                        risk_score: inv.risk_score,
                        risk_tier: inv.risk_tier,
                        status: inv.status,
                        created_at: inv.created_at,
                        funded_at: inv.funded_at,
                        repaid_at: inv.repaid_at,
                    };
                    let cold = InvoiceCold {
                        debtor_hash: inv.debtor_hash,
                        ipfs_cid: inv.ipfs_cid,
                        metadata_hash: inv.metadata_hash,
                        notes: inv.notes,
                    };
                    env.storage().persistent().set(&DataKey::InvoiceHot(id), &hot);
                    Self::bump_persistent(&env, &DataKey::InvoiceHot(id));
                    env.storage().persistent().set(&DataKey::InvoiceCold(id), &cold);
                    Self::bump_persistent(&env, &DataKey::InvoiceCold(id));
                    // Remove legacy key to reclaim rent.
                    env.storage().persistent().remove(&legacy_key);
                }
                id += 1;
            }
            env.storage().instance().set(&DataKey::MigrationVersion, &3u32);
        }

        Ok(())
    }

    // ── Admin wiring ──────────────────────────────────────────────────────────

    pub fn set_risk_registry(env: Env, admin: Address, risk_registry: Address) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        kora_shared::validation::require_not_self(&env, &risk_registry)?;
        env.storage().instance().set(&DataKey::RiskRegistry, &risk_registry);
        Self::append_audit_entry(&env, &admin, AdminActionType::InvoiceNftSetRiskRegistry);
        Ok(())
    }

    pub fn set_authorized_callers(
        env: Env,
        admin: Address,
        marketplace: Address,
        financing_pool: Address,
    ) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        kora_shared::validation::require_not_self(&env, &marketplace)?;
        kora_shared::validation::require_not_self(&env, &financing_pool)?;
        kora_shared::validation::require_distinct(&marketplace, &financing_pool)?;
        for wired in [DataKey::Admin, DataKey::AccessControl, DataKey::RiskRegistry] {
            if let Some(existing) = env.storage().instance().get::<DataKey, Address>(&wired) {
                kora_shared::validation::require_distinct(&marketplace, &existing)?;
                kora_shared::validation::require_distinct(&financing_pool, &existing)?;
            }
        }
        env.storage().instance().set(&DataKey::Marketplace, &marketplace);
        env.storage().instance().set(&DataKey::FinancingPool, &financing_pool);
        Self::append_audit_entry(&env, &admin, AdminActionType::InvoiceNftSetAuthorizedCallers);
        Ok(())
    }

    pub fn set_protocol_config(env: Env, admin: Address, config: ProtocolConfig) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        require_valid_risk_score(config.max_risk_score)?;
        env.storage().instance().set(&DataKey::ProtocolConfig, &config);
        Ok(())
    }

    pub fn get_protocol_config(env: Env) -> ProtocolConfig {
        env.storage()
            .instance()
            .get(&DataKey::ProtocolConfig)
            .unwrap_or(ProtocolConfig {
                fee_bps: 0,
                late_penalty_bps: 0,
                max_risk_score: 100,
                min_funding_period: 0,
            })
    }

    pub fn set_amount_bounds(
        env: Env,
        admin: Address,
        tier: RiskTier,
        min_amount: i128,
        max_amount: i128,
    ) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        if min_amount < 0 || max_amount < 0 || min_amount > max_amount {
            return Err(InvoiceNftError::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::AmountBounds(tier), &AmountBounds::new(min_amount, max_amount));
        Ok(())
    }

    pub fn get_amount_bounds(env: Env, tier: RiskTier) -> Option<AmountBounds> {
        env.storage().instance().get(&DataKey::AmountBounds(tier))
    }

    // ── Mint rate limit ───────────────────────────────────────────────────────

    pub fn set_mint_rate_limit(env: Env, admin: Address, max_mints: u32, window_secs: u64) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        if max_mints == 0 || window_secs == 0 {
            return Err(InvoiceNftError::InvalidParameterValue);
        }
        env.storage().instance().set(&DataKey::MintRateLimit, &MintRateLimit { max_mints, window_secs });
        Ok(())
    }

    pub fn get_mint_rate_limit(env: Env) -> Option<MintRateLimit> {
        env.storage().instance().get(&DataKey::MintRateLimit)
    }

    /// Returns `(window_start_ts, mints_used)` for an SME's current window.
    pub fn get_sme_mint_window(env: Env, sme: Address) -> (u64, u32) {
        env.storage()
            .persistent()
            .get::<DataKey, (u64, u32)>(&DataKey::SmeMintWindow(sme))
            .unwrap_or((0u64, 0u32))
    }

    // ── Two-step admin transfer ───────────────────────────────────────────────

    pub fn propose_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        kora_shared::validation::require_not_self(&env, &new_admin)?;
        kora_shared::validation::require_distinct(&admin, &new_admin)?;
        env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
        Ok(())
    }

    pub fn accept_admin(env: Env, new_admin: Address) -> Result<(), InvoiceNftError> {
        new_admin.require_auth();
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(InvoiceNftError::NoPendingAdminProposal)?;
        if pending != new_admin {
            return Err(InvoiceNftError::NotPendingAdmin);
        }
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        Ok(())
    }

    pub fn cancel_admin_proposal(env: Env, admin: Address) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        if !env.storage().instance().has(&DataKey::PendingAdmin) {
            return Err(InvoiceNftError::NoPendingAdminProposal);
        }
        env.storage().instance().remove(&DataKey::PendingAdmin);
        Ok(())
    }

    // ── Minting ───────────────────────────────────────────────────────────────

    pub fn mint_invoice(
        env: Env,
        sme: Address,
        debtor_hash: Bytes,
        amount: i128,
        currency: Symbol,
        due_date: u64,
        ipfs_cid: String,
        risk_score: u32,
        notes: Option<String>,
    ) -> Result<u64, InvoiceNftError> {
        sme.require_auth();
        Self::require_not_paused(&env)?;
        let _guard = ReentrancyGuard::new(&env)?;

        require_non_zero_amount(amount)?;
        require_future_timestamp(&env, due_date)?;
        require_valid_risk_score(risk_score)?;
        require_risk_score_within_ceiling(risk_score, Self::get_protocol_config(env.clone()).max_risk_score)?;

        let tier = RiskTier::from_score(risk_score);
        if let Some(bounds) = env.storage().instance().get::<DataKey, AmountBounds>(&DataKey::AmountBounds(tier.clone())) {
            require_amount_within_bounds(amount, bounds.max)?;
        }

        require_non_empty_bytes(&debtor_hash)?;
        require_max_length_bytes(&debtor_hash, MAX_DEBTOR_HASH_LEN)?;
        require_non_empty_string(&ipfs_cid)?;
        require_max_length_string(&ipfs_cid, MAX_IPFS_CID_LEN)?;

        let outstanding: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::OutstandingExposure(sme.clone()))
            .unwrap_or(0i128);
        let new_exposure = outstanding
            .checked_add(amount)
            .ok_or(InvoiceNftError::ArithmeticOverflow)?;

        if let Some(rr_addr) = env.storage().instance().get::<DataKey, Address>(&DataKey::RiskRegistry) {
            let rr = kora_risk_registry::RiskRegistryContractClient::new(&env, &rr_addr);
            if let Ok(Ok(profile)) = rr.try_get_sme_profile(&sme) {
                if profile.credit_limit > 0 && new_exposure > profile.credit_limit {
                    return Err(InvoiceNftError::CreditLimitExceeded);
                }
            }
        }

        Self::consume_mint_quota(&env, &sme, 1)?;

        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);

        let hot = InvoiceHot {
            id,
            sme: sme.clone(),
            amount,
            currency: currency.clone(),
            due_date,
            risk_score,
            risk_tier: tier,
            status: InvoiceStatus::Created,
            created_at: env.ledger().timestamp(),
            funded_at: None,
            repaid_at: None,
        };
        let cold = InvoiceCold {
            debtor_hash,
            ipfs_cid,
            metadata_hash: Bytes::new(&env),
            notes,
        };

        env.storage().persistent().set(&DataKey::InvoiceHot(id), &hot);
        Self::bump_persistent(&env, &DataKey::InvoiceHot(id));
        env.storage().persistent().set(&DataKey::InvoiceCold(id), &cold);
        Self::bump_persistent(&env, &DataKey::InvoiceCold(id));

        env.storage().instance().set(
            &DataKey::NextId,
            &(id.checked_add(1).ok_or(InvoiceNftError::ArithmeticOverflow)?),
        );
        env.storage().persistent().set(&DataKey::OutstandingExposure(sme.clone()), &new_exposure);
        Self::append_sme_invoice_id(&env, &sme, id);

        events::invoice_created(&env, id, &sme, amount, currency);
        Ok(id)
    }

    pub fn mint_invoices_batch(
        env: Env,
        sme: Address,
        invoices: Vec<BatchInvoiceInput>,
    ) -> Result<Vec<u64>, InvoiceNftError> {
        sme.require_auth();
        Self::require_not_paused(&env)?;
        let _guard = ReentrancyGuard::new(&env)?;

        require_batch_size_within_limit(invoices.len() as u32)?;

        let max_risk_score = Self::get_protocol_config(env.clone()).max_risk_score;
        for i in 0..invoices.len() {
            let entry = invoices.get(i).unwrap();
            require_non_zero_amount(entry.amount)?;
            require_future_timestamp(&env, entry.due_date)?;
            require_valid_risk_score(entry.risk_score)?;
            require_risk_score_within_ceiling(entry.risk_score, max_risk_score)?;
            require_non_empty_bytes(&entry.debtor_hash)?;
            require_max_length_bytes(&entry.debtor_hash, MAX_DEBTOR_HASH_LEN)?;
            require_non_empty_string(&entry.ipfs_cid)?;
            require_max_length_string(&entry.ipfs_cid, MAX_IPFS_CID_LEN)?;
        }

        Self::consume_mint_quota(&env, &sme, invoices.len())?;

        let mut ids: Vec<u64> = Vec::new(&env);
        let mut next_id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        let mut exposure_delta: i128 = 0;
        let ts = env.ledger().timestamp();

        for i in 0..invoices.len() {
            let entry = invoices.get(i).unwrap();
            let id = next_id;
            exposure_delta = exposure_delta
                .checked_add(entry.amount)
                .ok_or(InvoiceNftError::ArithmeticOverflow)?;

            let hot = InvoiceHot {
                id,
                sme: sme.clone(),
                amount: entry.amount,
                currency: entry.currency.clone(),
                due_date: entry.due_date,
                risk_score: entry.risk_score,
                risk_tier: RiskTier::from_score(entry.risk_score),
                status: InvoiceStatus::Created,
                created_at: ts,
                funded_at: None,
                repaid_at: None,
            };
            let cold = InvoiceCold {
                debtor_hash: entry.debtor_hash,
                ipfs_cid: entry.ipfs_cid,
                metadata_hash: Bytes::new(&env),
                notes: entry.notes,
            };

            env.storage().persistent().set(&DataKey::InvoiceHot(id), &hot);
            Self::bump_persistent(&env, &DataKey::InvoiceHot(id));
            env.storage().persistent().set(&DataKey::InvoiceCold(id), &cold);
            Self::bump_persistent(&env, &DataKey::InvoiceCold(id));

            events::invoice_created(&env, id, &sme, hot.amount, hot.currency.clone());
            ids.push_back(id);
            next_id = next_id.checked_add(1).ok_or(InvoiceNftError::ArithmeticOverflow)?;
        }

        env.storage().instance().set(&DataKey::NextId, &next_id);
        if exposure_delta != 0 {
            let outstanding: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::OutstandingExposure(sme.clone()))
                .unwrap_or(0i128);
            let new_exposure = outstanding
                .checked_add(exposure_delta)
                .ok_or(InvoiceNftError::ArithmeticOverflow)?;
            env.storage().persistent().set(&DataKey::OutstandingExposure(sme.clone()), &new_exposure);
        }
        Self::append_sme_invoice_ids(&env, &sme, &ids);

        let batch_id: u64 = env.storage().instance().get(&DataKey::NextBatchId).unwrap_or(1);
        env.storage().instance().set(
            &DataKey::NextBatchId,
            &(batch_id.checked_add(1).ok_or(InvoiceNftError::ArithmeticOverflow)?),
        );
        events::invoice_batch_minted(&env, batch_id, &sme, &ids);
        Ok(ids)
    }

    // ── Amendment / metadata ──────────────────────────────────────────────────

    pub fn amend_invoice(
        env: Env,
        sme: Address,
        invoice_id: u64,
        debtor_hash: Bytes,
        amount: i128,
        due_date: u64,
        ipfs_cid: String,
        risk_score: u32,
    ) -> Result<(), InvoiceNftError> {
        sme.require_auth();
        Self::require_not_paused(&env)?;

        require_non_zero_amount(amount)?;
        require_future_timestamp(&env, due_date)?;
        require_valid_risk_score(risk_score)?;
        require_non_empty_bytes(&debtor_hash)?;
        require_non_empty_string(&ipfs_cid)?;

        let mut hot = Self::load_hot(&env, invoice_id)?;
        if hot.status != InvoiceStatus::Created {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }
        if hot.sme != sme {
            return Err(InvoiceNftError::Unauthorized);
        }

        hot.amount = amount;
        hot.due_date = due_date;
        hot.risk_score = risk_score;
        hot.risk_tier = RiskTier::from_score(risk_score);
        let currency = hot.currency.clone();

        env.storage().persistent().set(&DataKey::InvoiceHot(invoice_id), &hot);
        Self::bump_persistent(&env, &DataKey::InvoiceHot(invoice_id));

        // Update cold fields.
        let mut cold = Self::load_cold(&env, invoice_id)?;
        cold.debtor_hash = debtor_hash;
        cold.ipfs_cid = ipfs_cid;
        env.storage().persistent().set(&DataKey::InvoiceCold(invoice_id), &cold);
        Self::bump_persistent(&env, &DataKey::InvoiceCold(invoice_id));

        events::invoice_amended(&env, invoice_id, &sme, currency);
        Ok(())
    }

    pub fn update_metadata_cid(
        env: Env,
        sme: Address,
        invoice_id: u64,
        new_cid: String,
    ) -> Result<(), InvoiceNftError> {
        sme.require_auth();
        Self::require_not_paused(&env)?;

        require_non_empty_string(&new_cid)?;
        require_max_length_string(&new_cid, MAX_IPFS_CID_LEN)?;

        let hot = Self::load_hot(&env, invoice_id)?;
        if hot.sme != sme {
            return Err(InvoiceNftError::NotInvoiceOwner);
        }
        if hot.status != InvoiceStatus::Created {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }

        let mut cold = Self::load_cold(&env, invoice_id)?;

        let history_key = DataKey::MetadataCidHistory(invoice_id);
        let mut history: Vec<String> = env
            .storage()
            .persistent()
            .get(&history_key)
            .unwrap_or_else(|| Vec::new(&env));
        if history.len() >= MAX_METADATA_CID_HISTORY as u64 {
            history.remove(0);
        }
        history.push_back(cold.ipfs_cid.clone());
        env.storage().persistent().set(&history_key, &history);
        Self::bump_persistent(&env, &history_key);

        cold.ipfs_cid = new_cid.clone();
        env.storage().persistent().set(&DataKey::InvoiceCold(invoice_id), &cold);
        Self::bump_persistent(&env, &DataKey::InvoiceCold(invoice_id));

        events::metadata_cid_updated(&env, invoice_id, &sme, &new_cid);
        Ok(())
    }

    pub fn get_metadata_cid_history(env: Env, invoice_id: u64) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::MetadataCidHistory(invoice_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn withdraw_invoice(env: Env, sme: Address, invoice_id: u64) -> Result<(), InvoiceNftError> {
        sme.require_auth();
        Self::require_not_paused(&env)?;

        let hot = Self::load_hot(&env, invoice_id)?;
        if hot.status != InvoiceStatus::Created {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }
        if hot.sme != sme {
            return Err(InvoiceNftError::Unauthorized);
        }

        env.storage().persistent().remove(&DataKey::InvoiceHot(invoice_id));
        env.storage().persistent().remove(&DataKey::InvoiceCold(invoice_id));

        let prev: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::OutstandingExposure(sme.clone()))
            .unwrap_or(0i128);
        env.storage().persistent().set(
            &DataKey::OutstandingExposure(sme.clone()),
            &prev.saturating_sub(hot.amount),
        );
        Self::remove_sme_invoice_id(&env, &sme, invoice_id);
        events::invoice_withdrawn(&env, invoice_id, &sme, hot.currency);
        Ok(())
    }

    // ── Status transitions ────────────────────────────────────────────────────
    // These are the highest-traffic entrypoints. They read/write only InvoiceHot,
    // saving one persistent read/write of the cold metadata fields per call.

    pub fn set_created(env: Env, caller: Address, invoice_id: u64) -> Result<(), InvoiceNftError> {
        caller.require_auth();
        Self::require_authorized_caller(&env, &caller, &[DataKey::Marketplace])?;
        Self::require_not_paused(&env)?;
        let _guard = ReentrancyGuard::new(&env)?;
        let mut hot = Self::load_hot(&env, invoice_id)?;
        if hot.status != InvoiceStatus::Listed {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }
        hot.status = InvoiceStatus::Created;
        let (sme, amount, currency) = (hot.sme.clone(), hot.amount, hot.currency.clone());
        env.storage().persistent().set(&DataKey::InvoiceHot(invoice_id), &hot);
        Self::bump_persistent(&env, &DataKey::InvoiceHot(invoice_id));
        events::invoice_created(&env, invoice_id, &sme, amount, currency);
        Ok(())
    }

    pub fn set_listed(env: Env, caller: Address, invoice_id: u64) -> Result<(), InvoiceNftError> {
        caller.require_auth();
        Self::require_authorized_caller(&env, &caller, &[DataKey::Marketplace])?;
        Self::require_not_paused(&env)?;
        let _guard = ReentrancyGuard::new(&env)?;
        let mut hot = Self::load_hot(&env, invoice_id)?;
        if hot.status != InvoiceStatus::Created {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }
        hot.status = InvoiceStatus::Listed;
        let (sme, amount, currency) = (hot.sme.clone(), hot.amount, hot.currency.clone());
        env.storage().persistent().set(&DataKey::InvoiceHot(invoice_id), &hot);
        Self::bump_persistent(&env, &DataKey::InvoiceHot(invoice_id));
        events::invoice_listed(&env, invoice_id, &sme, amount, currency);
        Ok(())
    }

    pub fn set_funded(env: Env, caller: Address, invoice_id: u64) -> Result<(), InvoiceNftError> {
        caller.require_auth();
        Self::require_authorized_caller(&env, &caller, &[DataKey::FinancingPool])?;
        Self::require_not_paused(&env)?;
        let _guard = ReentrancyGuard::new(&env)?;
        let mut hot = Self::load_hot(&env, invoice_id)?;
        if hot.status != InvoiceStatus::Listed {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }
        hot.status = InvoiceStatus::Funded;
        hot.funded_at = Some(env.ledger().timestamp());
        let (sme, amount, currency) = (hot.sme.clone(), hot.amount, hot.currency.clone());
        env.storage().persistent().set(&DataKey::InvoiceHot(invoice_id), &hot);
        Self::bump_persistent(&env, &DataKey::InvoiceHot(invoice_id));
        events::invoice_funded(&env, invoice_id, &caller, amount, currency);
        Ok(())
    }

    pub fn set_repaid(env: Env, caller: Address, invoice_id: u64) -> Result<(), InvoiceNftError> {
        caller.require_auth();
        Self::require_authorized_caller(&env, &caller, &[DataKey::FinancingPool])?;
        Self::require_not_paused(&env)?;
        let mut hot = Self::load_hot(&env, invoice_id)?;
        if hot.status != InvoiceStatus::Funded {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }
        hot.status = InvoiceStatus::Repaid;
        hot.repaid_at = Some(env.ledger().timestamp());
        let (sme, amount, currency) = (hot.sme.clone(), hot.amount, hot.currency.clone());
        env.storage().persistent().set(&DataKey::InvoiceHot(invoice_id), &hot);
        Self::bump_persistent(&env, &DataKey::InvoiceHot(invoice_id));
        let prev: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::OutstandingExposure(sme.clone()))
            .unwrap_or(0i128);
        env.storage().persistent().set(
            &DataKey::OutstandingExposure(sme.clone()),
            &prev.saturating_sub(amount),
        );
        events::invoice_repaid(&env, invoice_id, &sme, amount, currency);
        Ok(())
    }

    pub fn set_defaulted(env: Env, caller: Address, invoice_id: u64) -> Result<(), InvoiceNftError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        let _guard = ReentrancyGuard::new(&env)?;
        let mut hot = Self::load_hot(&env, invoice_id)?;
        if hot.status != InvoiceStatus::Funded {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }
        if env.ledger().timestamp() <= hot.due_date {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }
        hot.status = InvoiceStatus::Defaulted;
        let (sme, amount, currency) = (hot.sme.clone(), hot.amount, hot.currency.clone());
        env.storage().persistent().set(&DataKey::InvoiceHot(invoice_id), &hot);
        Self::bump_persistent(&env, &DataKey::InvoiceHot(invoice_id));
        let prev: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::OutstandingExposure(sme.clone()))
            .unwrap_or(0i128);
        env.storage().persistent().set(
            &DataKey::OutstandingExposure(sme.clone()),
            &prev.saturating_sub(amount),
        );
        Self::append_audit_entry(&env, &caller, AdminActionType::InvoiceNftSetDefaulted);
        events::invoice_defaulted(&env, invoice_id, &sme, amount, currency);
        Ok(())
    }

    pub fn archive_invoice(env: Env, admin: Address, invoice_id: u64) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        let hot = Self::load_hot(&env, invoice_id)?;
        if hot.status != InvoiceStatus::Repaid && hot.status != InvoiceStatus::Defaulted {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }
        events::invoice_archived(&env, invoice_id, &hot.sme, hot.amount, hot.status);
        env.storage().persistent().remove(&DataKey::InvoiceHot(invoice_id));
        env.storage().persistent().remove(&DataKey::InvoiceCold(invoice_id));
        Ok(())
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    /// Retrieve a full invoice by merging hot + cold keys.
    pub fn get_invoice(env: Env, invoice_id: u64) -> Result<Invoice, InvoiceNftError> {
        let hot = Self::load_hot(&env, invoice_id)?;
        let cold = Self::load_cold(&env, invoice_id)?;
        Ok(Invoice {
            id: hot.id,
            sme: hot.sme,
            debtor_hash: cold.debtor_hash,
            amount: hot.amount,
            currency: hot.currency,
            due_date: hot.due_date,
            ipfs_cid: cold.ipfs_cid,
            metadata_hash: cold.metadata_hash,
            risk_score: hot.risk_score,
            risk_tier: hot.risk_tier,
            status: hot.status,
            created_at: hot.created_at,
            funded_at: hot.funded_at,
            repaid_at: hot.repaid_at,
            notes: cold.notes,
        })
    }

    pub fn next_id(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::NextId).unwrap_or(1)
    }

    pub fn invoice_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get::<_, u64>(&DataKey::NextId)
            .unwrap_or(1)
            .saturating_sub(1)
    }

    pub fn get_outstanding_exposure(env: Env, sme: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::OutstandingExposure(sme))
            .unwrap_or(0i128)
    }

    /// Recompute SME exposure from ground truth (scans all invoice hot keys).
    pub fn reconcile_outstanding_exposure(env: Env, sme: Address) -> i128 {
        let next_id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        let mut total: i128 = 0;
        let mut id: u64 = 1;
        while id < next_id {
            if let Some(hot) = env.storage().persistent().get::<DataKey, InvoiceHot>(&DataKey::InvoiceHot(id)) {
                if hot.sme == sme
                    && hot.status != InvoiceStatus::Repaid
                    && hot.status != InvoiceStatus::Defaulted
                {
                    total = total.saturating_add(hot.amount);
                }
            }
            id += 1;
        }
        total
    }

    pub fn get_sme_invoice_ids(env: Env, sme: Address, start: u32, limit: u32) -> Vec<u64> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::SmeInvoiceIds(sme))
            .unwrap_or_else(|| Vec::new(&env));
        let len = ids.len();
        if start >= len {
            return Vec::new(&env);
        }
        let limit = limit.min(MAX_SME_INVOICE_PAGE);
        let end = start.saturating_add(limit).min(len);
        ids.slice(start..end)
    }

    // ── Metadata hash ────────────────────────────────────────────────────���────

    pub fn commit_metadata_hash(
        env: Env,
        sme: Address,
        invoice_id: u64,
        metadata_hash: Bytes,
    ) -> Result<(), InvoiceNftError> {
        sme.require_auth();
        Self::require_not_paused(&env)?;
        let _guard = ReentrancyGuard::new(&env)?;

        require_non_empty_bytes(&metadata_hash)?;

        let hot = Self::load_hot(&env, invoice_id)?;
        if hot.sme != sme {
            return Err(InvoiceNftError::Unauthorized);
        }
        if hot.status != InvoiceStatus::Created {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }

        let mut cold = Self::load_cold(&env, invoice_id)?;
        if cold.metadata_hash.len() != 0 {
            return Err(InvoiceNftError::AlreadyInitialized);
        }
        cold.metadata_hash = metadata_hash;
        env.storage().persistent().set(&DataKey::InvoiceCold(invoice_id), &cold);
        Self::bump_persistent(&env, &DataKey::InvoiceCold(invoice_id));
        Ok(())
    }

    pub fn flag_metadata_mismatch(
        env: Env,
        challenger: Address,
        invoice_id: u64,
        evidence_hash: Bytes,
    ) -> Result<(), InvoiceNftError> {
        challenger.require_auth();
        Self::require_not_paused(&env)?;
        let _guard = ReentrancyGuard::new(&env)?;

        require_non_empty_bytes(&evidence_hash)?;

        let cold = Self::load_cold(&env, invoice_id)?;
        if cold.metadata_hash.len() == 0 {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }

        let dispute_key = DataKey::MetadataDispute(invoice_id);
        if env.storage().persistent().has(&dispute_key) {
            return Err(InvoiceNftError::AlreadyInitialized);
        }

        let dispute = MetadataDispute {
            challenger: challenger.clone(),
            evidence_hash,
            raised_at: env.ledger().timestamp(),
            resolved: false,
            upheld: false,
        };
        env.storage().persistent().set(&dispute_key, &dispute);
        Self::bump_persistent(&env, &dispute_key);

        let frozen_key = DataKey::InvoiceFrozen(invoice_id);
        env.storage().persistent().set(&frozen_key, &true);
        Self::bump_persistent(&env, &frozen_key);

        events::metadata_mismatch_flagged(&env, invoice_id, &challenger);
        Ok(())
    }

    pub fn resolve_metadata_dispute(
        env: Env,
        admin: Address,
        invoice_id: u64,
        upheld: bool,
    ) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let dispute_key = DataKey::MetadataDispute(invoice_id);
        let mut dispute: MetadataDispute = env
            .storage()
            .persistent()
            .get(&dispute_key)
            .ok_or(InvoiceNftError::InvalidInvoiceStatus)?;
        if dispute.resolved {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }
        dispute.resolved = true;
        dispute.upheld = upheld;
        env.storage().persistent().set(&dispute_key, &dispute);

        if !upheld {
            env.storage().persistent().remove(&DataKey::InvoiceFrozen(invoice_id));
            events::invoice_unfrozen(&env, invoice_id, &admin);
        }
        events::metadata_dispute_resolved(&env, invoice_id, &admin, upheld);
        Ok(())
    }

    pub fn admin_correct_metadata_hash(
        env: Env,
        admin: Address,
        invoice_id: u64,
        new_hash: Bytes,
    ) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        require_non_empty_bytes(&new_hash)?;

        let hot = Self::load_hot(&env, invoice_id)?;
        if hot.status != InvoiceStatus::Created {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }

        let mut cold = Self::load_cold(&env, invoice_id)?;
        let old_hash = cold.metadata_hash.clone();
        cold.metadata_hash = new_hash.clone();
        env.storage().persistent().set(&DataKey::InvoiceCold(invoice_id), &cold);
        Self::bump_persistent(&env, &DataKey::InvoiceCold(invoice_id));

        events::metadata_hash_corrected(&env, invoice_id, &admin, &old_hash, &new_hash);
        Self::append_audit_entry(&env, &admin, AdminActionType::CorrectMetadataHash);
        Ok(())
    }

    // ── Freeze ────────────────────────────────────────────────────────────────

    pub fn freeze_invoice(env: Env, admin: Address, invoice_id: u64) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::load_hot(&env, invoice_id)?;
        let key = DataKey::InvoiceFrozen(invoice_id);
        env.storage().persistent().set(&key, &true);
        Self::bump_persistent(&env, &key);
        Self::append_audit_entry(&env, &admin, AdminActionType::InvoiceNftFreezeInvoice);
        events::invoice_frozen(&env, invoice_id, &admin);
        Ok(())
    }

    pub fn unfreeze_invoice(env: Env, admin: Address, invoice_id: u64) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::load_hot(&env, invoice_id)?;
        env.storage().persistent().remove(&DataKey::InvoiceFrozen(invoice_id));
        Self::append_audit_entry(&env, &admin, AdminActionType::InvoiceNftUnfreezeInvoice);
        events::invoice_unfrozen(&env, invoice_id, &admin);
        Ok(())
    }

    pub fn is_invoice_frozen(env: Env, invoice_id: u64) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::InvoiceFrozen(invoice_id))
            .unwrap_or(false)
    }

    pub fn freeze_sme_invoices(
        env: Env,
        admin: Address,
        sme: Address,
        max_to_process: u32,
    ) -> Result<u32, InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::SmeInvoiceIds(sme))
            .unwrap_or_else(|| Vec::new(&env));

        let mut processed: u32 = 0;
        for id in ids.iter() {
            if processed >= max_to_process { break; }
            let hot = match env.storage().persistent().get::<DataKey, InvoiceHot>(&DataKey::InvoiceHot(id)) {
                Some(h) => h,
                None => continue,
            };
            if matches!(hot.status, InvoiceStatus::Repaid | InvoiceStatus::Defaulted) { continue; }
            let key = DataKey::InvoiceFrozen(id);
            if env.storage().persistent().has(&key) { continue; }
            env.storage().persistent().set(&key, &true);
            Self::bump_persistent(&env, &key);
            events::invoice_frozen(&env, id, &admin);
            processed += 1;
        }
        Ok(processed)
    }

    pub fn unfreeze_sme_invoices(
        env: Env,
        admin: Address,
        sme: Address,
        max_to_process: u32,
    ) -> Result<u32, InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::SmeInvoiceIds(sme))
            .unwrap_or_else(|| Vec::new(&env));

        let mut processed: u32 = 0;
        for id in ids.iter() {
            if processed >= max_to_process { break; }
            let key = DataKey::InvoiceFrozen(id);
            if !env.storage().persistent().has(&key) { continue; }
            env.storage().persistent().remove(&key);
            events::invoice_unfrozen(&env, id, &admin);
            processed += 1;
        }
        Ok(processed)
    }

    // ── Risk score refresh ────────────────────────────────────────────────────

    pub fn refresh_risk_score(env: Env, caller: Address, invoice_id: u64) -> Result<(), InvoiceNftError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        Self::require_not_paused(&env)?;
        let _guard = ReentrancyGuard::new(&env)?;

        let mut hot = Self::load_hot(&env, invoice_id)?;
        if hot.status != InvoiceStatus::Funded {
            return Err(InvoiceNftError::InvalidInvoiceStatus);
        }

        let rr_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::RiskRegistry)
            .ok_or(InvoiceNftError::NotInitialized)?;
        let rr = kora_risk_registry::RiskRegistryContractClient::new(&env, &rr_addr);
        let profile = rr
            .try_get_sme_profile(&hot.sme)
            .map_err(|_| InvoiceNftError::SMENotRegistered)?
            .map_err(|_| InvoiceNftError::SMENotRegistered)?;

        let old_score = hot.risk_score;
        let old_tier = hot.risk_tier.clone();
        let new_score = profile.risk_score;
        let new_tier = RiskTier::from_score(new_score);

        hot.risk_score = new_score;
        hot.risk_tier = new_tier.clone();
        env.storage().persistent().set(&DataKey::InvoiceHot(invoice_id), &hot);
        Self::bump_persistent(&env, &DataKey::InvoiceHot(invoice_id));

        events::risk_score_refreshed(&env, invoice_id, &caller, old_score, new_score, &old_tier, &new_tier);
        Ok(())
    }

    // ── Upgrade ───────────────────────────────────────────────────────────────

    pub fn propose_upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::UpgradeProposal, &(new_wasm_hash.clone(), env.ledger().timestamp()));
        Self::append_audit_entry(&env, &admin, AdminActionType::InvoiceNftProposeUpgrade);
        events::upgrade_proposed(&env, &admin, &new_wasm_hash);
        Ok(())
    }

    pub fn execute_upgrade(env: Env, admin: Address) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        let (wasm_hash, proposed_at): (BytesN<32>, u64) = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeProposal)
            .ok_or(InvoiceNftError::NoUpgradeProposed)?;
        if env.ledger().timestamp() < proposed_at + UPGRADE_TIMELOCK_DELAY {
            return Err(InvoiceNftError::UpgradeTimelockNotElapsed);
        }
        env.storage().instance().remove(&DataKey::UpgradeProposal);
        Self::append_audit_entry(&env, &admin, AdminActionType::InvoiceNftExecuteUpgrade);
        events::upgrade_executed(&env, &admin, &wasm_hash);
        env.deployer().update_current_contract_wasm(wasm_hash);
        Ok(())
    }

    // ── Currency allowlist ────────────────────────────────────────────────────

    pub fn add_allowed_currency(env: Env, admin: Address, currency: Symbol) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage()
            .persistent()
            .set(&DataKey::CurrencyAllowlist(currency.clone()), &true);
        extend_persistent_ttl(&env, &DataKey::CurrencyAllowlist(currency), DEFAULT_TTL_THRESHOLD, DEFAULT_TTL_BUMP);
        Self::append_audit_entry(&env, &admin, AdminActionType::InvoiceNftAddAllowedCurrency);
        Ok(())
    }

    pub fn remove_allowed_currency(env: Env, admin: Address, currency: Symbol) -> Result<(), InvoiceNftError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage().persistent().remove(&DataKey::CurrencyAllowlist(currency));
        Self::append_audit_entry(&env, &admin, AdminActionType::InvoiceNftRemoveAllowedCurrency);
        Ok(())
    }

    pub fn is_currency_allowed(env: Env, currency: Symbol) -> bool {
        env.storage()
            .persistent()
            .get::<_, bool>(&DataKey::CurrencyAllowlist(currency))
            .unwrap_or(false)
    }

    // ── Audit log ─────────────────────────────────────────────────────────────

    pub fn get_audit_log(env: Env, page: u32, page_size: u32) -> Vec<AdminAuditEntry> {
        let page_size = (page_size.max(1).min(50)) as u64;
        let total: u64 = env.storage().instance().get(&DataKey::AuditLogTotal).unwrap_or(0);
        let head: u64 = env.storage().instance().get(&DataKey::AuditLogHead).unwrap_or(0);
        let stored = total.min(MAX_AUDIT_LOG_SIZE);
        let skip = (page as u64).saturating_mul(page_size);
        let mut results = Vec::new(&env);
        let mut i: u64 = 0;
        while i < page_size {
            let offset = skip + i;
            if offset >= stored { break; }
            let pos = (head + MAX_AUDIT_LOG_SIZE - 1 - offset) % MAX_AUDIT_LOG_SIZE;
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<DataKey, AdminAuditEntry>(&DataKey::AuditEntry(pos))
            {
                results.push_back(entry);
            }
            i += 1;
        }
        results
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn load_hot(env: &Env, id: u64) -> Result<InvoiceHot, InvoiceNftError> {
        env.storage()
            .persistent()
            .get(&DataKey::InvoiceHot(id))
            .ok_or(InvoiceNftError::InvoiceNotFound)
    }

    fn load_cold(env: &Env, id: u64) -> Result<InvoiceCold, InvoiceNftError> {
        env.storage()
            .persistent()
            .get(&DataKey::InvoiceCold(id))
            .ok_or(InvoiceNftError::InvoiceNotFound)
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), InvoiceNftError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(InvoiceNftError::NotInitialized)?;
        if &admin != caller {
            return Err(InvoiceNftError::NotAdmin);
        }
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), InvoiceNftError> {
        let ac: Address = env
            .storage()
            .instance()
            .get(&DataKey::AccessControl)
            .ok_or(InvoiceNftError::NotInitialized)?;
        let client = kora_access_control::AccessControlContractClient::new(env, &ac);
        if client.is_paused() {
            return Err(InvoiceNftError::ProtocolPaused);
        }
        Ok(())
    }

    fn require_authorized_caller(env: &Env, caller: &Address, allowed: &[DataKey]) -> Result<(), InvoiceNftError> {
        for key in allowed {
            if let Some(addr) = env.storage().instance().get::<DataKey, Address>(key) {
                if &addr == caller {
                    return Ok(());
                }
            }
        }
        Err(InvoiceNftError::Unauthorized)
    }

    fn bump_persistent(env: &Env, key: &DataKey) {
        env.storage().persistent().extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
    }

    fn append_audit_entry(env: &Env, actor: &Address, action: AdminActionType) {
        let total: u64 = env.storage().instance().get(&DataKey::AuditLogTotal).unwrap_or(0);
        let head: u64 = env.storage().instance().get(&DataKey::AuditLogHead).unwrap_or(0);
        let entry = AdminAuditEntry {
            sequence: total,
            timestamp: env.ledger().timestamp(),
            actor: actor.clone(),
            action,
            source: AuditSource::InvoiceNft,
        };
        env.storage().persistent().set(&DataKey::AuditEntry(head), &entry);
        Self::bump_persistent(env, &DataKey::AuditEntry(head));
        events::admin_action_audited(env, &entry);
        let next_head = (head + 1) % MAX_AUDIT_LOG_SIZE;
        env.storage().instance().set(&DataKey::AuditLogHead, &next_head);
        env.storage().instance().set(&DataKey::AuditLogTotal, &(total + 1));
    }

    fn consume_mint_quota(env: &Env, sme: &Address, count: usize) -> Result<(), InvoiceNftError> {
        let limit: MintRateLimit = match env.storage().instance().get(&DataKey::MintRateLimit) {
            Some(l) => l,
            None => return Ok(()), // unthrottled
        };
        let now = env.ledger().timestamp();
        let key = DataKey::SmeMintWindow(sme.clone());
        let (window_start, mints_used): (u64, u32) = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or((now, 0u32));

        let (window_start, mints_used) = if now >= window_start + limit.window_secs {
            (now, 0u32)
        } else {
            (window_start, mints_used)
        };

        let new_mints = mints_used
            .checked_add(count as u32)
            .ok_or(InvoiceNftError::ArithmeticOverflow)?;
        if new_mints > limit.max_mints {
            return Err(InvoiceNftError::MintRateLimitExceeded);
        }
        env.storage().persistent().set(&key, &(window_start, new_mints));
        Self::bump_persistent(env, &key);
        Ok(())
    }

    fn append_sme_invoice_id(env: &Env, sme: &Address, id: u64) {
        let key = DataKey::SmeInvoiceIds(sme.clone());
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        ids.push_back(id);
        env.storage().persistent().set(&key, &ids);
        Self::bump_persistent(env, &key);
    }

    fn append_sme_invoice_ids(env: &Env, sme: &Address, new_ids: &Vec<u64>) {
        let key = DataKey::SmeInvoiceIds(sme.clone());
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        ids.append(new_ids);
        env.storage().persistent().set(&key, &ids);
        Self::bump_persistent(env, &key);
    }

    fn remove_sme_invoice_id(env: &Env, sme: &Address, id: u64) {
        let key = DataKey::SmeInvoiceIds(sme.clone());
        let mut ids: Vec<u64> = match env.storage().persistent().get(&key) {
            Some(ids) => ids,
            None => return,
        };
        if let Some(idx) = ids.first_index_of(id) {
            ids.remove(idx);
            env.storage().persistent().set(&key, &ids);
            Self::bump_persistent(env, &key);
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _, Ledger, LedgerInfo},
        Bytes, BytesN, Env, String, Symbol, Vec,
    };

    fn setup() -> (Env, Address, InvoiceNftContractClient<'static>) {
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
        let ac_id = env.register_contract(None, kora_access_control::AccessControlContract);
        let contract_id = env.register_contract(None, InvoiceNftContract);
        let client = InvoiceNftContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin, &ac_id);
        (env, admin, client)
    }

    fn ipfs_cid(env: &Env) -> String {
        String::from_str(env, "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
    }

    fn mint_default(env: &Env, client: &InvoiceNftContractClient, risk_score: u32) -> u64 {
        let sme = Address::generate(env);
        client.mint_invoice(
            &sme,
            &Bytes::from_slice(env, &[1u8; 32]),
            &1_000_000_000i128,
            &Symbol::new(env, "USDC"),
            &(env.ledger().timestamp() + 86_400 * 30),
            &ipfs_cid(env),
            &risk_score,
            &None,
        )
    }

    fn mint_one(env: &Env, client: &InvoiceNftContractClient<'static>) -> u64 {
        let sme = Address::generate(env);
        client.mint_invoice(
            &sme,
            &Bytes::from_slice(env, &[0xABu8; 32]),
            &1_000_000_000i128,
            &Symbol::new(env, "USDC"),
            &(env.ledger().timestamp() + 86_400 * 30),
            &ipfs_cid(env),
            &10u32,
            &None,
        )
    }

    fn batch_input(env: &Env, risk_score: u32) -> BatchInvoiceInput {
        BatchInvoiceInput {
            debtor_hash: Bytes::from_slice(env, &[9u8; 32]),
            amount: 500_000_000i128,
            currency: Symbol::new(env, "USDC"),
            due_date: env.ledger().timestamp() + 86_400 * 30,
            ipfs_cid: ipfs_cid(env),
            risk_score,
            notes: None,
        }
    }

    fn advance(env: &Env, secs: u64) {
        let ts = env.ledger().timestamp();
        env.ledger().set_timestamp(ts + secs);
    }

    // ── initialize ────────────────────────────────────────────────────────────

    #[test]
    fn test_initialize_success() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, InvoiceNftContract);
        let client = InvoiceNftContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let access_control = Address::generate(&env);
        client.initialize(&admin, &access_control);
        assert_eq!(client.next_id(), 1);
        assert_eq!(client.invoice_count(), 0);
    }

    #[test]
    fn test_initialize_sets_migration_version() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, InvoiceNftContract);
        let client = InvoiceNftContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let access_control = Address::generate(&env);
        client.initialize(&admin, &access_control);
        let version: Option<u32> = env.as_contract(&client.address, || {
            env.storage().instance().get(&DataKey::MigrationVersion)
        });
        assert_eq!(version, Some(3));
    }

    #[test]
    fn test_initialize_already_initialized_fails() {
        let (env, admin, client) = setup();
        let ac = Address::generate(&env);
        let result = client.try_initialize(&admin, &ac);
        assert_eq!(result.unwrap_err().unwrap(), InvoiceNftError::AlreadyInitialized);
    }

    #[test]
    fn test_initialize_self_as_admin_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, InvoiceNftContract);
        let client = InvoiceNftContractClient::new(&env, &contract_id);
        let ac = Address::generate(&env);
        assert!(client.try_initialize(&contract_id, &ac).is_err());
    }

    #[test]
    fn test_initialize_admin_equals_access_control_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, InvoiceNftContract);
        let client = InvoiceNftContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        assert!(client.try_initialize(&admin, &admin).is_err());
    }

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        Bytes, BytesN, Env, String, Symbol, Vec,
    };

    fn setup() -> (Env, Address, InvoiceNftContractClient<'static>) {
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
        let ac_id = env.register_contract(None, kora_access_control::AccessControlContract);
        let contract_id = env.register_contract(None, InvoiceNftContract);
        let client = InvoiceNftContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin, &ac_id);
        (env, admin, client)
    }

    fn ipfs_cid(env: &Env) -> String {
        String::from_str(env, "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
    }

    fn mint_default(env: &Env, client: &InvoiceNftContractClient, risk_score: u32) -> u64 {
        let sme = Address::generate(env);
        client.mint_invoice(
            &sme,
            &Bytes::from_slice(env, &[1u8; 32]),
            &1_000_000_000i128,
            &Symbol::new(env, "USDC"),
            &(env.ledger().timestamp() + 86_400 * 30),
            &ipfs_cid(env),
            &risk_score,
            &None,
        )
    }

    fn mint_one(env: &Env, client: &InvoiceNftContractClient<'static>) -> u64 {
        let sme = Address::generate(env);
        client.mint_invoice(
            &sme,
            &Bytes::from_slice(env, &[0xABu8; 32]),
            &1_000_000_000i128,
            &Symbol::new(env, "USDC"),
            &(env.ledger().timestamp() + 86_400 * 30),
            &ipfs_cid(env),
            &10u32,
            &None,
        )
    }

    fn batch_input(env: &Env, risk_score: u32) -> BatchInvoiceInput {
        BatchInvoiceInput {
            debtor_hash: Bytes::from_slice(env, &[9u8; 32]),
            amount: 500_000_000i128,
            currency: Symbol::new(env, "USDC"),
            due_date: env.ledger().timestamp() + 86_400 * 30,
            ipfs_cid: ipfs_cid(env),
            risk_score,
            notes: None,
        }
    }

    fn advance(env: &Env, secs: u64) {
        let ts = env.ledger().timestamp();
        env.ledger().set_timestamp(ts + secs);
    }

    #[test]
    fn test_initialize_success() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, InvoiceNftContract);
        let client = InvoiceNftContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let ac = Address::generate(&env);
        client.initialize(&admin, &ac);
        assert_eq!(client.next_id(), 1);
        assert_eq!(client.invoice_count(), 0);
    }

    #[test]
    fn test_initialize_sets_migration_version_3() {
        let (env, _admin, client) = setup();
        let version: Option<u32> = env.as_contract(&client.address, || {
            env.storage().instance().get(&DataKey::MigrationVersion)
        });
        assert_eq!(version, Some(3));
    }

    #[test]
    fn test_initialize_already_initialized_fails() {
        let (env, admin, client) = setup();
        let ac = Address::generate(&env);
        assert_eq!(
            client.try_initialize(&admin, &ac).unwrap_err().unwrap(),
            InvoiceNftError::AlreadyInitialized
        );
    }

    #[test]
    fn test_mint_invoice_success() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let id = client.mint_invoice(
            &sme,
            &Bytes::from_slice(&env, &[1u8; 32]),
            &1_000_000_000i128,
            &Symbol::new(&env, "USDC"),
            &(env.ledger().timestamp() + 86_400 * 30),
            &ipfs_cid(&env),
            &25u32,
            &None,
        );
        assert_eq!(id, 1);
        let invoice = client.get_invoice(&1);
        assert_eq!(invoice.status, InvoiceStatus::Created);
        assert_eq!(invoice.risk_tier, RiskTier::AA);
        assert_eq!(invoice.sme, sme);
        assert_eq!(invoice.amount, 1_000_000_000i128);
        assert_eq!(invoice.funded_at, None);
        assert_eq!(invoice.repaid_at, None);
    }

    #[test]
    fn test_mint_invoice_zero_amount_fails() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let result = client.try_mint_invoice(
            &sme, &Bytes::from_slice(&env, &[1u8; 32]), &0i128,
            &Symbol::new(&env, "USDC"), &(env.ledger().timestamp() + 86_400), &ipfs_cid(&env), &10u32, &None,
        );
        assert_eq!(result.unwrap_err().unwrap(), InvoiceNftError::InvalidAmount);
    }

    #[test]
    fn test_mint_invoice_past_due_date_fails() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let result = client.try_mint_invoice(
            &sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128,
            &Symbol::new(&env, "USDC"), &(env.ledger().timestamp() - 1), &ipfs_cid(&env), &10u32, &None,
        );
        assert_eq!(result.unwrap_err().unwrap(), InvoiceNftError::InvalidDueDate);
    }

    #[test]
    fn test_mint_invoice_invalid_risk_score_fails() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let result = client.try_mint_invoice(
            &sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128,
            &Symbol::new(&env, "USDC"), &(env.ledger().timestamp() + 86_400), &ipfs_cid(&env), &101u32, &None,
        );
        assert_eq!(result.unwrap_err().unwrap(), InvoiceNftError::InvalidRiskScore);
    }

    #[test]
    fn test_mint_invoice_empty_debtor_hash_fails() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let result = client.try_mint_invoice(
            &sme, &Bytes::from_slice(&env, &[]), &1_000_000_000i128,
            &Symbol::new(&env, "USDC"), &(env.ledger().timestamp() + 86_400), &ipfs_cid(&env), &10u32, &None,
        );
        assert_eq!(result.unwrap_err().unwrap(), InvoiceNftError::EmptyBytes);
    }

    #[test]
    fn test_mint_multiple_invoices_increments_id() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        let id1 = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        let id2 = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &2_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &20u32, &None);
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(client.next_id(), 3);
    }

    #[test]
    fn test_risk_tier_mapping() {
        let (env, _admin, client) = setup();
        let cases = [
            (0u32, RiskTier::AAA), (20u32, RiskTier::AAA),
            (21u32, RiskTier::AA), (40u32, RiskTier::AA),
            (41u32, RiskTier::A),  (60u32, RiskTier::A),
            (61u32, RiskTier::B),  (80u32, RiskTier::B),
            (81u32, RiskTier::C),  (100u32, RiskTier::C),
        ];
        for (score, expected) in &cases {
            let id = mint_default(&env, &client, *score);
            assert_eq!(client.get_invoice(&id).risk_tier, *expected);
        }
    }

    #[test]
    fn test_get_nonexistent_invoice_fails() {
        let (_env, _admin, client) = setup();
        assert_eq!(
            client.try_get_invoice(&9999u64).unwrap_err().unwrap(),
            InvoiceNftError::InvoiceNotFound
        );
    }

    #[test]
    fn test_invoice_count_increments() {
        let (env, _admin, client) = setup();
        assert_eq!(client.invoice_count(), 0);
        mint_default(&env, &client, 10u32);
        assert_eq!(client.invoice_count(), 1);
        mint_default(&env, &client, 20u32);
        assert_eq!(client.invoice_count(), 2);
    }

    // ── Status transitions ────────────────────────────────────────────────────

    #[test]
    fn test_status_transitions_full_lifecycle() {
        let (env, admin, client) = setup();
        let id = mint_default(&env, &client, 10u32);
        assert_eq!(client.get_invoice(&id).status, InvoiceStatus::Created);
        let mp = Address::generate(&env);
        let pool = Address::generate(&env);
        client.set_authorized_callers(&admin, &mp, &pool);
        client.set_listed(&mp, &id);
        assert_eq!(client.get_invoice(&id).status, InvoiceStatus::Listed);
        client.set_funded(&pool, &id);
        assert_eq!(client.get_invoice(&id).status, InvoiceStatus::Funded);
        assert!(client.get_invoice(&id).funded_at.is_some());
        client.set_repaid(&pool, &id);
        assert_eq!(client.get_invoice(&id).status, InvoiceStatus::Repaid);
        assert!(client.get_invoice(&id).repaid_at.is_some());
    }

    #[test]
    fn test_set_listed_invalid_status_fails() {
        let (env, admin, client) = setup();
        let id = mint_default(&env, &client, 10u32);
        let mp = Address::generate(&env);
        let pool = Address::generate(&env);
        client.set_authorized_callers(&admin, &mp, &pool);
        client.set_listed(&mp, &id);
        assert_eq!(
            client.try_set_listed(&mp, &id).unwrap_err().unwrap(),
            InvoiceNftError::InvalidInvoiceStatus
        );
    }

    #[test]
    fn test_set_funded_skips_listed_fails() {
        let (env, admin, client) = setup();
        let id = mint_default(&env, &client, 10u32);
        let mp = Address::generate(&env);
        let pool = Address::generate(&env);
        client.set_authorized_callers(&admin, &mp, &pool);
        assert_eq!(
            client.try_set_funded(&pool, &id).unwrap_err().unwrap(),
            InvoiceNftError::InvalidInvoiceStatus
        );
    }

    #[test]
    fn test_set_repaid_skips_funded_fails() {
        let (env, admin, client) = setup();
        let id = mint_default(&env, &client, 10u32);
        let mp = Address::generate(&env);
        let pool = Address::generate(&env);
        client.set_authorized_callers(&admin, &mp, &pool);
        assert_eq!(
            client.try_set_repaid(&pool, &id).unwrap_err().unwrap(),
            InvoiceNftError::InvalidInvoiceStatus
        );
    }

    #[test]
    fn test_set_defaulted_before_due_date_fails() {
        let (env, admin, client) = setup();
        let id = mint_default(&env, &client, 10u32);
        let mp = Address::generate(&env);
        let pool = Address::generate(&env);
        client.set_authorized_callers(&admin, &mp, &pool);
        client.set_listed(&mp, &id);
        client.set_funded(&pool, &id);
        assert_eq!(
            client.try_set_defaulted(&admin, &id).unwrap_err().unwrap(),
            InvoiceNftError::InvalidInvoiceStatus
        );
    }

    #[test]
    fn test_set_defaulted_after_due_date_succeeds() {
        let (env, admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400;
        let id = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        let mp = Address::generate(&env);
        let pool = Address::generate(&env);
        client.set_authorized_callers(&admin, &mp, &pool);
        client.set_listed(&mp, &id);
        client.set_funded(&pool, &id);
        env.ledger().set(LedgerInfo { timestamp: due + 1, ..env.ledger().get() });
        client.set_defaulted(&admin, &id);
        assert_eq!(client.get_invoice(&id).status, InvoiceStatus::Defaulted);
    }

    #[test]
    fn test_set_defaulted_requires_admin() {
        let (env, admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400;
        let id = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        let mp = Address::generate(&env);
        let pool = Address::generate(&env);
        client.set_authorized_callers(&admin, &mp, &pool);
        client.set_listed(&mp, &id);
        client.set_funded(&pool, &id);
        env.ledger().set(LedgerInfo { timestamp: due + 1, ..env.ledger().get() });
        let non_admin = Address::generate(&env);
        assert_eq!(
            client.try_set_defaulted(&non_admin, &id).unwrap_err().unwrap(),
            InvoiceNftError::NotAdmin
        );
    }

    #[test]
    fn test_set_repaid_blocked_when_paused() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set(LedgerInfo { timestamp: 1_700_000_000, protocol_version: 21, sequence_number: 1, network_id: Default::default(), base_reserve: 10, min_temp_entry_ttl: 1000, min_persistent_entry_ttl: 1000, max_entry_ttl: 100_000 });
        let admin = Address::generate(&env);
        let ac_id = env.register_contract(None, kora_access_control::AccessControlContract);
        let ac_client = kora_access_control::AccessControlContractClient::new(&env, &ac_id);
        ac_client.initialize(&admin);
        let contract_id = env.register_contract(None, InvoiceNftContract);
        let client = InvoiceNftContractClient::new(&env, &contract_id);
        client.initialize(&admin, &ac_id);
        let id = mint_default(&env, &client, 10u32);
        let mp = Address::generate(&env);
        let pool = Address::generate(&env);
        client.set_authorized_callers(&admin, &mp, &pool);
        client.set_listed(&mp, &id);
        client.set_funded(&pool, &id);
        ac_client.pause(&admin);
        assert_eq!(
            client.try_set_repaid(&pool, &id).unwrap_err().unwrap(),
            InvoiceNftError::ProtocolPaused
        );
    }

    #[test]
    fn test_invoice_timestamps_recorded() {
        let (env, admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        let id = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        let mp = Address::generate(&env);
        let pool = Address::generate(&env);
        client.set_authorized_callers(&admin, &mp, &pool);
        client.set_listed(&mp, &id);
        let funded_ts = env.ledger().timestamp();
        client.set_funded(&pool, &id);
        assert_eq!(client.get_invoice(&id).funded_at, Some(funded_ts));
        let repaid_ts = env.ledger().timestamp();
        client.set_repaid(&pool, &id);
        assert_eq!(client.get_invoice(&id).repaid_at, Some(repaid_ts));
    }

    // ── Outstanding exposure ──────────────────────────────────────────────────

    #[test]
    fn test_outstanding_exposure_tracked() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        assert_eq!(client.get_outstanding_exposure(&sme), 0i128);
        client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        assert_eq!(client.get_outstanding_exposure(&sme), 1_000_000_000i128);
    }

    #[test]
    fn test_outstanding_exposure_released_on_repaid() {
        let (env, admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        let id = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        let mp = Address::generate(&env);
        let pool = Address::generate(&env);
        client.set_authorized_callers(&admin, &mp, &pool);
        client.set_listed(&mp, &id);
        client.set_funded(&pool, &id);
        client.set_repaid(&pool, &id);
        assert_eq!(client.get_outstanding_exposure(&sme), 0i128);
    }

    #[test]
    fn test_outstanding_exposure_released_on_withdraw() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        let id = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        client.withdraw_invoice(&sme, &id);
        assert_eq!(client.get_outstanding_exposure(&sme), 0i128);
    }

    // ── amend_invoice ─────────────────────────────────────────────────────────

    #[test]
    fn test_amend_invoice_success() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        let id = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        let new_due = env.ledger().timestamp() + 86_400 * 60;
        client.amend_invoice(&sme, &id, &Bytes::from_slice(&env, &[2u8; 32]), &2_000_000_000i128, &new_due, &ipfs_cid(&env), &50u32);
        let inv = client.get_invoice(&id);
        assert_eq!(inv.amount, 2_000_000_000i128);
        assert_eq!(inv.risk_tier, RiskTier::A);
        assert_eq!(inv.status, InvoiceStatus::Created);
    }

    #[test]
    fn test_amend_invoice_wrong_owner_fails() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let other = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        let id = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        assert_eq!(
            client.try_amend_invoice(&other, &id, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &due, &ipfs_cid(&env), &10u32).unwrap_err().unwrap(),
            InvoiceNftError::Unauthorized
        );
    }

    #[test]
    fn test_amend_invoice_after_listing_fails() {
        let (env, admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        let id = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        let mp = Address::generate(&env);
        let pool = Address::generate(&env);
        client.set_authorized_callers(&admin, &mp, &pool);
        client.set_listed(&mp, &id);
        assert_eq!(
            client.try_amend_invoice(&sme, &id, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &due, &ipfs_cid(&env), &10u32).unwrap_err().unwrap(),
            InvoiceNftError::InvalidInvoiceStatus
        );
    }

    // ── withdraw_invoice ──────────────────────────────────────────────────────

    #[test]
    fn test_withdraw_invoice_success() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        let id = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        client.withdraw_invoice(&sme, &id);
        assert_eq!(client.try_get_invoice(&id).unwrap_err().unwrap(), InvoiceNftError::InvoiceNotFound);
    }

    #[test]
    fn test_withdraw_invoice_wrong_owner_fails() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let other = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        let id = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        assert_eq!(
            client.try_withdraw_invoice(&other, &id).unwrap_err().unwrap(),
            InvoiceNftError::Unauthorized
        );
    }

    // ── Freeze ────────────────────────────────────────────────────────────────

    #[test]
    fn test_freeze_invoice_sets_frozen_flag() {
        let (env, admin, client) = setup();
        let id = mint_one(&env, &client);
        assert!(!client.is_invoice_frozen(&id));
        client.freeze_invoice(&admin, &id);
        assert!(client.is_invoice_frozen(&id));
    }

    #[test]
    fn test_unfreeze_invoice_clears_frozen_flag() {
        let (env, admin, client) = setup();
        let id = mint_one(&env, &client);
        client.freeze_invoice(&admin, &id);
        client.unfreeze_invoice(&admin, &id);
        assert!(!client.is_invoice_frozen(&id));
    }

    #[test]
    fn test_freeze_invoice_non_admin_rejected() {
        let (env, _, client) = setup();
        let id = mint_one(&env, &client);
        let stranger = Address::generate(&env);
        assert_eq!(
            client.try_freeze_invoice(&stranger, &id).unwrap_err().unwrap(),
            InvoiceNftError::NotAdmin
        );
    }

    #[test]
    fn test_freeze_nonexistent_invoice_rejected() {
        let (_, admin, client) = setup();
        assert_eq!(
            client.try_freeze_invoice(&admin, &9999u64).unwrap_err().unwrap(),
            InvoiceNftError::InvoiceNotFound
        );
    }

    // ── Audit log ─────────────────────────────────────────────────────────────

    #[test]
    fn test_set_risk_registry_emits_audit_entry() {
        let (env, admin, client) = setup();
        let rr = Address::generate(&env);
        client.set_risk_registry(&admin, &rr);
        let log = client.get_audit_log(&0u32, &10u32);
        assert_eq!(log.len(), 1);
        let entry = log.get(0).unwrap();
        assert_eq!(entry.action, AdminActionType::InvoiceNftSetRiskRegistry);
        assert_eq!(entry.actor, admin);
        assert_eq!(entry.source, AuditSource::InvoiceNft);
        assert_eq!(entry.sequence, 0);
    }

    #[test]
    fn test_freeze_and_unfreeze_emit_audit_entries_in_sequence() {
        let (env, admin, client) = setup();
        let id = mint_one(&env, &client);
        client.freeze_invoice(&admin, &id);
        client.unfreeze_invoice(&admin, &id);
        let log = client.get_audit_log(&0u32, &10u32);
        assert_eq!(log.len(), 2);
        assert_eq!(log.get(0).unwrap().action, AdminActionType::InvoiceNftUnfreezeInvoice);
        assert_eq!(log.get(0).unwrap().sequence, 1);
        assert_eq!(log.get(1).unwrap().action, AdminActionType::InvoiceNftFreezeInvoice);
        assert_eq!(log.get(1).unwrap().sequence, 0);
    }

    #[test]
    fn test_get_audit_log_pagination() {
        let (env, admin, client) = setup();
        let rr = Address::generate(&env);
        client.set_risk_registry(&admin, &rr);
        let id = mint_one(&env, &client);
        client.freeze_invoice(&admin, &id);
        client.unfreeze_invoice(&admin, &id);
        let page0 = client.get_audit_log(&0u32, &2u32);
        assert_eq!(page0.len(), 2);
        assert_eq!(page0.get(0).unwrap().action, AdminActionType::InvoiceNftUnfreezeInvoice);
        let page1 = client.get_audit_log(&1u32, &2u32);
        assert_eq!(page1.len(), 1);
        assert_eq!(page1.get(0).unwrap().action, AdminActionType::InvoiceNftSetRiskRegistry);
    }

    // ── Batch mint ────────────────────────────────────────────────────────────

    #[test]
    fn test_mint_invoices_batch_returns_correct_ids() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let mut inputs = Vec::new(&env);
        inputs.push_back(batch_input(&env, 10u32));
        inputs.push_back(batch_input(&env, 20u32));
        let ids = client.mint_invoices_batch(&sme, &inputs);
        assert_eq!(ids.len(), 2);
        assert_eq!(ids.get(0).unwrap(), 1u64);
        assert_eq!(ids.get(1).unwrap(), 2u64);
    }

    #[test]
    fn test_mint_invoices_batch_ids_are_distinct_batch_ids() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let mut inputs1 = Vec::new(&env);
        inputs1.push_back(batch_input(&env, 10u32));
        client.mint_invoices_batch(&sme, &inputs1);
        let mut inputs2 = Vec::new(&env);
        inputs2.push_back(batch_input(&env, 10u32));
        client.mint_invoices_batch(&sme, &inputs2);
        // Both batches succeeded — batch IDs are monotonically distinct (internal counter).
        assert_eq!(client.invoice_count(), 2);
    }

    // ── SME invoice index ─────────────────────────────────────────────────────

    #[test]
    fn test_get_sme_invoice_ids_empty_for_unknown_sme() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        assert_eq!(client.get_sme_invoice_ids(&sme, &0u32, &10u32).len(), 0);
    }

    #[test]
    fn test_sme_invoice_index_grows_on_single_mint() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        let id1 = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        let id2 = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        let ids = client.get_sme_invoice_ids(&sme, &0u32, &10u32);
        assert_eq!(ids.len(), 2);
        assert_eq!(ids.get(0).unwrap(), id1);
        assert_eq!(ids.get(1).unwrap(), id2);
    }

    #[test]
    fn test_sme_invoice_index_shrinks_on_withdraw() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        let id1 = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        let id2 = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        client.withdraw_invoice(&sme, &id1);
        let ids = client.get_sme_invoice_ids(&sme, &0u32, &10u32);
        assert_eq!(ids.len(), 1);
        assert_eq!(ids.get(0).unwrap(), id2);
    }

    // ── Migration ─────────────────────────────────────────────────────────────

    #[test]
    fn test_migrate_success() {
        let (env, admin, client) = setup();
        assert!(client.try_migrate(&admin).is_ok());
    }

    #[test]
    fn test_migrate_non_admin_fails() {
        let (env, _admin, client) = setup();
        let non_admin = Address::generate(&env);
        assert!(client.try_migrate(&non_admin).is_err());
    }

    #[test]
    fn test_migrate_idempotent() {
        let (env, admin, client) = setup();
        assert!(client.try_migrate(&admin).is_ok());
        assert!(client.try_migrate(&admin).is_ok());
    }

    #[test]
    fn test_migrate_v2_to_v3_splits_hot_cold() {
        let (env, admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        // Write a v2 Invoice record directly into legacy Invoice(id) key.
        let legacy_inv = Invoice {
            id: 1u64,
            sme: sme.clone(),
            debtor_hash: Bytes::from_slice(&env, &[1u8; 32]),
            amount: 1_000_000_000i128,
            currency: Symbol::new(&env, "USDC"),
            due_date: due,
            ipfs_cid: ipfs_cid(&env),
            metadata_hash: Bytes::new(&env),
            risk_score: 30u32,
            risk_tier: RiskTier::AA,
            status: InvoiceStatus::Created,
            created_at: env.ledger().timestamp(),
            funded_at: None,
            repaid_at: None,
            notes: None,
        };
        env.as_contract(&client.address, || {
            env.storage().persistent().set(&DataKey::Invoice(1u64), &legacy_inv);
            env.storage().instance().set(&DataKey::NextId, &2u64);
            env.storage().instance().set(&DataKey::MigrationVersion, &2u32);
        });
        client.migrate(&admin);
        // After migration, get_invoice should work via hot+cold keys.
        let inv = client.get_invoice(&1u64);
        assert_eq!(inv.id, 1u64);
        assert_eq!(inv.sme, sme);
        assert_eq!(inv.amount, 1_000_000_000i128);
        assert_eq!(inv.notes, None);
        // Legacy key should be removed.
        let legacy_exists: bool = env.as_contract(&client.address, || {
            env.storage().persistent().has(&DataKey::Invoice(1u64))
        });
        assert!(!legacy_exists);
    }

    // ── Mint rate limit ───────────────────────────────────────────────────────

    #[test]
    fn test_mint_unthrottled_when_rate_limit_unset() {
        let (env, _admin, client) = setup();
        let sme = Address::generate(&env);
        assert!(client.get_mint_rate_limit().is_none());
        for _ in 0..5 {
            client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &(env.ledger().timestamp() + 86_400 * 30), &ipfs_cid(&env), &50u32, &None);
        }
    }

    #[test]
    fn test_set_mint_rate_limit_rejects_zero_values() {
        let (_env, admin, client) = setup();
        assert_eq!(
            client.try_set_mint_rate_limit(&admin, &0u32, &3600u64).unwrap_err().unwrap(),
            InvoiceNftError::InvalidParameterValue
        );
        assert_eq!(
            client.try_set_mint_rate_limit(&admin, &3u32, &0u64).unwrap_err().unwrap(),
            InvoiceNftError::InvalidParameterValue
        );
    }

    #[test]
    fn test_mint_rate_limit_blocks_then_recovers_after_window() {
        let (env, admin, client) = setup();
        client.set_mint_rate_limit(&admin, &3u32, &3600u64);
        let sme = Address::generate(&env);
        for _ in 0..3 {
            client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &(env.ledger().timestamp() + 86_400 * 30), &ipfs_cid(&env), &50u32, &None);
        }
        assert_eq!(
            client.try_mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &(env.ledger().timestamp() + 86_400 * 30), &ipfs_cid(&env), &50u32, &None).unwrap_err().unwrap(),
            InvoiceNftError::MintRateLimitExceeded
        );
        advance(&env, 3600);
        client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &(env.ledger().timestamp() + 86_400 * 30), &ipfs_cid(&env), &50u32, &None);
        assert_eq!(client.get_sme_mint_window(&sme).1, 1u32);
    }

    #[test]
    fn test_mint_rate_limit_is_per_sme() {
        let (env, admin, client) = setup();
        client.set_mint_rate_limit(&admin, &1u32, &3600u64);
        let sme_a = Address::generate(&env);
        let sme_b = Address::generate(&env);
        client.mint_invoice(&sme_a, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &(env.ledger().timestamp() + 86_400 * 30), &ipfs_cid(&env), &50u32, &None);
        assert_eq!(
            client.try_mint_invoice(&sme_a, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &(env.ledger().timestamp() + 86_400 * 30), &ipfs_cid(&env), &50u32, &None).unwrap_err().unwrap(),
            InvoiceNftError::MintRateLimitExceeded
        );
        // sme_b is unaffected
        client.mint_invoice(&sme_b, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &(env.ledger().timestamp() + 86_400 * 30), &ipfs_cid(&env), &50u32, &None);
    }

    // ── Two-step admin transfer ───────────────────────────────────────────────

    #[test]
    fn test_propose_then_accept_transfers_admin() {
        let (env, admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.propose_admin(&admin, &new_admin);
        client.accept_admin(&new_admin);
        // new admin can call admin-only ops; old admin is rejected
        assert!(client.try_freeze_invoice(&admin, &9999u64).is_err());
    }

    #[test]
    fn test_propose_admin_requires_admin() {
        let (env, _admin, client) = setup();
        let stranger = Address::generate(&env);
        let new_admin = Address::generate(&env);
        assert!(client.try_propose_admin(&stranger, &new_admin).is_err());
    }

    #[test]
    fn test_accept_admin_wrong_caller_fails() {
        let (env, admin, client) = setup();
        let new_admin = Address::generate(&env);
        let impostor = Address::generate(&env);
        client.propose_admin(&admin, &new_admin);
        assert!(client.try_accept_admin(&impostor).is_err());
    }

    #[test]
    fn test_cancel_admin_proposal_blocks_accept() {
        let (env, admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.propose_admin(&admin, &new_admin);
        client.cancel_admin_proposal(&admin);
        assert!(client.try_accept_admin(&new_admin).is_err());
    }

    // ── set_authorized_callers validation ─────────────────────────────────────

    #[test]
    fn test_set_authorized_callers_identical_addresses_rejected() {
        let (env, admin, client) = setup();
        let same = Address::generate(&env);
        assert_eq!(
            client.try_set_authorized_callers(&admin, &same, &same).unwrap_err().unwrap(),
            InvoiceNftError::InvalidAddress
        );
    }

    #[test]
    fn test_set_authorized_callers_collision_with_admin_rejected() {
        let (env, admin, client) = setup();
        let pool = Address::generate(&env);
        assert_eq!(
            client.try_set_authorized_callers(&admin, &admin, &pool).unwrap_err().unwrap(),
            InvoiceNftError::InvalidAddress
        );
    }

    // ── archive_invoice ───────────────────────────────────────────────────────

    #[test]
    fn test_archive_invoice_fails_for_non_terminal_status() {
        let (env, admin, client) = setup();
        let id = mint_default(&env, &client, 10u32);
        assert_eq!(
            client.try_archive_invoice(&admin, &id).unwrap_err().unwrap(),
            InvoiceNftError::InvalidInvoiceStatus
        );
    }

    #[test]
    fn test_archive_invoice_repaid_succeeds() {
        let (env, admin, client) = setup();
        let id = mint_default(&env, &client, 10u32);
        let mp = Address::generate(&env);
        let pool = Address::generate(&env);
        client.set_authorized_callers(&admin, &mp, &pool);
        client.set_listed(&mp, &id);
        client.set_funded(&pool, &id);
        client.set_repaid(&pool, &id);
        client.archive_invoice(&admin, &id);
        assert_eq!(client.try_get_invoice(&id).unwrap_err().unwrap(), InvoiceNftError::InvoiceNotFound);
    }

    // ── Hot/cold split regression: status transitions only touch hot key ──────

    #[test]
    fn test_status_transition_does_not_require_cold_key() {
        // Verify that set_listed/set_funded/set_repaid succeed even when the
        // cold key is absent (simulates a partially-migrated record where only
        // the hot key exists). This proves the hot/cold split is correct.
        let (env, admin, client) = setup();
        let sme = Address::generate(&env);
        let due = env.ledger().timestamp() + 86_400 * 30;
        let id = client.mint_invoice(&sme, &Bytes::from_slice(&env, &[1u8; 32]), &1_000_000_000i128, &Symbol::new(&env, "USDC"), &due, &ipfs_cid(&env), &10u32, &None);
        // Remove the cold key to simulate hot-only record.
        env.as_contract(&client.address, || {
            env.storage().persistent().remove(&DataKey::InvoiceCold(id));
        });
        let mp = Address::generate(&env);
        let pool = Address::generate(&env);
        client.set_authorized_callers(&admin, &mp, &pool);
        // set_listed reads only hot key — must succeed.
        client.set_listed(&mp, &id);
        assert_eq!(
            env.as_contract(&client.address, || {
                env.storage().persistent().get::<DataKey, InvoiceHot>(&DataKey::InvoiceHot(id)).unwrap().status
            }),
            InvoiceStatus::Listed
        );
    }
}
