use soroban_sdk::{symbol_short, Address, Env};

/// Emitted when a sender redirects a pending gift to a new recipient.
///
/// Topics : ["RecipientUpdated", sender]
/// Data   : (gift_id, old_recipient, new_recipient)
pub fn emit_recipient_updated(
    env: &Env,
    gift_id: u64,
    sender: &Address,
    old_recipient: &Address,
    new_recipient: &Address,
) {
    env.events().publish(
        (symbol_short!("RecipUpd"), sender.clone()),
        (gift_id, old_recipient.clone(), new_recipient.clone()),
    );
}

/// Emitted when a new time-locked gift is created.
///
/// Topics : ["GiftCrtd", sender]
/// Data   : (gift_id, recipient, amount, unlock_time, timestamp)
pub fn emit_gift_created(
    env: &Env,
    gift_id: u64,
    sender: &Address,
    recipient: &Address,
    amount: i128,
    unlock_time: u64,
) {
    let timestamp = env.ledger().timestamp();

    env.events().publish(
        (symbol_short!("GiftCrtd"), sender.clone()),
        (gift_id, recipient.clone(), amount, unlock_time, timestamp),
    );
}

/// Emitted when a sender cancels an unclaimed gift.
///
/// Topics : ["GiftCncld", sender]
/// Data   : (gift_id, amount, timestamp)
pub fn emit_gift_cancelled(env: &Env, gift_id: u64, sender: &Address, amount: i128) {
    let timestamp = env.ledger().timestamp();
    env.events().publish(
        (symbol_short!("GiftCncld"), sender.clone()),
        (gift_id, amount, timestamp),
    );
}

#[cfg(test)]
mod tests {
    use super::emit_gift_created;
    use soroban_sdk::{
        contract, contractimpl, symbol_short,
        testutils::{Address as _, Events as _, Ledger as _},
        vec, Address, Env, IntoVal,
    };

    #[contract]
    struct EventTestContract;

    #[contractimpl]
    impl EventTestContract {
        pub fn emit_gift_created(
            env: Env,
            gift_id: u64,
            sender: Address,
            recipient: Address,
            amount: i128,
            unlock_time: u64,
        ) {
            emit_gift_created(&env, gift_id, &sender, &recipient, amount, unlock_time);
        }
    }

    #[test]
    fn gift_created_uses_ledger_timestamp() {
        let env = Env::default();
        let contract_id = env.register(EventTestContract, ());
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let timestamp = 1_750_000_000u64;

        env.ledger().set_timestamp(timestamp);

        EventTestContractClient::new(&env, &contract_id).emit_gift_created(
            &1,
            &sender,
            &recipient,
            &5_000_000,
            &1_760_000_000,
        );

        assert_eq!(
            env.events().all(),
            vec![
                &env,
                (
                    contract_id,
                    (symbol_short!("GiftCrtd"), sender).into_val(&env),
                    (1u64, recipient, 5_000_000i128, 1_760_000_000u64, timestamp,).into_val(&env),
                )
            ]
        );
    }
}
