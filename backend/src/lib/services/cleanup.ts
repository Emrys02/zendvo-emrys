import { db } from "@/lib/db";
import {
  users,
  gifts,
  refreshTokens,
  emailVerifications,
  passwordResets,
  actionTokens,
  wallets,
  notifications,
  bankAccounts,
} from "@/lib/db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { buildSorobanCancelGiftTx, SorobanTxError } from "@/lib/soroban";
import {
  AuditEventType,
  logAuditEvent,
} from "@/server/services/auditService";

export interface AccountDeletionResult {
  success: boolean;
  message: string;
  giftsResolved: number;
  giftsCancelled: number;
  tokensRevoked: number;
  error?: string;
  detail?: string;
}

const UNCLAIMED_GIFT_STATUSES = [
  "pending_otp",
  "otp_verified",
  "pending_review",
  "confirmed",
] as const;

export async function deleteAccount(
  userId: string,
): Promise<AccountDeletionResult> {
  const now = new Date();

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return {
        success: false,
        message: "User not found",
        giftsResolved: 0,
        giftsCancelled: 0,
        tokensRevoked: 0,
        error: "USER_NOT_FOUND",
        detail: "USER_NOT_FOUND",
      };
    }

    if (user.status === "deleted") {
      return {
        success: false,
        message: "Account has already been deleted.",
        giftsResolved: 0,
        giftsCancelled: 0,
        tokensRevoked: 0,
        error: "ALREADY_DELETED",
        detail: "ALREADY_DELETED",
      };
    }

    if (user.status === "suspended") {
      return {
        success: false,
        message: "Cannot delete a suspended account. Please contact support.",
        giftsResolved: 0,
        giftsCancelled: 0,
        tokensRevoked: 0,
        error: "ACCOUNT_SUSPENDED",
        detail: "ACCOUNT_SUSPENDED",
      };
    }

    const unclaimedSentGifts = await db.query.gifts.findMany({
      where: and(
        eq(gifts.senderId, userId),
        or(
          ...UNCLAIMED_GIFT_STATUSES.map((status) =>
            eq(gifts.status, status)
          )
        )
      ),
    });

    const unclaimedReceivedGifts = await db.query.gifts.findMany({
      where: and(
        eq(gifts.recipientId, userId),
        or(
          ...UNCLAIMED_GIFT_STATUSES.map((status) =>
            eq(gifts.status, status)
          )
        )
      ),
    });

    const allUnclaimedGifts = [...unclaimedSentGifts, ...unclaimedReceivedGifts];

    let giftsCancelled = 0;
    const blockchainResults: Array<{
      giftId: string;
      direction: "sent" | "received";
      txHash?: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const gift of unclaimedSentGifts) {
      try {
        if (!gift.senderId) {
          await db
            .update(gifts)
            .set({ status: "failed", updatedAt: now })
            .where(eq(gifts.id, gift.id));
          giftsCancelled++;
          blockchainResults.push({
            giftId: gift.id,
            direction: "sent",
            success: true,
          });
          continue;
        }

        const sorobanResult = buildSorobanCancelGiftTx({
          giftId: gift.id,
          senderAddress: gift.senderId,
        });

        await db
          .update(gifts)
          .set({
            status: "failed",
            updatedAt: now,
            blockchainTxHash: sorobanResult.txHash || gift.blockchainTxHash,
          })
          .where(eq(gifts.id, gift.id));

        giftsCancelled++;
        blockchainResults.push({
          giftId: gift.id,
          direction: "sent",
          txHash: sorobanResult.txHash,
          success: true,
        });

        logAuditEvent({
          timestamp: now,
          eventType: AuditEventType.GIFT_CANCELLED_FOR_DELETION,
          userId,
          metadata: {
            giftId: gift.id,
            amount: gift.amount,
            currency: gift.currency,
            direction: "sent",
            blockchainTxHash: sorobanResult.txHash,
          },
          message: `Gift ${gift.id} cancelled due to account deletion (sender)`,
        });
      } catch (error) {
        console.error(
          `[ACCOUNT_DELETION] Failed to cancel sent gift ${gift.id}:`,
          error
        );
        const errorMsg = error instanceof SorobanTxError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Unknown error";
        blockchainResults.push({
          giftId: gift.id,
          direction: "sent",
          success: false,
          error: errorMsg,
        });
      }
    }

    for (const gift of unclaimedReceivedGifts) {
      try {
        if (gift.senderId) {
          const sorobanResult = buildSorobanCancelGiftTx({
            giftId: gift.id,
            senderAddress: gift.senderId,
          });

          await db
            .update(gifts)
            .set({
              status: "failed",
              updatedAt: now,
              blockchainTxHash: sorobanResult.txHash || gift.blockchainTxHash,
            })
            .where(eq(gifts.id, gift.id));

          giftsCancelled++;
          blockchainResults.push({
            giftId: gift.id,
            direction: "received",
            txHash: sorobanResult.txHash,
            success: true,
          });

          logAuditEvent({
            timestamp: now,
            eventType: AuditEventType.GIFT_CANCELLED_FOR_DELETION,
            userId,
            metadata: {
              giftId: gift.id,
              amount: gift.amount,
              currency: gift.currency,
              direction: "received",
              senderId: gift.senderId,
              blockchainTxHash: sorobanResult.txHash,
            },
            message: `Gift ${gift.id} refunded to sender due to recipient account deletion`,
          });
        } else {
          await db
            .update(gifts)
            .set({ status: "failed", updatedAt: now })
            .where(eq(gifts.id, gift.id));

          giftsCancelled++;
          blockchainResults.push({
            giftId: gift.id,
            direction: "received",
            success: true,
          });

          logAuditEvent({
            timestamp: now,
            eventType: AuditEventType.GIFT_CANCELLED_FOR_DELETION,
            userId,
            metadata: {
              giftId: gift.id,
              amount: gift.amount,
              currency: gift.currency,
              direction: "received",
              note: "No sender on record; funds burned",
            },
            message: `Gift ${gift.id} marked failed (no sender to refund)`,
          });
        }
      } catch (error) {
        console.error(
          `[ACCOUNT_DELETION] Failed to cancel received gift ${gift.id}:`,
          error
        );
        const errorMsg = error instanceof SorobanTxError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Unknown error";
        blockchainResults.push({
          giftId: gift.id,
          direction: "received",
          success: false,
          error: errorMsg,
        });
      }
    }

    const result = await db.transaction(async (tx) => {
      const revokedTokens = await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(refreshTokens.userId, userId),
            isNull(refreshTokens.revokedAt)
          )
        )
        .returning();

      await tx
        .update(actionTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(actionTokens.userId, userId),
            isNull(actionTokens.revokedAt)
          )
        );

      await tx
        .delete(emailVerifications)
        .where(eq(emailVerifications.userId, userId));

      await tx
        .delete(passwordResets)
        .where(eq(passwordResets.userId, userId));

      const anonymizedEmail = `deleted_${userId}@deleted.invalid`;

      await tx
        .update(users)
        .set({
          email: anonymizedEmail,
          passwordHash: "DELETED",
          name: "Deleted User",
          phoneNumber: null,
          username: null,
          avatarUrl: null,
          phoneLast4: null,
          status: "deleted",
          role: "user",
          loginAttempts: 0,
          lockUntil: null,
          otpFailedAttempts: 0,
          otpAttemptsWindowStart: null,
          lastLogin: null,
          lastOtpSentAt: null,
          isPhoneVerified: false,
          updatedAt: now,
        })
        .where(eq(users.id, userId));

      await tx
        .delete(wallets)
        .where(eq(wallets.userId, userId));

      await tx
        .delete(notifications)
        .where(eq(notifications.userId, userId));

      await tx
        .delete(bankAccounts)
        .where(eq(bankAccounts.userId, userId));

      return { tokensRevoked: revokedTokens.length };
    });

    logAuditEvent({
      timestamp: now,
      eventType: AuditEventType.ACCOUNT_DELETION_COMPLETED,
      userId,
      metadata: {
        giftsResolved: allUnclaimedGifts.length,
        giftsCancelled,
        tokensRevoked: result.tokensRevoked,
        blockchainResults,
      },
      message: `Account ${userId} successfully deleted`,
    });

    return {
      success: true,
      message: "Account successfully deleted",
      giftsResolved: allUnclaimedGifts.length,
      giftsCancelled,
      tokensRevoked: result.tokensRevoked,
    };
  } catch (error) {
    console.error("[ACCOUNT_DELETION_ERROR]", error);

    logAuditEvent({
      timestamp: now,
      eventType: AuditEventType.ACCOUNT_DELETION_FAILED,
      userId,
      metadata: {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      message: `Account deletion failed for user ${userId}`,
    });

    return {
      success: false,
      message: "Failed to delete account",
      giftsResolved: 0,
      giftsCancelled: 0,
      tokensRevoked: 0,
      error: "DELETION_FAILED",
      detail: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
