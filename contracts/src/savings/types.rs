use soroban_sdk::{contracterror, contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserSavings {
    pub principal: i128,
    pub yield_shares: i128,
}

#[contracttype]
pub enum DataKey {
    Admin,
    UserSavings(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    Unauthorized = 1,
    Overflow = 2,
    UserNotFound = 3,
}
