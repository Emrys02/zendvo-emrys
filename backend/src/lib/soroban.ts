import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import crypto from "crypto";

export interface SorobanTxResult {
  contractId: string;
  txHash: string;
  unsignedXdr: string;
}

export class SorobanTxError extends Error {
  constructor(
    message: string,
    public readonly contractId?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "SorobanTxError";
  }
}

/**
 * Resolves a given string to a valid Stellar Ed25519 Public Key.
 * If the input is already a valid Stellar G... address or C... contract address, returns it as-is.
 * Otherwise, deterministically derives a valid Stellar G... public key from the input string (e.g. user UUID).
 */
export function resolveStellarAddress(addressOrId?: string): string {
  if (!addressOrId) {
    return Keypair.random().publicKey();
  }

  if (
    StrKey.isValidEd25519PublicKey(addressOrId) ||
    StrKey.isValidContract(addressOrId)
  ) {
    return addressOrId;
  }

  // Derive a valid 32-byte seed from the user UUID or input string using SHA-256
  const hash = crypto.createHash("sha256").update(addressOrId).digest();
  const keypair = Keypair.fromRawEd25519Seed(hash);
  return keypair.publicKey();
}

export function buildSorobanRedeemTx(options: {
  contractId?: string;
  giftId: string | number;
  recipientAddress?: string;
  networkPassphrase?: string;
}): SorobanTxResult {
  const {
    contractId = process.env.SOROBAN_GIFT_CONTRACT_ID || "CC_DEFAULT_GIFT_CONTRACT",
    giftId,
    recipientAddress,
    networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET,
  } = options;

  if (!giftId) {
    throw new SorobanTxError("giftId is required to build redeem transaction", contractId);
  }

  const numericId = typeof giftId === "string" ? parseInt(giftId, 10) : giftId;
  const validGiftId = isNaN(numericId) ? 1 : numericId;

  // Resolve recipientAddress to a valid Stellar G... address
  const stellarRecipient = resolveStellarAddress(recipientAddress);

  // Resolve contract address (ensure it's a valid Stellar contract or G... address for Contract class)
  const validContractId =
    StrKey.isValidContract(contractId) || StrKey.isValidEd25519PublicKey(contractId)
      ? contractId
      : resolveStellarAddress(contractId);

  try {
    const contract = new Contract(validContractId);

    // Call redeem_gift with recipient Address and gift ID (u64)
    const callOp = contract.call(
      "redeem_gift",
      Address.fromString(stellarRecipient).toScVal(),
      nativeToScVal(validGiftId, { type: "u64" })
    );

    // Source account for transaction envelope
    const sourceAccount = new Account(stellarRecipient, "0");

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase,
    })
      .addOperation(callOp)
      .setTimeout(30)
      .build();

    const unsignedXdr = tx.toXDR();
    const txHash = tx.hash().toString("hex");

    return {
      contractId: validContractId,
      txHash,
      unsignedXdr,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new SorobanTxError(
      `Failed to build Soroban redeem transaction for gift ${giftId}: ${err.message}`,
      contractId,
      err,
    );
  }
}

export function buildSorobanCancelGiftTx(options: {
  contractId?: string;
  giftId: string | number;
  senderAddress: string;
  networkPassphrase?: string;
}): SorobanTxResult {
  const {
    contractId = process.env.SOROBAN_GIFT_CONTRACT_ID || "CC_DEFAULT_GIFT_CONTRACT",
    giftId,
    senderAddress,
    networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET,
  } = options;

  if (!senderAddress) {
    throw new SorobanTxError(
      "senderAddress is required to build cancel_gift transaction",
      contractId,
    );
  }

  const numericId = typeof giftId === "string" ? parseInt(giftId, 10) : giftId;
  const validGiftId = isNaN(numericId) ? 1 : numericId;

  const stellarSender = resolveStellarAddress(senderAddress);
  const validContractId =
    StrKey.isValidContract(contractId) || StrKey.isValidEd25519PublicKey(contractId)
      ? contractId
      : resolveStellarAddress(contractId);

  try {
    const contract = new Contract(validContractId);
    const callOp = contract.call(
      "cancel_gift",
      Address.fromString(stellarSender).toScVal(),
      nativeToScVal(validGiftId, { type: "u64" })
    );

    const sourceAccount = new Account(stellarSender, "0");
    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase,
    })
      .addOperation(callOp)
      .setTimeout(30)
      .build();

    return {
      contractId: validContractId,
      txHash: tx.hash().toString("hex"),
      unsignedXdr: tx.toXDR(),
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new SorobanTxError(
      `Failed to build cancel_gift transaction for gift ${giftId}: ${err.message}`,
      contractId,
      err,
    );
  }
}
