use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Gift {
    pub sender: Address,
    pub recipient: Address,
    pub amount: i128,
    pub unlock_time: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    GiftCounter,
    GiftRecord(u64),
    TokenAddress,
}
