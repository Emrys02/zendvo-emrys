use soroban_sdk::{Address, Env};

use crate::gift::types::{DataKey, Gift};

/// Average Stellar ledger close time, used to convert a gift's wall-clock
/// unlock duration into an equivalent number of ledgers for TTL bumps.
const AVG_LEDGER_TIME_SECONDS: u64 = 5;

/// Extends a `GiftRecord`'s persistent TTL so it survives at least until the
/// gift's `unlock_time`, capped at the network's maximum allowed TTL.
///
/// Passing the same value as both `threshold` and `extend_to` means the
/// entry is only actually bumped when its live-until ledger would otherwise
/// fall short of covering the gift's remaining lock duration — avoiding
/// wasted rent on writes that don't need it while guaranteeing a long-locked
/// gift can never be archived out from under its recipient before it
/// unlocks.
fn bump_gift_ttl(env: &Env, gift_id: u64, gift: &Gift) {
    let now = env.ledger().timestamp();
    let seconds_until_unlock = gift.unlock_time.saturating_sub(now);
    let ledgers_until_unlock = seconds_until_unlock / AVG_LEDGER_TIME_SECONDS;

    let extend_to = u32::try_from(ledgers_until_unlock)
        .unwrap_or(u32::MAX)
        .min(env.storage().max_ttl());

    env.storage()
        .persistent()
        .extend_ttl(&DataKey::GiftRecord(gift_id), extend_to, extend_to);
}

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

/// Writes a gift record to persistent storage and bumps its TTL so it
/// remains live at least through `gift.unlock_time`.
pub fn set_gift(env: &Env, gift_id: u64, gift: &Gift) {
    env.storage()
        .persistent()
        .set(&DataKey::GiftRecord(gift_id), gift);
    bump_gift_ttl(env, gift_id, gift);
}

/// Reads a gift record from persistent storage. Panics if not found.
pub fn get_gift(env: &Env, gift_id: u64) -> Gift {
    env.storage()
        .persistent()
        .get(&DataKey::GiftRecord(gift_id))
        .expect("gift not found")
}

/// Removes a gift record from persistent storage.
pub fn remove_gift(env: &Env, gift_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::GiftRecord(gift_id));
}

// ── Token address ─────────────────────────────────────────────────────────────

/// Reads the stored USDC token contract address. Panics if uninitialized.
pub fn get_token_address(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::TokenAddress)
        .expect("token address not set")
}
