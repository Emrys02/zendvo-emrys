use soroban_sdk::{contract, contractimpl, Address, Env};

use crate::gift::types::DataKey;

/// Entry point for the time-locked gift contract.
#[contract]
pub struct GiftContract;

#[contractimpl]
impl GiftContract {
    /// Initializes the contract with a backend admin address.
    ///
    /// Must be called exactly once immediately after deployment.
    /// Reverts if the admin has already been set, preventing any actor
    /// from overwriting admin rights post-deployment.
    pub fn initialize(env: Env, admin: Address) {
        // Guard: panic if already initialized to prevent admin hijacking.
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
    }
}
