#![allow(unused)]

use soroban_sdk::{contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, String};

/// Ring-buffer capacity for on-chain audit log.
pub const MAX_AUDIT_LOG_SIZE: u64 = 500;

/// A single audit log entry.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AuditEntry {
    pub action: String,
    pub actor: Address,
    pub timestamp: u64,
    pub sequence: u64,
}

/// Compute a new rolling checksum by chaining: sha256(prev || entry_bytes).
pub fn chain_checksum(env: &Env, prev: &BytesN<32>, entry: &AuditEntry) -> BytesN<32> {
    let mut buf = Bytes::new(env);

    buf.append(&prev.clone().into());

    let seq_bytes = entry.sequence.to_le_bytes();
    for b in seq_bytes {
        buf.push_back(b);
    }

    let ts_bytes = entry.timestamp.to_le_bytes();
    for b in ts_bytes {
        buf.push_back(b);
    }

    let actor_bytes = entry.actor.clone().to_xdr(env);
    buf.append(&actor_bytes);

    let action_bytes: Bytes = entry.action.clone().to_xdr(env);
    buf.append(&action_bytes);

    env.crypto().sha256(&buf).into()
}

/// Identifies which contract originated the admin action.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuditSource {
    AccessControl,
    Treasury,
    RiskRegistry,
    InvoiceNft,
}

/// Canonical discriminant for every admin-gated operation across the protocol.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdminActionType {
    Pause,
    Unpause,
    GrantRole,
    RevokeRole,
    TransferAdmin,
    RotateAdmin,
    ConfigureMultisig,
    ProposeUpgrade,
    ExecuteUpgrade,
    MultisigExecuteAction,
    ProposeParameter,
    ExecuteParameter,
    ProposeVerifierAction,
    ExecuteVerifierAction,
    ProposeSignerSetChange,
    ExecuteSignerSetChange,
    SetFeeBps,
    WhitelistToken,
    Withdraw,
    EmergencyWithdraw,
    ProposeWithdrawalCap,
    ExecuteWithdrawalCap,
    TreasuryProposeUpgrade,
    TreasuryExecuteUpgrade,
    SetAccessControl,
    DeclareEmergency,
    RevokeEmergency,
    AddVerifier,
    RemoveVerifier,
    SuspendVerifier,
    ReinstateVerifier,
    RequestVerifierRemoval,
    FinalizeVerifierRemoval,
    RecordDefault,
    RegistryTransferAdmin,
    RegistryProposeUpgrade,
    RegistryExecuteUpgrade,
    CorrectMetadataHash,
    UpdateMetadataCid,
    InvoiceNftSetRiskRegistry,
    InvoiceNftSetAuthorizedCallers,
    InvoiceNftSetDefaulted,
    InvoiceNftFreezeInvoice,
    InvoiceNftUnfreezeInvoice,
    InvoiceNftAddAllowedCurrency,
    InvoiceNftRemoveAllowedCurrency,
    InvoiceNftProposeUpgrade,
    InvoiceNftExecuteUpgrade,
    InvoiceNftMigrate,
    InvoiceNftSetMintRateLimit,
}

/// A single entry in the on-chain admin audit log.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminAuditEntry {
    pub sequence: u64,
    pub timestamp: u64,
    pub actor: Address,
    pub action: AdminActionType,
    pub source: AuditSource,
    pub token: Option<Address>,
    pub amount: Option<i128>,
}
