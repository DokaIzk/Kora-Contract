use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NormalizedEvent {
    pub contract: String,
    pub event_type: String,
    pub ledger_sequence: u64,
    pub event_index: u32,
    pub decoded_payload: serde_json::Value,
}

#[derive(Default)]
pub struct IndexerStore {
    events: Mutex<HashMap<(u64, u32), NormalizedEvent>>,
    last_checkpoint: Mutex<u64>,
}

impl IndexerStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, event: NormalizedEvent) -> bool {
        let mut events = self.events.lock().unwrap();
        let key = (event.ledger_sequence, event.event_index);
        if events.contains_key(&key) {
            return false; // Idempotent skip
        }
        events.insert(key, event);
        true
    }

    pub fn set_checkpoint(&self, seq: u64) {
        let mut cp = self.last_checkpoint.lock().unwrap();
        *cp = seq;
    }

    pub fn get_checkpoint(&self) -> u64 {
        *self.last_checkpoint.lock().unwrap()
    }

    pub fn query_by_contract(&self, contract: &str) -> Vec<NormalizedEvent> {
        let events = self.events.lock().unwrap();
        events
            .values()
            .filter(|e| e.contract == contract)
            .cloned()
            .collect()
    }
}

pub struct IndexerService {
    store: Arc<IndexerStore>,
}

impl IndexerService {
    pub fn new(store: Arc<IndexerStore>) -> Self {
        Self { store }
    }

    pub fn ingest_raw_event(
        &self,
        contract: &str,
        event_type: &str,
        ledger_seq: u64,
        event_idx: u32,
        raw_payload: &str,
    ) -> Result<bool, String> {
        let decoded: serde_json::Value = serde_json::from_str(raw_payload)
            .map_err(|e| format!("Malformed event payload: {}", e))?;

        let event = NormalizedEvent {
            contract: contract.to_string(),
            event_type: event_type.to_string(),
            ledger_sequence: ledger_seq,
            event_index: event_idx,
            decoded_payload: decoded,
        };

        let inserted = self.store.insert(event);
        if inserted {
            self.store.set_checkpoint(ledger_seq);
        }
        Ok(inserted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_indexer_idempotency_and_checkpoint_resumption() {
        let store = Arc::new(IndexerStore::new());
        let indexer = IndexerService::new(store.clone());

        // Initial event
        let ok1 = indexer.ingest_raw_event("invoice_nft", "INV_CRT", 100, 1, r#"{"id": 1, "amount": 1000}"#).unwrap();
        assert!(ok1);
        assert_eq!(store.get_checkpoint(), 100);

        // Duplicate event (reorg / restart simulate)
        let ok_dup = indexer.ingest_raw_event("invoice_nft", "INV_CRT", 100, 1, r#"{"id": 1, "amount": 1000}"#).unwrap();
        assert!(!ok_dup); // Not re-inserted

        // Malformed event skip-and-log test
        let err = indexer.ingest_raw_event("marketplace", "MKT_LST", 101, 1, "invalid json");
        assert!(err.is_err());

        // Checkpoint unchanged on error
        assert_eq!(store.get_checkpoint(), 100);

        let queried = store.query_by_contract("invoice_nft");
        assert_eq!(queried.len(), 1);
    }
}
