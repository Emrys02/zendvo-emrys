use soroban_sdk::{contract, contractimpl, Address, Env};

use crate::savings::events;
use crate::savings::storage;
use crate::savings::types::ContractError;

#[contract]
pub struct SavingsContract;

#[contractimpl]
impl SavingsContract {
    pub fn initialize(env: Env, admin: Address) {
        if storage::get_admin(&env).is_some() {
            panic!("already initialized");
        }
        storage::set_admin(&env, &admin);
    }

    pub fn accrue_yield(
        env: Env,
        admin: Address,
        user: Address,
        yield_amount: i128,
    ) -> Result<(), ContractError> {
        admin.require_auth();

        let mut savings = storage::get_user_savings(&env, &user)
            .ok_or(ContractError::UserNotFound)?;

        savings.yield_shares = savings
            .yield_shares
            .checked_add(yield_amount)
            .ok_or(ContractError::Overflow)?;

        storage::set_user_savings(&env, &user, &savings);

        events::emit_yield_accrued(&env, &user, yield_amount);

        Ok(())
    }
}
