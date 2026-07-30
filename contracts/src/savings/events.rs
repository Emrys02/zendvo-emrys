use soroban_sdk::{symbol_short, Address, Env};

pub fn emit_savings_deposited(env: &Env, user: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("SavDep"), user.clone()), amount);
}

/// Emitted when a user claims accumulated yield.
///
/// Topics : ("SavYld", user)
/// Data   : claimed_amount
pub fn emit_savings_yield_claimed(env: &Env, user: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("SavYld"), user.clone()), amount);
}

/// Emitted when a user withdraws principal from their savings.
///
/// Topics : ("SavWth", user)
/// Data   : withdrawn_amount
pub fn emit_savings_withdrawn(env: &Env, user: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("SavWth"), user.clone()), amount);
}

/// Emitted when the admin drains the platform fee pool into the treasury.
///
/// Topics : ("FeesCld", treasury)
/// Data   : amount_collected
pub fn emit_fees_collected(env: &Env, treasury: &Address, amount: i128) {
    env.events()
        .publish((symbol_short!("FeesCld"), treasury.clone()), amount);
}

pub fn emit_yield_accrued(env: &Env, user: &Address, yield_amount: i128) {
    env.events().publish(
        (symbol_short!("YldAccrd"), user.clone()),
        yield_amount,
    );
}
