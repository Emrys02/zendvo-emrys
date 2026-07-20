use soroban_sdk::{Address, Env};

use crate::gift::types::{DataKey, Gift};

// ── Gift counter ─────────────────────────────────────────────────────────────

/// Returns the current gift counter, defaulting to 0 if unset.
pub fn get_gift_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::GiftCounter)
        .unwrap_or(0u64)
}

/// Persists the gift counter back to instance storage.
pub fn set_gift_counter(env: &Env, counter: u64) {
    env.storage()
        .instance()
        .set(&DataKey::GiftCounter, &counter);
}

// ── Gift records ─────────────────────────────────────────────────────────────

/// Writes a gift record to persistent storage.
pub fn set_gift(env: &Env, gift_id: u64, gift: &Gift) {
    env.storage()
        .persistent()
        .set(&DataKey::GiftRecord(gift_id), gift);
}

/// Reads a gift record from persistent storage. Panics if not found.
pub fn get_gift(env: &Env, gift_id: u64) -> Gift {
    env.storage()
        .persistent()
        .get(&DataKey::GiftRecord(gift_id))
        .expect("gift not found")
}

// ── Token address ─────────────────────────────────────────────────────────────

/// Reads the stored USDC token contract address. Panics if uninitialized.
pub fn get_token_address(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::TokenAddress)
        .expect("token address not set")
}
