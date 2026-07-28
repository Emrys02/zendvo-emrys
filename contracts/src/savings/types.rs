use soroban_sdk::{contracttype, Address};

#[contracttype]
pub enum DataKey {
    UserSavingsRecord(Address),
    TokenAddress,
    /// Stores the privileged admin `Address` set at deploy time.
    Admin,
    /// Accumulates platform fees (i128 USDC stroops) in a pool that is
    /// completely isolated from all `UserSavingsRecord` balances.
    PlatformFees,
}

#[contracttype]
pub struct UserSavings {
    pub principal: i128,
    pub yield_shares: i128,
}
