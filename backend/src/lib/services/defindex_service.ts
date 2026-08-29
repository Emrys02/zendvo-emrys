// DeFindex Service
// Instantiates the official DeFindex server SDK and a Soroban RPC client to
// query vault parameters, estimate yield rates (APY), and build unsigned
// smart-contract invocations. Deposit/withdrawal parameter calculation still
// queries vault state over RPC so the returned XDR carries a simulated
// contract footprint.
//
// Environment variables:
// - DEFINDEX_VAULT_CONTRACT_ID: address (C...) of the DeFindex vault contract
// - DEFINDEX_API_KEY: optional API key for the DeFindex server SDK
// - DEFINDEX_API_URL: optional DeFindex API base URL
// - SOROBAN_RPC_URL: Soroban RPC endpoint (defaults to Soroban testnet)
// - STELLAR_NETWORK_PASSPHRASE: network passphrase (defaults to testnet)
import {
  DefindexSDK,
  SupportedNetworks,
  type DepositParams as DefindexSdkDepositParams,
  type VaultApyResponse,
  type VaultInfoResponse,
  type VaultTransactionResponse,
  type WithdrawParams as DefindexSdkWithdrawParams,
} from "@defindex/sdk";
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

/** Configured DeFindex SDK instance plus the Soroban RPC client it talks to. */
export interface DefindexClient {
  sdk: DefindexSDK;
  server: rpc.Server;
  rpcUrl: string;
  networkPassphrase: string;
  network: SupportedNetworks;
}

/** Estimated vault yield returned by the DeFindex SDK. */
export interface VaultApyEstimate {
  apy: number;
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
}

/** Unsigned vault invocation produced by the DeFindex SDK. */
export interface VaultInvocation {
  unsignedXdr: string;
  functionName: string;
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
}

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

export class DefindexService {
  /**
   * Resolves RPC URL, network passphrase, and DeFindex network from env.
   */
  static resolveConfig(): {
    rpcUrl: string;
    networkPassphrase: string;
    network: SupportedNetworks;
  } {
    const rpcUrl =
      process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
    const networkPassphrase =
      process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
    const network =
      networkPassphrase === Networks.PUBLIC
        ? SupportedNetworks.MAINNET
        : SupportedNetworks.TESTNET;
    return { rpcUrl, networkPassphrase, network };
  }

  /**
   * Instantiates the DeFindex server SDK and a Soroban RPC client, configured
   * with the RPC URL and network passphrase. Constructor failures (invalid
   * RPC URL, SDK init errors) are wrapped as `DefindexServiceError`.
   */
  static createClient(): DefindexClient {
    const { rpcUrl, networkPassphrase, network } = DefindexService.resolveConfig();
    try {
      const server = new rpc.Server(rpcUrl);
      const sdk = new DefindexSDK({
        apiKey: process.env.DEFINDEX_API_KEY,
        baseUrl: process.env.DEFINDEX_API_URL,
        timeout: 30_000,
        defaultNetwork: network,
      });
      return { sdk, server, rpcUrl, networkPassphrase, network };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new DefindexServiceError(
        `Failed to initialize DeFindex SDK for RPC ${rpcUrl}: ${err.message}`,
        "upstream",
        err,
      );
    }
  }

  /**
   * Creates the SDK client and verifies Soroban RPC connectivity. RPC
   * transport failures are wrapped as `kind: "upstream"` errors.
   */
  static async initialize(): Promise<DefindexClient> {
    const client = DefindexService.createClient();
    try {
      await client.server.getHealth();
    } catch (error) {
      if (error instanceof DefindexServiceError) {
        throw error;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      throw new DefindexServiceError(
        `Failed to connect to Soroban RPC at ${client.rpcUrl}: ${err.message}`,
        "upstream",
        err,
      );
    }
    return client;
  }

  /**
   * Queries vault metadata, managed funds, fees, and reported APY via the
   * DeFindex server SDK.
   */
  static async queryVaultInfo(
    vaultAddress?: string,
  ): Promise<VaultInfoResponse> {
    const contractId = vaultAddress || DefindexService.requireVaultContractId();
    const client = await DefindexService.initialize();
    try {
      return await client.sdk.getVaultInfo(contractId, client.network);
    } catch (error) {
      throw DefindexService.wrapSdkError(
        `Failed to query vault info for ${contractId}`,
        error,
      );
    }
  }

  /**
   * Estimates the vault's current yield rate (APY) via the DeFindex SDK.
   */
  static async estimateApy(vaultAddress?: string): Promise<VaultApyEstimate> {
    const contractId = vaultAddress || DefindexService.requireVaultContractId();
    const client = await DefindexService.initialize();
    try {
      const apy: VaultApyResponse = await client.sdk.getVaultAPY(
        contractId,
        client.network,
      );
      return {
        apy: apy.apy,
        contractId,
        networkPassphrase: client.networkPassphrase,
        rpcUrl: client.rpcUrl,
      };
    } catch (error) {
      throw DefindexService.wrapSdkError(
        `Failed to estimate APY for vault ${contractId}`,
        error,
      );
    }
  }

  /**
   * Builds an unsigned deposit invocation through the DeFindex SDK.
   *
   * @param userAddress Stellar G... address that signs the deposit.
   * @param amounts Per-asset deposit amounts in smallest units.
   */
  static async buildDepositInvocation(
    userAddress: string,
    amounts: string[],
    options: { invest?: boolean; slippageBps?: number; vaultAddress?: string } = {},
  ): Promise<VaultInvocation> {
    DefindexService.requireUserAddress(userAddress);
    const parsedAmounts = DefindexService.parsePositiveAmounts(
      amounts,
      "deposit",
    );
    const contractId =
      options.vaultAddress || DefindexService.requireVaultContractId();
    const client = await DefindexService.initialize();

    const depositData: DefindexSdkDepositParams = {
      caller: userAddress,
      amounts: parsedAmounts,
      invest: options.invest ?? true,
      slippageBps: options.slippageBps,
    };

    try {
      const response: VaultTransactionResponse = await client.sdk.depositToVault(
        contractId,
        depositData,
        client.network,
      );
      return DefindexService.toVaultInvocation(
        response,
        "deposit",
        contractId,
        client,
      );
    } catch (error) {
      throw DefindexService.wrapSdkError(
        `Failed to build DeFindex deposit invocation for ${userAddress}`,
        error,
      );
    }
  }

  /**
   * Builds an unsigned withdraw invocation through the DeFindex SDK.
   *
   * @param userAddress Stellar G... address that owns the vault shares.
   * @param amounts Per-asset withdrawal amounts in smallest units.
   */
  static async buildWithdrawInvocation(
    userAddress: string,
    amounts: string[],
    options: { slippageBps?: number; vaultAddress?: string } = {},
  ): Promise<VaultInvocation> {
    DefindexService.requireUserAddress(userAddress);
    const parsedAmounts = DefindexService.parsePositiveAmounts(
      amounts,
      "withdrawal",
    );
    const contractId =
      options.vaultAddress || DefindexService.requireVaultContractId();
    const client = await DefindexService.initialize();

    const withdrawData: DefindexSdkWithdrawParams = {
      caller: userAddress,
      amounts: parsedAmounts,
      slippageBps: options.slippageBps,
    };

    try {
      const response: VaultTransactionResponse =
        await client.sdk.withdrawFromVault(
          contractId,
          withdrawData,
          client.network,
        );
      return DefindexService.toVaultInvocation(
        response,
        "withdraw",
        contractId,
        client,
      );
    } catch (error) {
      throw DefindexService.wrapSdkError(
        `Failed to build DeFindex withdraw invocation for ${userAddress}`,
        error,
      );
    }
  }

  private static requireUserAddress(userAddress: string): void {
    if (!StrKey.isValidEd25519PublicKey(userAddress)) {
      throw new DefindexServiceError(
        `Invalid user address "${userAddress}": expected a valid Stellar G... public key`,
        "validation",
      );
    }
  }

  private static requireVaultContractId(): string {
    const contractId = process.env.DEFINDEX_VAULT_CONTRACT_ID;
    if (!contractId || !StrKey.isValidContract(contractId)) {
      throw new DefindexServiceError(
        "DEFINDEX_VAULT_CONTRACT_ID is not configured: expected a valid Stellar C... contract address",
        "configuration",
      );
    }
    return contractId;
  }

  private static parsePositiveAmounts(
    amounts: string[],
    kind: "deposit" | "withdrawal",
  ): number[] {
    if (!Array.isArray(amounts) || amounts.length === 0) {
      throw new DefindexServiceError(
        `Invalid ${kind} amounts: expected a non-empty array of positive integers in smallest units`,
        "validation",
      );
    }
    return amounts.map((amount) => {
      let amountN: bigint;
      try {
        amountN = BigInt(amount);
      } catch {
        throw new DefindexServiceError(
          `Invalid ${kind} amount "${amount}": must be a positive integer in smallest units`,
          "validation",
        );
      }
      if (amountN <= 0n) {
        throw new DefindexServiceError(
          `Invalid ${kind} amount "${amount}": must be greater than zero`,
          "validation",
        );
      }
      const asNumber = Number(amountN);
      if (!Number.isSafeInteger(asNumber)) {
        throw new DefindexServiceError(
          `Invalid ${kind} amount "${amount}": exceeds JavaScript safe integer range required by the DeFindex SDK`,
          "validation",
        );
      }
      return asNumber;
    });
  }

  private static toVaultInvocation(
    response: VaultTransactionResponse,
    fallbackFunctionName: string,
    contractId: string,
    client: DefindexClient,
  ): VaultInvocation {
    if (!response.xdr) {
      throw new DefindexServiceError(
        `DeFindex SDK returned no transaction XDR for ${fallbackFunctionName} on vault ${contractId}`,
        "upstream",
      );
    }
    return {
      unsignedXdr: response.xdr,
      functionName: response.functionName || fallbackFunctionName,
      contractId,
      networkPassphrase: client.networkPassphrase,
      rpcUrl: client.rpcUrl,
    };
  }

  private static wrapSdkError(prefix: string, error: unknown): DefindexServiceError {
    if (error instanceof DefindexServiceError) {
      return error;
    }
    const err = error instanceof Error ? error : new Error(String(error));
    return new DefindexServiceError(`${prefix}: ${err.message}`, "upstream", err);
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
    DefindexService.requireUserAddress(userAddress);

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

    const contractId = DefindexService.requireVaultContractId();
    const { server, rpcUrl, networkPassphrase } = DefindexService.createClient();

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
    DefindexService.requireUserAddress(userAddress);

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

    const contractId = DefindexService.requireVaultContractId();
    const { server, rpcUrl, networkPassphrase } = DefindexService.createClient();

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
