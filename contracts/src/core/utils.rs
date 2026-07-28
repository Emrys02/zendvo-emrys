// Contains shared utility functions used across the contract.
// e.g., authorization checks, time validation helpers.
// Handles stablecoin (USDC) transfers via soroban_sdk::token::Client.

use crate::core::errors::ContractError;
use soroban_sdk::Env;

/// The minimum deposit amount accepted by the protocol, expressed in the
/// native USDC stroops precision.
///
/// This prevents dust/spam deposits and guarantees all recorded state is
/// economically meaningful.
pub const MIN_DEPOSIT_AMOUNT: i128 = 10_000_000;

/// Routes idle USDC to external yield protocols like Blend or an AMM.
/// Note: Must only be callable by the contract itself or a backend admin, not end-users.
pub fn deposit_to_yield_protocol(_env: &Env, _amount: i128) -> Result<(), ContractError> {
    // TODO: Add authorization to ensure caller is the contract or backend admin.

    // Placeholder: Cross-contract invocation logic.
    // e.g., env.invoke_contract(&protocol_address, &soroban_sdk::symbol_short!("deposit"), (amount,))

    Ok(())
}

/// Withdraws USDC from external yield protocols.
/// Note: Must only be callable by the contract itself or a backend admin, not end-users.
pub fn withdraw_from_yield_protocol(_env: &Env, _amount: i128) -> Result<(), ContractError> {
    // TODO: Add authorization to ensure caller is the contract or backend admin.

    // Placeholder: Cross-contract invocation logic.
    // e.g., env.invoke_contract(&protocol_address, &soroban_sdk::symbol_short!("withdraw"), (amount,))

    Ok(())
}
