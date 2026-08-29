// DeFindex Service
// Interfaces with a DeFindex vault contract on Stellar/Soroban to calculate
// withdrawal parameters (shares to burn, expected USDC assets, and the
// necessary Soroban contract footprint) and to build the unsigned
// withdrawal transaction XDR.
//
// Environment variables:
// - DEFINDEX_VAULT_CONTRACT_ID: address (C...) of the DeFindex vault contract
// - SOROBAN_RPC_URL: Soroban RPC endpoint (defaults to Soroban testnet)
// - STELLAR_NETWORK_PASSPHRASE: network passphrase (defaults to testnet)
import {
  Account,
  Address,
  Contract,
  Networks,
  rpc,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

/** Details about the yield / APY estimate for a vault position. */
export interface APYInfo {
  /**
   * Annualized yield rate as a float (e.g. 0.0825 for 8.25%),
   * or `null` if insufficient historical data exists to calculate a meaningful APY.
   */
  rate: number | null;
  /** Formatted APY percentage string (e.g. "8.25%" or "N/A"). */
  formatted: string;
  /** True if this APY is an estimate calculated from historical share price changes. */
  isEstimated: boolean;
  /** Description of the methodology used to derive or evaluate the APY. */
  methodology: string;
  /** Optional realized yield in USDC over the elapsed period if calculated against a user deposit. */
  realizedYieldUsdc?: string | null;
}

/** Historical share price snapshot used to calculate realized yield / APY. */
export interface HistoricalSharePriceSnapshot {
  /** Timestamp in seconds (Unix epoch), ISO date string, or Date of historical snapshot. */
  timestamp: number | string | Date;
  /** Historical share price (scaled by 10^7, as a string or bigint). */
  sharePrice: string | bigint;
}

/** Options for querying a vault position / balance. */
export interface GetVaultBalanceOptions {
  /** Override default vault contract ID. */
  vaultContractId?: string;
  /** Override default RPC URL. */
  rpcUrl?: string;
  /** Override default network passphrase. */
  networkPassphrase?: string;
  /** Bypass in-memory cache and perform a fresh RPC query. */
  skipCache?: boolean;
  /** Cache TTL in milliseconds for this request (default: 10,000ms / 10s). */
  ttlMs?: number;
  /** Historical share price snapshot for APY calculation. */
  historicalSnapshot?: HistoricalSharePriceSnapshot;
}

/** Results of a DeFindex vault balance / position query. */
export interface VaultBalance {
  /** Stellar address of the user. */
  userAddress: string;
  /** DeFindex vault contract ID. */
  contractId: string;
  /** User's raw vault share balance in smallest units (i128, 7 decimals). */
  rawUserBalance: string;
  /** User's normalized vault share balance (decimal string, e.g. "5000.0000000"). */
  userBalance: string;
  /** Current share price scaled by 10^7 (matches USDC / share precision). */
  rawSharePrice: string;
  /** Current share price normalized (decimal string, e.g. "1.0000000"). */
  sharePrice: string;
  /** User's underlying USDC-equivalent position in smallest units (i128, 7 decimals). */
  rawUnderlyingUsdc: string;
  /** User's underlying USDC-equivalent position normalized (decimal string, e.g. "500.0000000"). */
  underlyingUsdc: string;
  /** Total vault share supply in smallest units (i128). */
  rawTotalSupply: string;
  /** Total USDC managed by the vault in smallest units (i128). */
  rawTotalManagedFunds: string;
  /** Soroban RPC endpoint used. */
  rpcUrl: string;
  /** Yield / APY estimation details. */
  apy: APYInfo;
  /** ISO timestamp when the position was fetched. */
  fetchedAt: string;
}

/** Alias for VaultBalance for callers using position terminology. */
export type VaultPosition = VaultBalance;

/** Results of a DeFindex deposit parameter calculation. */
export interface DepositParams {
  userAddress: string;
  amount: string;
  estimatedShares: string;
  sharePrice: string;
  userBalance: string;
  totalManagedFunds: string;
  totalSupply: string;
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
  unsignedXdr: string;
  txHash: string;
}

/** Results of a DeFindex withdrawal parameter calculation. */
export interface WithdrawalParams {
  /** Stellar address that owns the vault shares and signs the withdrawal. */
  userAddress: string;
  /** Requested USDC amount to withdraw, in smallest units (i128). */
  amount: string;
  /** Number of vault shares to burn to satisfy the requested amount. */
  sharesToBurn: string;
  /** Expected USDC assets received for the burned shares (same units as amount). */
  expectedAssets: string;
  /**
   * Per-asset minimum amounts passed to the vault `withdraw` invocation.
   * One entry per vault asset; index 0 is the primary (USDC) asset.
   */
  minAmountsOut: string[];
  /**
   * Current share price: total managed USDC divided by total share supply,
   * scaled by 10^7 (matches USDC / vault-share decimals).
   */
  sharePrice: string;
  /** User's vault share balance, in smallest share units (i128). */
  userBalance: string;
  /** Total USDC managed by the vault (idle + invested), smallest units. */
  totalManagedFunds: string;
  /** Total vault share supply, smallest share units. */
  totalSupply: string;
  /** Address of the DeFindex vault contract. */
  contractId: string;
  /** Network passphrase the unsigned XDR is bound to. */
  networkPassphrase: string;
  /** Soroban RPC endpoint used for the contract state queries. */
  rpcUrl: string;
  /** Base64-encoded unsigned withdrawal transaction XDR. */
  unsignedXdr: string;
  /** SHA-256 hash of the unsigned transaction envelope (hex). */
  txHash: string;
}

/** Classifies the source of a DeFindex error for API error mapping. */
export type DefindexServiceErrorKind =
  | "validation"
  | "configuration"
  | "upstream";

export class DefindexServiceError extends Error {
  constructor(
    message: string,
    public readonly kind: DefindexServiceErrorKind = "validation",
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "DefindexServiceError";
  }
}

/**
 * Formats a raw integer bigint into a decimal string without floating point loss.
 * E.g., formatUnits(12345678n, 7) => "1.2345678"
 */
export function formatUnits(value: bigint, decimals: number = 7): string {
  const isNegative = value < 0n;
  const abs = isNegative ? -value : value;
  const str = abs.toString().padStart(decimals + 1, "0");
  const integerPart = str.slice(0, str.length - decimals);
  const fractionalPart = str.slice(str.length - decimals);
  return `${isNegative ? "-" : ""}${integerPart}.${fractionalPart}`;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class DefindexCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private pendingPromises = new Map<string, Promise<unknown>>();
  private defaultTtlMs = 10_000;

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
    });
  }

  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    skipCache: boolean = false,
    ttlMs?: number,
  ): Promise<T> {
    if (!skipCache) {
      const cached = this.get<T>(key);
      if (cached !== undefined) {
        return cached;
      }
      const pending = this.pendingPromises.get(key);
      if (pending) {
        return pending as Promise<T>;
      }
    }

    const promise = (async () => {
      try {
        const data = await fetcher();
        if (!skipCache) {
          this.set(key, data, ttlMs);
        }
        return data;
      } finally {
        this.pendingPromises.delete(key);
      }
    })();

    this.pendingPromises.set(key, promise);
    return promise;
  }

  clear(): void {
    this.cache.clear();
    this.pendingPromises.clear();
  }
}

const defindexCacheSingleton = new DefindexCache();

export class DefindexService {
  /**
   * Queries a user's DeFindex vault position on Soroban, including user share balance,
   * share price, underlying USDC balance, and APY/yield estimate.
   *
   * Utilizes a short-lived in-memory cache to deduplicate repeated RPC calls.
   *
   * @param userAddress Stellar G... public key of the user.
   * @param vaultContractId Optional contract address (defaults to DEFINDEX_VAULT_CONTRACT_ID env var).
   * @param options Additional query options (caching, RPC URL, historical snapshot for APY).
   */
  static async getVaultBalance(
    userAddress: string,
    vaultContractId?: string,
    options?: GetVaultBalanceOptions,
  ): Promise<VaultBalance> {
    const contractId =
      vaultContractId || options?.vaultContractId || process.env.DEFINDEX_VAULT_CONTRACT_ID;
    const rpcUrl =
      options?.rpcUrl || process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
    const networkPassphrase =
      options?.networkPassphrase || process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

    if (!StrKey.isValidEd25519PublicKey(userAddress)) {
      throw new DefindexServiceError(
        `Invalid user address "${userAddress}": expected a valid Stellar G... public key`,
        "validation",
      );
    }

    if (!contractId || !StrKey.isValidContract(contractId)) {
      throw new DefindexServiceError(
        "DEFINDEX_VAULT_CONTRACT_ID is not configured: expected a valid Stellar C... contract address",
        "configuration",
      );
    }

    const cacheKey = `${contractId}:${userAddress}`;

    return defindexCacheSingleton.getOrFetch(
      cacheKey,
      async () => {
        const server = new rpc.Server(rpcUrl);

        try {
          const userAddressScVal = Address.fromString(userAddress).toScVal();

          const userBalanceRaw = BigInt(
            scValToNative(
              await DefindexService.queryVault(
                server,
                contractId,
                "balance_of",
                [userAddressScVal],
                userAddress,
                networkPassphrase,
              ),
            ) as bigint,
          );

          const totalSupplyRaw = BigInt(
            scValToNative(
              await DefindexService.queryVault(
                server,
                contractId,
                "total_supply",
                [],
                userAddress,
                networkPassphrase,
              ),
            ) as bigint,
          );

          const managedFunds = scValToNative(
            await DefindexService.queryVault(
              server,
              contractId,
              "fetch_total_managed_funds",
              [],
              userAddress,
              networkPassphrase,
            ),
          ) as Array<{
            asset: string;
            total_amount: bigint;
            idle_amount: bigint;
            invested_amount: bigint;
            strategy_allocations: unknown[];
          }>;

          if (managedFunds.length === 0) {
            throw new DefindexServiceError(
              `Vault ${contractId} reports no managed assets; cannot calculate vault balance`,
              "upstream",
            );
          }

          const totalManagedFundsRaw = managedFunds.reduce(
            (sum, asset) => sum + BigInt(asset.total_amount),
            0n,
          );

          if (totalSupplyRaw <= 0n && totalManagedFundsRaw > 0n) {
            throw new DefindexServiceError(
              `Vault ${contractId} manages ${totalManagedFundsRaw} units but has no shares in circulation; cannot calculate position`,
              "upstream",
            );
          }

          if (totalManagedFundsRaw <= 0n && totalSupplyRaw > 0n) {
            throw new DefindexServiceError(
              `Vault ${contractId} has shares in circulation but manages no USDC funds; cannot calculate position`,
              "upstream",
            );
          }

          let sharePriceRaw: bigint;
          let underlyingUsdcRaw: bigint;

          if (totalSupplyRaw <= 0n) {
            sharePriceRaw = 10n ** 7n;
            underlyingUsdcRaw = userBalanceRaw;
          } else {
            sharePriceRaw = (totalManagedFundsRaw * 10n ** 7n) / totalSupplyRaw;
            underlyingUsdcRaw = (userBalanceRaw * totalManagedFundsRaw) / totalSupplyRaw;
          }

          let apy: APYInfo = {
            rate: null,
            formatted: "N/A",
            isEstimated: false,
            methodology:
              "Historical vault performance data is insufficient or unavailable to calculate a meaningful APY.",
          };

          if (options?.historicalSnapshot) {
            const snap = options.historicalSnapshot;
            const pastTime =
              typeof snap.timestamp === "number"
                ? snap.timestamp
                : snap.timestamp instanceof Date
                ? Math.floor(snap.timestamp.getTime() / 1000)
                : Math.floor(new Date(snap.timestamp).getTime() / 1000);
            const currentTime = Math.floor(Date.now() / 1000);
            const elapsedSeconds = currentTime - pastTime;

            const pastSharePriceRaw = BigInt(snap.sharePrice);

            if (
              elapsedSeconds >= 3600 &&
              pastSharePriceRaw > 0n &&
              sharePriceRaw >= pastSharePriceRaw
            ) {
              const ratio = Number(sharePriceRaw) / Number(pastSharePriceRaw);
              const years = elapsedSeconds / (365.25 * 86400);
              const annualizedRate = Math.pow(ratio, 1 / years) - 1;

              if (Number.isFinite(annualizedRate) && annualizedRate >= 0) {
                const percentageStr = (annualizedRate * 100).toFixed(2) + "%";
                apy = {
                  rate: annualizedRate,
                  formatted: percentageStr,
                  isEstimated: true,
                  methodology: `Annualized return derived from historical share price increase over ${Math.round(
                    elapsedSeconds / 3600,
                  )} hours.`,
                };
              }
            }
          }

          return {
            userAddress,
            contractId,
            rawUserBalance: userBalanceRaw.toString(),
            userBalance: formatUnits(userBalanceRaw, 7),
            rawSharePrice: sharePriceRaw.toString(),
            sharePrice: formatUnits(sharePriceRaw, 7),
            rawUnderlyingUsdc: underlyingUsdcRaw.toString(),
            underlyingUsdc: formatUnits(underlyingUsdcRaw, 7),
            rawTotalSupply: totalSupplyRaw.toString(),
            rawTotalManagedFunds: totalManagedFundsRaw.toString(),
            rpcUrl,
            apy,
            fetchedAt: new Date().toISOString(),
          };
        } catch (error) {
          if (error instanceof DefindexServiceError) {
            throw error;
          }
          const err = error instanceof Error ? error : new Error(String(error));
          throw new DefindexServiceError(
            `Failed to query DeFindex vault balance for ${userAddress}: ${err.message}`,
            "upstream",
            err,
          );
        }
      },
      options?.skipCache,
      options?.ttlMs,
    );
  }

  /** Alias for getVaultBalance for callers using position terminology. */
  static async getVaultPosition(
    userAddress: string,
    vaultContractId?: string,
    options?: GetVaultBalanceOptions,
  ): Promise<VaultBalance> {
    return DefindexService.getVaultBalance(userAddress, vaultContractId, options);
  }

  /** Clears the internal RPC response cache (useful for testing and manual invalidation). */
  static clearCache(): void {
    defindexCacheSingleton.clear();
  }
  /**
   * Calculates the Soroban parameters required to withdraw `amount` of USDC
   * from the DeFindex vault on behalf of `userAddress` and returns an
   * unsigned withdrawal transaction XDR.
   *
   * It queries the vault contract through Soroban RPC for:
   * - the user's vault share balance (`balance_of`)
   * - the total vault share supply (`total_supply`)
   * - the total managed USDC funds (`fetch_total_managed_funds`)
   *
   * and uses those values to derive the share price, the shares to burn
   * (rounded up so the user receives at least `amount`), the expected USDC
   * payout, and the per-asset minimum amounts. The unsigned transaction is
   * simulated against the RPC so the returned XDR carries the necessary
   * Soroban contract footprint, resource estimates, and (unsigned)
   * authorization entries the user's wallet must sign before submission.
   *
   * @param userAddress Stellar G... address that owns the vault shares.
   * @param amount USDC amount to withdraw, in smallest units (i128, 7 decimals).
   */
  static async calculateWithdrawalParams(
    userAddress: string,
    amount: string,
  ): Promise<WithdrawalParams> {
    const contractId = process.env.DEFINDEX_VAULT_CONTRACT_ID;
    const rpcUrl =
      process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
    const networkPassphrase =
      process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

    // ── Input validation ───────────────────────────────────────────────────
    if (!StrKey.isValidEd25519PublicKey(userAddress)) {
      throw new DefindexServiceError(
        `Invalid user address "${userAddress}": expected a valid Stellar G... public key`,
        "validation",
      );
    }

    let amountN: bigint;
    try {
      amountN = BigInt(amount);
    } catch {
      throw new DefindexServiceError(
        `Invalid withdrawal amount "${amount}": must be a positive integer in smallest units`,
        "validation",
      );
    }
    if (amountN <= 0n) {
      throw new DefindexServiceError(
        `Invalid withdrawal amount "${amount}": must be greater than zero`,
        "validation",
      );
    }

    if (!contractId || !StrKey.isValidContract(contractId)) {
      throw new DefindexServiceError(
        "DEFINDEX_VAULT_CONTRACT_ID is not configured: expected a valid Stellar C... contract address",
        "configuration",
      );
    }

    const server = new rpc.Server(rpcUrl);

    try {
      // ── Query vault state via Soroban RPC ────────────────────────────────
      const userAddressScVal = Address.fromString(userAddress).toScVal();

      const userBalance = BigInt(
        scValToNative(
          await DefindexService.queryVault(
            server,
            contractId,
            "balance_of",
            [userAddressScVal],
            userAddress,
            networkPassphrase,
          ),
        ) as bigint,
      );

      const totalSupply = BigInt(
        scValToNative(
          await DefindexService.queryVault(
            server,
            contractId,
            "total_supply",
            [],
            userAddress,
            networkPassphrase,
          ),
        ) as bigint,
      );

      const managedFunds = scValToNative(
        await DefindexService.queryVault(
          server,
          contractId,
          "fetch_total_managed_funds",
          [],
          userAddress,
          networkPassphrase,
        ),
      ) as Array<{
        asset: string;
        total_amount: bigint;
        idle_amount: bigint;
        invested_amount: bigint;
        strategy_allocations: unknown[];
      }>;

      if (managedFunds.length === 0) {
        throw new DefindexServiceError(
          `Vault ${contractId} reports no managed assets; cannot calculate withdrawal parameters`,
          "upstream",
        );
      }

      const totalManagedFunds = managedFunds.reduce(
        (sum, asset) => sum + BigInt(asset.total_amount),
        0n,
      );

      if (totalSupply <= 0n) {
        throw new DefindexServiceError(
          `Vault ${contractId} has no shares in circulation; cannot calculate a share price`,
          "upstream",
        );
      }
      if (totalManagedFunds <= 0n) {
        throw new DefindexServiceError(
          `Vault ${contractId} manages no USDC funds; nothing to withdraw`,
          "upstream",
        );
      }

      // ── Derive withdrawal parameters ─────────────────────────────────────
      // Share price = total managed USDC / total share supply, scaled to
      // 7 decimals to match the vault share / USDC precision.
      const sharePrice = (totalManagedFunds * 10n ** 7n) / totalSupply;

      // Max USDC the user can withdraw given their share balance.
      const maxWithdrawable =
        (userBalance * totalManagedFunds) / totalSupply;
      if (amountN > maxWithdrawable) {
        throw new DefindexServiceError(
          `Insufficient vault balance: user ${userAddress} can withdraw at most ${maxWithdrawable} units but ${amountN} was requested`,
          "validation",
        );
      }

      // Round shares up so the user receives at least the requested amount.
      const sharesToBurn =
        (amountN * totalSupply + totalManagedFunds - 1n) / totalManagedFunds;

      if (sharesToBurn > userBalance) {
        throw new DefindexServiceError(
          `Insufficient vault shares: ${sharesToBurn} shares required but user holds ${userBalance}`,
          "validation",
        );
      }

      // Per-asset expected payout mirrors the vault contract's own formula:
      // asset.total_amount * shares / total_shares_supply (floor).
      const minAmountsOut = managedFunds.map((asset) =>
        ((BigInt(asset.total_amount) * sharesToBurn) / totalSupply).toString(),
      );
      const expectedAssets = minAmountsOut[0];

      // ── Build the unsigned withdrawal transaction XDR ────────────────────
      const contract = new Contract(contractId);
      const withdrawOp = contract.call(
        "withdraw",
        nativeToScVal(sharesToBurn, { type: "i128" }),
        nativeToScVal(minAmountsOut.map((min) => BigInt(min)), {
          type: "i128",
        }),
        Address.fromString(userAddress).toScVal(),
      );

      const sourceAccount = new Account(userAddress, "0");
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase,
      })
        .addOperation(withdrawOp)
        .setTimeout(30)
        .setSorobanData(new SorobanDataBuilder().build())
        .build();

      // Simulate against the RPC so the unsigned XDR carries the necessary
      // Soroban contract footprint, resource estimates, and the authorization
      // entries the user's wallet must sign. Falls back to the un-simulated
      // transaction when the RPC is unreachable.
      let finalTx = tx;
      try {
        const simulation = await server.simulateTransaction(tx);
        if (simulation && !("error" in simulation) && simulation.transactionData) {
          finalTx = rpc.assembleTransaction(tx, simulation).build();
        } else {
          const simulationError = (simulation as rpc.Api.SimulateTransactionErrorResponse)
            ?.error;
          if (simulationError) {
            throw new DefindexServiceError(
              `Withdrawal simulation failed for vault ${contractId}: ${simulationError}`,
              "upstream",
            );
          }
        }
      } catch (error) {
        if (error instanceof DefindexServiceError) {
          throw error;
        }
        // Network / transport failure: keep the base unsigned transaction.
        finalTx = tx;
      }

      return {
        userAddress,
        amount: amountN.toString(),
        sharesToBurn: sharesToBurn.toString(),
        expectedAssets,
        minAmountsOut,
        sharePrice: sharePrice.toString(),
        userBalance: userBalance.toString(),
        totalManagedFunds: totalManagedFunds.toString(),
        totalSupply: totalSupply.toString(),
        contractId,
        networkPassphrase,
        rpcUrl,
        unsignedXdr: finalTx.toXDR(),
        txHash: finalTx.hash().toString("hex"),
      };
    } catch (error) {
      if (error instanceof DefindexServiceError) {
        throw error;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      throw new DefindexServiceError(
        `Failed to calculate DeFindex withdrawal parameters for ${userAddress}: ${err.message}`,
        "upstream",
        err,
      );
    }
  }

  /**
   * Invokes a read-only vault contract method through Soroban RPC and returns
   * the decoded return value as an `xdr.ScVal`.
   */
  private static async queryVault(
    server: rpc.Server,
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    source: string,
    networkPassphrase: string,
  ): Promise<xdr.ScVal> {
    const contract = new Contract(contractId);
    const sourceAccount = new Account(source, "0");
    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    const simulationError =
      simulation && "error" in simulation
        ? (simulation as rpc.Api.SimulateTransactionErrorResponse).error
        : undefined;
    if (
      !simulation ||
      "error" in simulation ||
      !simulation.result ||
      simulation.result.retval === undefined
    ) {
      throw new DefindexServiceError(
        `Failed to query ${method} on vault ${contractId}${
          simulationError ? `: ${simulationError}` : ""
        }`,
        "upstream",
      );
    }
    return simulation.result.retval;
  }

  static async calculateDepositParams(
    userAddress: string,
    amount: string,
  ): Promise<DepositParams> {
    const contractId = process.env.DEFINDEX_VAULT_CONTRACT_ID;
    const rpcUrl =
      process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
    const networkPassphrase =
      process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

    if (!StrKey.isValidEd25519PublicKey(userAddress)) {
      throw new DefindexServiceError(
        `Invalid user address "${userAddress}": expected a valid Stellar G... public key`,
        "validation",
      );
    }

    let amountN: bigint;
    try {
      amountN = BigInt(amount);
    } catch {
      throw new DefindexServiceError(
        `Invalid deposit amount "${amount}": must be a positive integer in smallest units`,
        "validation",
      );
    }
    if (amountN <= 0n) {
      throw new DefindexServiceError(
        `Invalid deposit amount "${amount}": must be greater than zero`,
        "validation",
      );
    }

    if (!contractId || !StrKey.isValidContract(contractId)) {
      throw new DefindexServiceError(
        "DEFINDEX_VAULT_CONTRACT_ID is not configured: expected a valid Stellar C... contract address",
        "configuration",
      );
    }

    const server = new rpc.Server(rpcUrl);

    try {
      const totalSupply = BigInt(
        scValToNative(
          await DefindexService.queryVault(
            server,
            contractId,
            "total_supply",
            [],
            userAddress,
            networkPassphrase,
          ),
        ) as bigint,
      );

      const managedFunds = scValToNative(
        await DefindexService.queryVault(
          server,
          contractId,
          "fetch_total_managed_funds",
          [],
          userAddress,
          networkPassphrase,
        ),
      ) as Array<{
        asset: string;
        total_amount: bigint;
        idle_amount: bigint;
        invested_amount: bigint;
        strategy_allocations: unknown[];
      }>;

      if (managedFunds.length === 0) {
        throw new DefindexServiceError(
          `Vault ${contractId} reports no managed assets; cannot calculate deposit parameters`,
          "upstream",
        );
      }

      const totalManagedFunds = managedFunds.reduce(
        (sum, asset) => sum + BigInt(asset.total_amount),
        0n,
      );

      // A vault with no shares and no managed funds reports an inconsistent
      // state; only a genuinely new vault (both zero) uses the 1:1 fallback.
      if (totalSupply <= 0n && totalManagedFunds > 0n) {
        throw new DefindexServiceError(
          `Vault ${contractId} manages ${totalManagedFunds} units but has no shares in circulation; cannot calculate deposit parameters`,
          "upstream",
        );
      }
      if (totalManagedFunds <= 0n && totalSupply > 0n) {
        throw new DefindexServiceError(
          `Vault ${contractId} has shares in circulation but manages no USDC funds; cannot calculate deposit parameters`,
          "upstream",
        );
      }

      let sharePrice: bigint;
      let estimatedShares: bigint;

      if (totalSupply <= 0n) {
        sharePrice = 10n ** 7n;
        estimatedShares = amountN;
      } else {
        sharePrice = (totalManagedFunds * 10n ** 7n) / totalSupply;
        estimatedShares =
          (amountN * totalSupply) / totalManagedFunds;
      }

      const userBalance = BigInt(
        scValToNative(
          await DefindexService.queryVault(
            server,
            contractId,
            "balance_of",
            [Address.fromString(userAddress).toScVal()],
            userAddress,
            networkPassphrase,
          ),
        ) as bigint,
      );

      const contract = new Contract(contractId);
      const depositOp = contract.call(
        "deposit",
        nativeToScVal(amountN, { type: "i128" }),
        Address.fromString(userAddress).toScVal(),
      );

      const sourceAccount = new Account(userAddress, "0");
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase,
      })
        .addOperation(depositOp)
        .setTimeout(30)
        .setSorobanData(new SorobanDataBuilder().build())
        .build();

      let finalTx = tx;
      try {
        const simulation = await server.simulateTransaction(tx);
        if (simulation && !("error" in simulation) && simulation.transactionData) {
          finalTx = rpc.assembleTransaction(tx, simulation).build();
        } else {
          const simulationError = (simulation as rpc.Api.SimulateTransactionErrorResponse)
            ?.error;
          if (simulationError) {
            throw new DefindexServiceError(
              `Deposit simulation failed for vault ${contractId}: ${simulationError}`,
              "upstream",
            );
          }
        }
      } catch (error) {
        if (error instanceof DefindexServiceError) {
          throw error;
        }
        finalTx = tx;
      }

      return {
        userAddress,
        amount: amountN.toString(),
        estimatedShares: estimatedShares.toString(),
        sharePrice: sharePrice.toString(),
        userBalance: userBalance.toString(),
        totalManagedFunds: totalManagedFunds.toString(),
        totalSupply: totalSupply.toString(),
        contractId,
        networkPassphrase,
        rpcUrl,
        unsignedXdr: finalTx.toXDR(),
        txHash: finalTx.hash().toString("hex"),
      };
    } catch (error) {
      if (error instanceof DefindexServiceError) {
        throw error;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      throw new DefindexServiceError(
        `Failed to calculate DeFindex deposit parameters for ${userAddress}: ${err.message}`,
        "upstream",
        err,
      );
    }
  }
}
