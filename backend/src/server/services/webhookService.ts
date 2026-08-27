import { db } from "@/lib/db";
import {
  transactions,
  wallets,
  notifications,
  webhookRetryQueue,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * SEP-24 transaction status values as defined in the specification.
 * These map to internal transaction statuses in the database.
 */
export type Sep24TransactionStatus =
  | "incomplete"
  | "pending_user_transfer_start"
  | "pending_user_transfer_complete"
  | "pending_anchor"
  | "pending_trust"
  | "pending_stellar"
  | "pending_external"
  | "no_market"
  | "too_small"
  | "too_large"
  | "created"
  | "completed"
  | "refunded"
  | "expired"
  | "error";

/**
 * SEP-24 transaction types from the anchor callback.
 */
export type Sep24TransactionKind = "deposit" | "withdrawal";

/**
 * The shape of a SEP-24 transaction callback payload.
 * See: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md
 */
export interface Sep24TransactionPayload {
  id: string;
  kind: Sep24TransactionKind;
  status: Sep24TransactionStatus;
  status_eta?: number;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  asset_code: string;
  account?: string;
  memo?: string;
  memo_type?: string;
  stellar_account_id?: string;
  claimable_balance_id?: string;
  started_at?: string;
  completed_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * Maps SEP-24 anchor statuses to internal transaction statuses.
 */
function mapSep24StatusToInternal(
  status: Sep24TransactionStatus,
): "pending" | "submitted" | "completed" | "failed" {
  switch (status) {
    case "completed":
      return "completed";
    case "refunded":
    case "expired":
    case "error":
    case "no_market":
    case "too_small":
    case "too_large":
      return "failed";
    default:
      return "submitted";
  }
}

/**
 * Creates a user-friendly notification message based on the SEP-24 event.
 */
function buildNotification(
  kind: Sep24TransactionKind,
  status: Sep24TransactionStatus,
  assetCode: string,
  amount?: string,
): { title: string; message: string } {
  const amountStr = amount ? ` of ${amount} ${assetCode}` : "";
  const kindLabel = kind === "deposit" ? "Deposit" : "Withdrawal";

  switch (status) {
    case "completed":
      return {
        title: `${kindLabel} completed`,
        message: `Your ${kind.toLowerCase()}${amountStr} has been completed successfully.`,
      };
    case "pending_user_transfer_start":
      return {
        title: `${kindLabel} awaiting transfer`,
        message: `Your ${kind.toLowerCase()}${amountStr} is ready. Please complete the transfer.`,
      };
    case "pending_user_transfer_complete":
      return {
        title: `${kindLabel} ready for pickup`,
        message: `Your ${kind.toLowerCase()}${amountStr} is ready for pickup.`,
      };
    case "refunded":
      return {
        title: `${kindLabel} refunded`,
        message: `Your ${kind.toLowerCase()}${amountStr} has been refunded.`,
      };
    case "expired":
      return {
        title: `${kindLabel} expired`,
        message: `Your ${kind.toLowerCase()}${amountStr} has expired.`,
      };
    case "error":
      return {
        title: `${kindLabel} failed`,
        message: `Your ${kind.toLowerCase()}${amountStr} encountered an error. Please try again.`,
      };
    default:
      return {
        title: `${kindLabel} status update`,
        message: `Your ${kind.toLowerCase()}${amountStr} status has been updated to: ${status}.`,
      };
  }
}

/**
 * Finds the internal transaction by matching the SEP-24 transaction ID
 * stored in the reference field.
 */
async function findTransactionByAnchorId(anchorTxId: string) {
  const result = await db
    .select()
    .from(transactions)
    .where(eq(transactions.reference, anchorTxId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Processes a SEP-24 webhook callback and updates internal state.
 *
 * Steps:
 * 1. Find the matching internal transaction by anchor transaction ID
 * 2. Update the transaction status
 * 3. Update the wallet balance for completed deposits
 * 4. Create a notification for the user
 */
export async function processSep24Webhook(
  payload: Sep24TransactionPayload,
): Promise<{ processed: boolean; error?: string }> {
  const { id: anchorTxId, kind, status, amount_in, asset_code } = payload;

  if (!anchorTxId) {
    return { processed: false, error: "Missing transaction id in payload" };
  }

  if (!kind || (kind !== "deposit" && kind !== "withdrawal")) {
    return {
      processed: false,
      error: `Invalid transaction kind: ${kind}`,
    };
  }

  if (!status) {
    return { processed: false, error: "Missing transaction status in payload" };
  }

  // Find the internal transaction
  const internalTx = await findTransactionByAnchorId(anchorTxId);

  if (!internalTx) {
    // Transaction not found — may be from an anchor we don't track.
    // Still return success to acknowledge receipt (avoid anchor retries).
    console.warn(
      `[SEP24_WEBHOOK] Unknown anchor transaction: ${anchorTxId}`,
    );
    return { processed: true };
  }

  const newStatus = mapSep24StatusToInternal(status);

  // Update the transaction status
  await db
    .update(transactions)
    .set({ status: newStatus })
    .where(eq(transactions.id, internalTx.id));

  // For completed deposits, credit the user's wallet
  if (status === "completed" && kind === "deposit" && amount_in) {
    const amount = parseFloat(amount_in);
    if (!isNaN(amount) && amount > 0) {
      await creditWallet(internalTx.userId, asset_code, amount);
    }
  }

  // For completed withdrawals, debit the user's wallet
  if (status === "completed" && kind === "withdrawal" && amount_in) {
    const amount = parseFloat(amount_in);
    if (!isNaN(amount) && amount > 0) {
      await debitWallet(internalTx.userId, asset_code, amount);
    }
  }

  // Create a notification for the user
  const { title, message } = buildNotification(kind, status, asset_code, amount_in);
  await db.insert(notifications).values({
    userId: internalTx.userId,
    type: `sep24_${kind}_${status}`,
    title,
    message,
  });

  return { processed: true };
}

/**
 * Credits a user's wallet with the specified amount of an asset.
 */
async function creditWallet(
  userId: string,
  currency: string,
  amount: number,
): Promise<void> {
  const existingWallet = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.currency, currency)))
    .limit(1);

  if (existingWallet.length > 0) {
    const current = existingWallet[0];
    await db
      .update(wallets)
      .set({
        balance: (Number(current.balance) || 0) + amount,
        updatedAt: new Date(),
      })
      .where(eq(wallets.id, current.id));
  } else {
    await db.insert(wallets).values({
      userId,
      currency,
      balance: amount,
    });
  }
}

/**
 * Debits a user's wallet for the specified amount of an asset.
 */
async function debitWallet(
  userId: string,
  currency: string,
  amount: number,
): Promise<void> {
  const existingWallet = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.currency, currency)))
    .limit(1);

  if (existingWallet.length > 0) {
    const current = existingWallet[0];
    const newBalance = (Number(current.balance) || 0) - amount;
    await db
      .update(wallets)
      .set({
        balance: newBalance,
        updatedAt: new Date(),
      })
      .where(eq(wallets.id, current.id));
  }
  // If wallet doesn't exist, the debit is a no-op (insufficient funds scenario
  // should be handled upstream)
}

/**
 * Enqueues a failed webhook event for retry.
 */
export async function enqueueWebhookRetry(
  eventType: string,
  payload: Record<string, unknown>,
  lastError: string,
): Promise<void> {
  await db.insert(webhookRetryQueue).values({
    eventType,
    payload,
    retryCount: 0,
    maxRetries: 5,
    nextAttemptAt: new Date(Date.now() + 60_000), // retry in 1 minute
    lastError,
  });
}
