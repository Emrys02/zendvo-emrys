use soroban_sdk::{symbol_short, Address, Env};

/// Emitted when a new time-locked gift is created.
///
/// Topics : ["GiftCreated", sender]
/// Data   : (gift_id, recipient, amount, unlock_time)
pub fn emit_gift_created(
    env: &Env,
    gift_id: u64,
    sender: &Address,
    recipient: &Address,
    amount: i128,
    unlock_time: u64,
) {
    env.events().publish(
        (symbol_short!("GiftCrtd"), sender.clone()),
        (gift_id, recipient.clone(), amount, unlock_time),
    );
}
