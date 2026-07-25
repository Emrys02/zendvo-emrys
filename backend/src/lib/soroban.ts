import { Address, Contract, Networks } from "@stellar/stellar-sdk";

export interface SorobanTxResult {
  contractId?: string;
  txHash?: string;
  unsignedXdr?: string;
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

export function buildSorobanRedeemTx(options: {
  contractId?: string;
  giftId: string | number;
  recipientAddress?: string;
  networkPassphrase?: string;
}): SorobanTxResult {
  const { contractId = process.env.SOROBAN_GIFT_CONTRACT_ID || "CC_DEFAULT_GIFT_CONTRACT", giftId, recipientAddress } = options;

  try {
    const numericId = typeof giftId === "string" ? parseInt(giftId, 10) : giftId;

    if (contractId && recipientAddress) {
      const contract = new Contract(contractId);
      const operation = contract.call(
        "redeem_gift",
        Address.fromString(recipientAddress).toScVal()
      );
      return {
        contractId,
        txHash: `tx_soroban_${numericId || giftId}_${Date.now()}`,
        unsignedXdr: "AAAA...",
      };
    }
  } catch (error) {
    console.warn("[SOROBAN_HELPER] Soroban contract builder warning:", error);
  }

  return {
    contractId,
    txHash: `tx_soroban_${giftId}_${Date.now()}`,
  };
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
  } = options;

  if (!senderAddress) {
    throw new SorobanTxError(
      "senderAddress is required to build cancel_gift transaction",
      contractId,
    );
  }

  const numericId = typeof giftId === "string" ? parseInt(giftId, 10) : giftId;

  if (isNaN(numericId)) {
    throw new SorobanTxError(
      `Invalid giftId: ${giftId}`,
      contractId,
    );
  }

  try {
    const contract = new Contract(contractId);
    const operation = contract.call(
      "cancel_gift",
      Address.fromString(senderAddress).toScVal(),
    );
    return {
      contractId,
      txHash: `tx_soroban_cancel_${numericId}_${Date.now()}`,
      unsignedXdr: "AAAA...",
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
