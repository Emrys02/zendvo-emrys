use soroban_sdk::{symbol_short, Address, Env};

pub fn emit_yield_accrued(env: &Env, user: &Address, yield_amount: i128) {
    env.events().publish(
        (symbol_short!("YldAccrd"), user.clone()),
        yield_amount,
    );
}
