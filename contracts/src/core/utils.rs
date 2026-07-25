// Contains shared utility functions used across the contract.
// e.g., authorization checks, time validation helpers.
// Handles stablecoin (USDC) transfers via soroban_sdk::token::Client.

/// The minimum deposit amount accepted by the protocol, expressed in the
/// native USDC stroops precision.
///
/// This prevents dust/spam deposits and guarantees all recorded state is
/// economically meaningful.
pub const MIN_DEPOSIT_AMOUNT: i128 = 10_000_000;
