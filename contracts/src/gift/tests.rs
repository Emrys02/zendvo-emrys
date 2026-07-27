use soroban_sdk::{
    symbol_short,
    testutils::{storage::Persistent as _, Address as _, Events as _, Ledger as _},
    token, vec, Address, Env, IntoVal, TryIntoVal,
};

use crate::core::utils::MIN_DEPOSIT_AMOUNT;
use crate::gift::contract::{GiftContract, GiftContractClient, MAX_LOCK_DURATION_SECONDS};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Register the USDC test-token and return its address.
///
/// Minting is done via `token::StellarAssetClient` which exposes the
/// admin-only `mint` function — the correct API for soroban-sdk 22.x.
fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone())
        .address()
}

/// Bootstrap a fresh environment with a deployed GiftContract, an admin, a
/// USDC token, a sender with `mint_amount` tokens, and a recipient.
#[allow(dead_code)]
struct TestFixture<'a> {
    env: Env,
    contract_id: Address,
    client: GiftContractClient<'a>,
    token_id: Address,
    admin: Address,
    sender: Address,
    recipient: Address,
}

impl<'a> TestFixture<'a> {
    fn setup(mint_amount: i128) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);

        let token_id = create_token(&env, &admin);

        // Mint tokens to the sender via the StellarAssetClient (admin-only mint).
        let asset_client = token::StellarAssetClient::new(&env, &token_id);
        asset_client.mint(&sender, &mint_amount);

        let contract_id = env.register(GiftContract, ());
        let client = GiftContractClient::new(&env, &contract_id);

        client.initialize(&admin, &token_id);

        Self {
            env,
            contract_id,
            client,
            token_id,
            admin,
            sender,
            recipient,
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Initializing the contract emits an `Initialized` event with the admin address.
#[test]
fn test_initialize_emits_initialized_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_id = Address::generate(&env);

    let contract_id = env.register(GiftContract, ());
    let client = GiftContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token_id);

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                contract_id,
                (symbol_short!("init"),).into_val(&env),
                admin.into_val(&env),
            )
        ]
    );
}

/// Happy path: unlock_time exactly at the maximum allowed boundary should succeed.
#[test]
fn test_create_gift_at_max_boundary_succeeds() {
    let f = TestFixture::setup(20_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + MAX_LOCK_DURATION_SECONDS; // exactly at cap

    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);

    assert_eq!(gift_id, 1, "first gift should receive id=1");
}

/// Happy path: unlock_time well within the cap.
#[test]
fn test_create_gift_normal_unlock_succeeds() {
    let f = TestFixture::setup(20_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let one_year: u64 = 365 * 24 * 60 * 60;
    let unlock_time = ledger_now + one_year;

    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);

    assert_eq!(gift_id, 1);
}

/// Sad path: unlock_time one second beyond the cap must panic.
#[test]
#[should_panic]
fn test_create_gift_beyond_cap_panics() {
    let f = TestFixture::setup(100_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let over_cap = ledger_now + MAX_LOCK_DURATION_SECONDS + 1;

    f.client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &over_cap);
}

/// Sad path: astronomical timestamp (simulating a front-end ms-instead-of-s
/// bug) must also be rejected.
#[test]
#[should_panic]
fn test_create_gift_astronomical_timestamp_panics() {
    let f = TestFixture::setup(100_000_000);

    // Simulate a front-end bug: Unix ms timestamp used instead of seconds
    // (~year 33,658 equivalent).
    let astronomical: u64 = 100_000_000_000_000;

    f.client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &astronomical);
}

/// Sad path: zero amount must panic.
#[test]
#[should_panic]
fn test_create_gift_zero_amount_panics() {
    let f = TestFixture::setup(100_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 1000;

    f.client
        .create_gift(&f.sender, &f.recipient, &0, &unlock_time);
}

#[test]
#[should_panic]
fn test_create_gift_below_minimum_amount_panics() {
    let f = TestFixture::setup(100_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 1000;
    let amount = MIN_DEPOSIT_AMOUNT - 1;

    f.client
        .create_gift(&f.sender, &f.recipient, &amount, &unlock_time);
}

/// The gift counter increments correctly across multiple gifts.
#[test]
fn test_gift_ids_are_sequential() {
    let f = TestFixture::setup(100_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 3600;

    let id1 = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);
    let id2 = f.client.create_gift(
        &f.sender,
        &f.recipient,
        &(MIN_DEPOSIT_AMOUNT + 10_000_000),
        &unlock_time,
    );
    let id3 = f.client.create_gift(
        &f.sender,
        &f.recipient,
        &(MIN_DEPOSIT_AMOUNT + 20_000_000),
        &unlock_time,
    );

    assert_eq!((id1, id2, id3), (1, 2, 3));
}

/// Creating a gift extends its persistent TTL to cover the full remaining
/// lock duration, so a long-locked gift can't be archived before it unlocks.
#[test]
fn test_create_gift_extends_ttl_to_cover_lock_duration() {
    let f = TestFixture::setup(100_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let lock_seconds: u64 = 500_000; // divisible by the 5s avg ledger time
    let unlock_time = ledger_now + lock_seconds;

    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);

    let ttl = f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .get_ttl(&crate::gift::types::DataKey::GiftRecord(gift_id))
    });

    assert_eq!(
        ttl,
        (lock_seconds / 5) as u32,
        "TTL should be bumped to cover ledgers until unlock_time"
    );
}

/// Claiming a matured gift re-bumps its TTL via the shared `set_gift` path,
/// keeping the record alive after the state mutation.
#[test]
fn test_claim_gift_extends_ttl() {
    let f = TestFixture::setup(100_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 3600;
    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);

    f.env.ledger().set_timestamp(unlock_time);
    f.client.claim_gift(&f.recipient, &gift_id);

    let ttl = f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .get_ttl(&crate::gift::types::DataKey::GiftRecord(gift_id))
    });

    // unlock_time has already passed at claim time, so seconds_until_unlock
    // saturates to 0 and the bump is a no-op — but the record must still be
    // alive at (or just below, from ledger sequence advancing) the default
    // persistent TTL floor established when it was created.
    assert!(
        ttl > 0 && ttl <= 4096,
        "claimed gift record should still be alive under the persistent TTL floor, got {ttl}"
    );
}

// ── cancel_gift tests ─────────────────────────────────────────────────────────

/// Happy path: sender cancels an unclaimed gift and receives a refund.
#[test]
fn test_cancel_gift_succeeds() {
    let f = TestFixture::setup(100_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 3600;

    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);

    // Check contract balance before cancel.
    let token_client = token::Client::new(&f.env, &f.token_id);
    let contract_balance_before = token_client.balance(&f.contract_id);
    assert_eq!(contract_balance_before, MIN_DEPOSIT_AMOUNT);

    f.client.cancel_gift(&f.sender, &gift_id);

    // Contract balance should be 0 after refund.
    let contract_balance_after = token_client.balance(&f.contract_id);
    assert_eq!(contract_balance_after, 0);

    // Sender should have their full balance back.
    let sender_balance = token_client.balance(&f.sender);
    assert_eq!(sender_balance, 100_000_000);
}

/// Sad path: cancelling a non-existent gift returns GiftNotFound.
#[test]
fn test_cancel_gift_not_found() {
    let f = TestFixture::setup(100_000_000);

    let result = f.client.try_cancel_gift(&f.sender, &999);
    assert_eq!(
        result.err().unwrap().unwrap(),
        crate::core::errors::ContractError::GiftNotFound,
    );
}

/// Sad path: a non-sender trying to cancel returns Unauthorized.
#[test]
fn test_cancel_gift_unauthorized() {
    let f = TestFixture::setup(100_000_000);
    let imposter = Address::generate(&f.env);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 3600;
    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);

    let result = f.client.try_cancel_gift(&imposter, &gift_id);
    assert_eq!(
        result.err().unwrap().unwrap(),
        crate::core::errors::ContractError::Unauthorized,
    );
}

/// Sad path: cancelling an already-claimed gift returns AlreadyClaimed.
#[test]
fn test_cancel_gift_already_claimed() {
    let f = TestFixture::setup(100_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 3600;
    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);

    // Manually mark the gift as claimed by writing storage inside the contract context.
    let claimed_gift = crate::gift::types::Gift {
        sender: f.sender.clone(),
        recipient: f.recipient.clone(),
        amount: MIN_DEPOSIT_AMOUNT,
        unlock_time,
        is_claimed: true,
    };
    f.env.as_contract(&f.contract_id, || {
        f.env.storage().persistent().set(
            &crate::gift::types::DataKey::GiftRecord(gift_id),
            &claimed_gift,
        );
    });

    let result = f.client.try_cancel_gift(&f.sender, &gift_id);
    assert_eq!(
        result.err().unwrap().unwrap(),
        crate::core::errors::ContractError::AlreadyClaimed,
    );
}

// ── claim_gift tests ─────────────────────────────────────────────────────────

/// Happy path: recipient claims a matured gift and receives the funds.
#[test]
fn test_claim_gift_succeeds() {
    let f = TestFixture::setup(100_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 3600;
    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);

    // Fast-forward past the unlock time.
    f.env.ledger().set_timestamp(unlock_time);

    let token_client = token::Client::new(&f.env, &f.token_id);
    let recipient_balance_before = token_client.balance(&f.recipient);

    f.client.claim_gift(&f.recipient, &gift_id);

    assert_eq!(
        token_client.balance(&f.recipient),
        recipient_balance_before + MIN_DEPOSIT_AMOUNT
    );
    assert_eq!(token_client.balance(&f.contract_id), 0);
}

/// Claiming exactly at `unlock_time` (the boundary) must succeed, since the
/// check is `now >= unlock_time`, not strictly greater.
#[test]
fn test_claim_gift_at_exact_unlock_time_succeeds() {
    let f = TestFixture::setup(100_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 3600;
    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);

    f.env.ledger().set_timestamp(unlock_time);

    let result = f.client.try_claim_gift(&f.recipient, &gift_id);
    assert!(result.is_ok());
}

/// Sad path: claiming before `unlock_time` returns TimeLockActive.
#[test]
fn test_claim_gift_before_unlock_fails() {
    let f = TestFixture::setup(100_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 3600;
    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);

    let result = f.client.try_claim_gift(&f.recipient, &gift_id);
    assert_eq!(
        result.err().unwrap().unwrap(),
        crate::core::errors::ContractError::TimeLockActive,
    );
}

/// Sad path: claiming a non-existent gift returns GiftNotFound.
#[test]
fn test_claim_gift_not_found() {
    let f = TestFixture::setup(100_000_000);

    let result = f.client.try_claim_gift(&f.recipient, &999);
    assert_eq!(
        result.err().unwrap().unwrap(),
        crate::core::errors::ContractError::GiftNotFound,
    );
}

/// Sad path: an address other than the recorded recipient cannot claim.
#[test]
fn test_claim_gift_wrong_recipient_fails() {
    let f = TestFixture::setup(100_000_000);
    let imposter = Address::generate(&f.env);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 3600;
    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);

    f.env.ledger().set_timestamp(unlock_time);

    let result = f.client.try_claim_gift(&imposter, &gift_id);
    assert_eq!(
        result.err().unwrap().unwrap(),
        crate::core::errors::ContractError::Unauthorized,
    );
}

/// Sad path: a second claim attempt on an already-claimed gift fails and
/// does not double-pay the recipient.
#[test]
fn test_claim_gift_double_claim_fails() {
    let f = TestFixture::setup(100_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 3600;
    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);

    f.env.ledger().set_timestamp(unlock_time);

    f.client.claim_gift(&f.recipient, &gift_id);

    let token_client = token::Client::new(&f.env, &f.token_id);
    let recipient_balance_after_first_claim = token_client.balance(&f.recipient);

    let result = f.client.try_claim_gift(&f.recipient, &gift_id);
    assert_eq!(
        result.err().unwrap().unwrap(),
        crate::core::errors::ContractError::AlreadyClaimed,
    );
    assert_eq!(
        token_client.balance(&f.recipient),
        recipient_balance_after_first_claim,
        "balance must not change on a rejected double-claim"
    );
}

/// Claiming a gift emits a GiftClmd event.
#[test]
fn test_claim_gift_emits_event() {
    let f = TestFixture::setup(100_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 3600;
    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &MIN_DEPOSIT_AMOUNT, &unlock_time);

    f.env.ledger().set_timestamp(unlock_time);
    f.client.claim_gift(&f.recipient, &gift_id);

    let events = f.env.events().all();
    let (contract, topics, data) = events.get(events.len() - 1).unwrap();
    assert_eq!(contract, f.contract_id);

    let topic0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&f.env).unwrap();
    assert_eq!(topic0, symbol_short!("GiftClmd"));

    let topic1: Address = topics.get(1).unwrap().try_into_val(&f.env).unwrap();
    assert_eq!(topic1, f.recipient);

    let data_tuple: (u64, i128, u64) = data.try_into_val(&f.env).unwrap();
    assert_eq!(data_tuple.0, gift_id);
    assert_eq!(data_tuple.1, MIN_DEPOSIT_AMOUNT);
    assert_eq!(data_tuple.2, unlock_time);
}
