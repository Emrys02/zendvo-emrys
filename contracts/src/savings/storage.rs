use soroban_sdk::{Address, Env};

use crate::savings::types::{DataKey, UserSavings};

pub fn get_user_savings(env: &Env, user: &Address) -> Option<UserSavings> {
    env.storage().persistent().get(&DataKey::UserSavings(user.clone()))
}

pub fn set_user_savings(env: &Env, user: &Address, savings: &UserSavings) {
    env.storage().persistent().set(&DataKey::UserSavings(user.clone()), savings);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}
