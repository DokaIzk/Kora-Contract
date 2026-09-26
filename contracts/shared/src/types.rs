use soroban_sdk::{contracttype, Address, Bytes, BytesN, String, Symbol, Vec};

/// Invoice lifecycle status
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InvoiceStatus {
    Created,
    Listed,
    Funded,
    Repaid,
    Defaulted,
}

/// Risk tier assigned by verifiers
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RiskTier {
    AAA, // 0–20
    AA,  // 21–40
    A,   // 41–60
    B,   // 61–80
    C,   // 81–100
}

impl RiskTier {
    /// OPT: Mark for inlining - simple range-based match, called frequently during minting
    #[inline]
    pub fn from_score(score: u32) -> RiskTier {
        match score {
            0..=20 => RiskTier::AAA,
            21..=40 => RiskTier::AA,
            41..=60 => RiskTier::A,
            61..=80 => RiskTier::B,
            _ => RiskTier::C,
        }
    }
}

/// Core invoice NFT data stored on-chain
///
/// Schema version: 2 (see docs/MIGRATIONS.md for upgrade history)
///
/// Version history:
///   v1 — original fields through `repaid_at`
///   v2 — added `notes: Option<String>` for optional free-text memo (migration in invoice_nft::migrate)
#[contracttype]
#[derive(Clone, Debug)]
pub struct Invoice {
    pub id: u64,
    pub sme: Address,
    pub debtor_hash: Bytes, // keccak/sha256 of debtor info — PII stays off-chain
    pub amount: i128,       // face value in stroops (7 decimals)
    pub currency: Symbol,   // e.g. USDC, EURC
    pub due_date: u64,      // Unix timestamp
    pub ipfs_cid: String,   // IPFS CID of full invoice metadata
    pub metadata_hash: Bytes, // SHA-256 content commitment of the off-chain metadata document (empty until committed)
    pub risk_score: u32,      // 0–100
    pub risk_tier: RiskTier,
    pub status: InvoiceStatus,
    pub created_at: u64,
    pub funded_at: Option<u64>,
    pub repaid_at: Option<u64>,
    /// Optional free-text memo attached at minting time. Added in schema v2.
    /// Pre-existing records will have this field set to None by invoice_nft::migrate.
    pub notes: Option<String>,
}

/// A marketplace listing for an invoice
#[contracttype]
#[derive(Clone, Debug)]
pub struct Listing {
    pub invoice_id: u64,
    pub seller: Address,
    pub asking_price: i128, // discounted price investors pay (the starting price for Dutch auction)
    pub face_value: i128,   // full repayment amount
    pub token: Address,     // whitelisted stablecoin
    pub funded_amount: i128,
    pub funding_deadline: u64,
    pub is_active: bool,
    /// Optional deadline for the reverse-auction bidding window (#440).
    /// When `Some`, direct `fund_invoice` calls are rejected until
    /// `accept_bids` converts winning bids into positions.
    /// When `None`, the listing uses the standard first-come-first-served flow.
    pub bidding_deadline: Option<u64>,
}

/// Dutch-auction / linear-decay price schedule for a listing (#439).
///
/// When attached to a listing via `DataKey::DecaySchedule(invoice_id)`, the
/// effective asking price decays linearly from `start_price` to `floor_price`
/// over the window `[decay_start_ts, decay_end_ts]`.
///
/// - Before `decay_start_ts`  : price == `start_price` (original asking price)
/// - After  `decay_end_ts`    : price == `floor_price`  (floor)
/// - In between               : linear interpolation
///
/// `floor_price` must be > 0 and < `start_price`.
/// `decay_end_ts` must be <= `funding_deadline` of the listing.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DecaySchedule {
    /// The initial (ceiling) price — mirrors `Listing::asking_price`.
    pub start_price: i128,
    /// The minimum (floor) price the listing will reach.
    pub floor_price: i128,
    /// Timestamp at which price decay begins.
    pub decay_start_ts: u64,
    /// Timestamp at which the price reaches `floor_price` (and stays there).
    pub decay_end_ts: u64,
}

/// A reverse-auction bid submitted by an investor (#440).
///
/// Stored under `DataKey::Bid(invoice_id, investor)`.
/// The investor commits to funding `amount` tokens at `bid_price` total.
/// `bid_price` must be <= current asking price and >= the floor price (if a
/// decay schedule is active).
#[contracttype]
#[derive(Clone, Debug)]
pub struct Bid {
    pub investor: Address,
    pub invoice_id: u64,
    /// The total price the investor is willing to pay for their `amount` share.
    /// Must satisfy `bid_price <= current_asking_price`.
    pub bid_price: i128,
    /// The token amount the investor proposes to contribute.
    pub amount: i128,
    /// Ledger timestamp when the bid was submitted.
    pub submitted_at: u64,
}

/// A single investor position in a pool
#[contracttype]
#[derive(Clone, Debug)]
pub struct Position {
    pub investor: Address,
    pub invoice_id: u64,
    pub contributed: i128,
    pub share_bps: u32, // basis points of total pool (10000 = 100%)
    pub yield_claimed: i128,
}

/// Pool state for a funded invoice
#[contracttype]
#[derive(Clone, Debug)]
pub struct Pool {
    pub invoice_id: u64,
    pub token: Address,
    pub total_funded: i128,
    pub face_value: i128,
    pub repaid_amount: i128,
    pub is_closed: bool,
    pub late_penalty_bps: u32,
    pub total_owed: i128,
    pub penalty_applied: bool,
}

/// An active offer to sell an investor position on the secondary market
#[contracttype]
#[derive(Clone, Debug)]
pub struct PositionSaleOffer {
    pub seller: Address,
    pub invoice_id: u64,
    pub token: Address,
    pub price: i128,
}

/// An SME's early-termination buyout offer for a funded invoice.
///
/// The SME escrows `amount` (a discount to `total_owed`) into the pool; investors then
/// accept, and once investors representing 100% of pool shares have accepted, the escrow
/// is distributed pro-rata and the pool closes.
#[contracttype]
#[derive(Clone, Debug)]
pub struct EarlySettlementOffer {
    pub invoice_id: u64,
    pub amount: i128,      // escrowed buyout amount, denominated in the pool token
    pub accepted_bps: u32, // cumulative share_bps of investors that have accepted
    pub accepted: Vec<Address>, // investors that have already accepted (dedup guard)
}

/// Pending repayment approval for a high-value invoice repayment.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RepaymentApproval {
    pub invoice_id: u64,
    pub amount: i128,
    pub approvals: Vec<Address>,
    pub executed: bool,
}

/// Protocol-level configuration.
///
/// Note: pause state is NOT stored here — it is owned exclusively by the
/// AccessControl contract to avoid split-brain between two sources of truth.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProtocolConfig {
    pub fee_bps: u32,          // protocol fee in basis points (e.g. 50 = 0.5%)
    pub late_penalty_bps: u32, // penalty on late repayment
    pub max_risk_score: u32,   // ceiling for accepted invoices
    pub min_funding_period: u64,
}

/// Per-risk-tier face-value bounds for invoice minting/listing.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AmountBounds {
    pub min: i128,
    pub max: i128,
}

impl AmountBounds {
    pub fn new(min: i128, max: i128) -> Self {
        Self { min, max }
    }

    pub fn is_within(&self, amount: i128) -> bool {
        amount >= self.min && amount <= self.max
    }
}

/// SME profile in the risk registry
#[contracttype]
#[derive(Clone, Debug)]
pub struct SmeProfile {
    pub address: Address,
    pub verified: bool,
    pub verifier: Address,
    pub risk_score: u32,
    pub total_invoices: u32,
    pub defaults: u32,
    pub registered_at: u64,
    pub compliance_attested: bool,
    /// Maximum aggregate exposure across active invoices (0 = unlimited).
    pub credit_limit: i128,
}

/// Action types that can be proposed for multisig execution
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdminAction {
    Pause,
    Unpause,
    GrantRole(Address, u32),
    RevokeRole(Address),
    TransferAdmin(Address),
    /// Rotate the admin key to a new address.
    /// Identical effect to
    RotateAdmin(Address),
    /// Replace the co-signer set and/or threshold. Requires its own quorum.
    UpdateSigners(Vec<Address>, u32),
}

/// Multi-signature governance configuration for the access-control contract.
///
/// Holds the set of co-signers and the N-of-M approval threshold. Privileged
/// operations are only executed once a quorum of distinct co-signers has
/// approved the corresponding `PendingAction` within the configured window.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MultisigConfig {
    /// The set of authorized co-signers (M).
    pub signers: Vec<Address>,
    /// Number of distinct approvals required to execute an action (N).
    pub threshold: u32,
    /// Maximum age (in seconds) a pending action may remain open before it
    /// expires and can no longer be executed.
    pub window_secs: u64,
}

/// A privileged action awaiting a quorum of co-signer approvals.
///
/// Keyed by the action hash so that identical actions proposed by different
/// signers collapse into a single queue entry. Once `approvals` reaches the
/// configured threshold the action may be executed exactly once.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PendingAction {
    /// Hash identifying the action payload (see `AdminAction`).
    pub action_hash: BytesN<32>,
    /// The action to execute once the threshold is met.
    pub action: AdminAction,
    /// Distinct co-signers that have approved this action so far.
    pub approvals: Vec<Address>,
    /// Ledger timestamp when the action was first proposed.
    pub proposed_at: u64,
    /// Ledger timestamp after which the action expires and cannot execute.
    pub expires_at: u64,
    /// Set once the action has been executed to prevent replays.
    pub executed: bool,
}
