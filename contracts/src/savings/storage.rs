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
    env.storage()
        .instance()
        .set(&DataKey::IsPaused, &is_paused);
}
