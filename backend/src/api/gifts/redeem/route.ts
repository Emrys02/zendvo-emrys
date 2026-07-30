import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { gifts, wallets, transactions, notifications } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { buildSorobanRedeemTx } from "@/lib/soroban";

export async function POST(
  request: NextRequest,
  context?: { params?: Promise<{ id?: string }> },
) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails("about:blank", "Unauthorized", 401, "Unauthorized");
    }

    const { userId } = payload;

    // Extract ID from route params or searchParams or body fallback
    let giftId: string | undefined;
    if (context?.params) {
      const params = await context.params;
      giftId = params.id;
    }

    if (!giftId) {
      try {
        const body = await request.json();
        giftId = body.id || body.giftId;
      } catch {
        // body parsing ignored if empty
      }
    }

    if (!giftId) {
      const url = new URL(request.url);
      const segments = url.pathname.split("/").filter(Boolean);
      // Example path: /api/gifts/123/redeem
      const redeemIdx = segments.indexOf("redeem");
      if (redeemIdx > 0) {
        const possibleId = segments[redeemIdx - 1];
        if (possibleId !== "gifts" && possibleId !== "api") {
          giftId = possibleId;
        }
      }
    }

    if (!giftId) {
      return createProblemDetails("about:blank", "Bad Request", 400, "Missing gift ID parameter");
    }

    // Find gift in database
    const gift = await db.query.gifts.findFirst({
      where: eq(gifts.id, giftId),
    });

    if (!gift) {
      return createProblemDetails("about:blank", "Not Found", 404, "Gift not found");
    }

    // Check authorization: recipient must match
    if (gift.recipientId !== userId) {
      return createProblemDetails("about:blank", "Forbidden", 403, "You are not authorized to redeem this gift");
    }

    // Check time-lock expiry
    const now = new Date();
    if (gift.unlockDatetime && new Date(gift.unlockDatetime) > now) {
      return createProblemDetails(
        "about:blank",
        "Gift Locked",
        400,
        "Gift is still time-locked and cannot be redeemed yet.",
        undefined,
        { unlockDatetime: gift.unlockDatetime }
      );
    }

    // Check status
    if (gift.status === "completed") {
      return createProblemDetails("about:blank", "Already Claimed", 400, "Gift has already been redeemed");
    }

    // Perform off-chain state update and Soroban transaction generation
    const sorobanTx = buildSorobanRedeemTx({
      giftId: gift.id,
      recipientAddress: userId,
    });

    await db.transaction(async (tx) => {
      // 1. Update gift status to completed
      await tx
        .update(gifts)
        .set({
          status: "completed",
          completedAt: now,
          updatedAt: now,
          blockchainTxHash: sorobanTx.txHash || gift.blockchainTxHash,
        })
        .where(eq(gifts.id, gift.id));

      // 2. Credit recipient's wallet balance
      const existingWallet = await tx.query.wallets.findFirst({
        where: (w, { and, eq }) => and(eq(w.userId, userId), eq(w.currency, gift.currency)),
      });

      if (existingWallet) {
        await tx
          .update(wallets)
          .set({
            balance: sql`${wallets.balance} + ${gift.amount}`,
            updatedAt: now,
          })
          .where(eq(wallets.id, existingWallet.id));
      } else {
        await tx.insert(wallets).values({
          userId,
          currency: gift.currency,
          balance: gift.amount,
        });
      }

      // 3. Log transaction history
      await tx.insert(transactions).values({
        userId,
        amount: gift.amount,
        currency: gift.currency,
        type: "transfer",
        status: "completed",
        reference: gift.id,
      });

      // 4. In-app notification for recipient
      await tx.insert(notifications).values({
        userId,
        type: "GIFT_REDEEMED",
        title: "🎁 Gift Redeemed!",
        message: `You have successfully redeemed your gift of ${gift.amount} ${gift.currency}.`,
        read: false,
      });
    });

    const updatedGift = await db.query.gifts.findFirst({
      where: eq(gifts.id, gift.id),
    });

    return NextResponse.json({
      success: true,
      message: "Gift redeemed successfully",
      gift: updatedGift,
      soroban: sorobanTx,
    });
  } catch (error) {
    console.error("[GIFT_REDEEM_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to redeem gift",
    );
  }
}
