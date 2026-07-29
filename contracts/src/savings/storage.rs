use soroban_sdk::{Address, Env};

use crate::savings::types::{DataKey, UserSavings};

pub fn get_user_savings(env: &Env, user: &Address) -> UserSavings {
    env.storage()
        .persistent()
        .get(&DataKey::UserSavingsRecord(user.clone()))
        .unwrap_or(UserSavings {
            principal: 0,
            yield_shares: 0,
        })
}

pub fn has_user_savings(env: &Env, user: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::UserSavingsRecord(user.clone()))
}

pub fn set_user_savings(env: &Env, user: &Address, record: &UserSavings) {
    env.storage()
        .persistent()
        .set(&DataKey::UserSavingsRecord(user.clone()), record);
}

pub fn get_token_address(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::TokenAddress)
        .expect("token address not set")
}

pub fn get_is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::IsPaused)
        .unwrap_or(false)
}

pub fn set_is_paused(env: &Env, is_paused: bool) {
    env.storage().instance().set(&DataKey::IsPaused, &is_paused);
}

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("admin not set")
}

// ── Platform fees ─────────────────────────────────────────────────────────────

/// Returns the current accumulated platform fee balance (defaults to 0).
pub fn get_platform_fees(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::PlatformFees)
        .unwrap_or(0i128)
}

/// Overwrites the stored platform fee balance.
pub fn set_platform_fees(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::PlatformFees, &amount);
}

/// Atomically adds `delta` to the platform fee pool using checked arithmetic.
/// Returns the new balance, or `None` on overflow.
pub fn accumulate_platform_fees(env: &Env, delta: i128) -> Option<i128> {
    let current = get_platform_fees(env);
    let new_balance = current.checked_add(delta)?;
    set_platform_fees(env, new_balance);
    Some(new_balance)
}
