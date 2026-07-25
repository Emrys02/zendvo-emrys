import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { gifts, users } from "@/lib/db/schema";
import { and, eq, or, desc } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";

export async function GET(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails("about:blank", "Unauthorized", 401, "Unauthorized");
    }

    const { userId } = payload;
    const now = new Date();
    const url = new URL(request.url);
    const filterType = url.searchParams.get("type") || "all";

    // Fetch sent gifts if requested or 'all'
    const rawSentGifts = filterType === "received" ? [] : await db
      .select({
        id: gifts.id,
        senderId: gifts.senderId,
        recipientId: gifts.recipientId,
        amount: gifts.amount,
        fee: gifts.fee,
        totalAmount: gifts.totalAmount,
        currency: gifts.currency,
        message: gifts.message,
        template: gifts.template,
        status: gifts.status,
        hideAmount: gifts.hideAmount,
        hideSender: gifts.hideSender,
        isAnonymous: gifts.isAnonymous,
        unlockDatetime: gifts.unlockDatetime,
        createdAt: gifts.createdAt,
        completedAt: gifts.completedAt,
        recipientName: users.name,
        recipientEmail: users.email,
        recipientAvatar: users.avatarUrl,
      })
      .from(gifts)
      .leftJoin(users, eq(gifts.recipientId, users.id))
      .where(eq(gifts.senderId, userId))
      .orderBy(desc(gifts.createdAt));

    // Fetch received gifts if requested or 'all'
    const rawReceivedGifts = filterType === "sent" ? [] : await db
      .select({
        id: gifts.id,
        senderId: gifts.senderId,
        recipientId: gifts.recipientId,
        amount: gifts.amount,
        fee: gifts.fee,
        totalAmount: gifts.totalAmount,
        currency: gifts.currency,
        message: gifts.message,
        template: gifts.template,
        status: gifts.status,
        hideAmount: gifts.hideAmount,
        hideSender: gifts.hideSender,
        isAnonymous: gifts.isAnonymous,
        unlockDatetime: gifts.unlockDatetime,
        createdAt: gifts.createdAt,
        completedAt: gifts.completedAt,
        senderName: gifts.senderName,
        senderEmail: gifts.senderEmail,
        senderAvatar: gifts.senderAvatar,
      })
      .from(gifts)
      .where(eq(gifts.recipientId, userId))
      .orderBy(desc(gifts.createdAt));

    // Apply privacy rules to received gifts
    const receivedGifts = rawReceivedGifts.map((gift) => {
      const isLocked = gift.unlockDatetime ? new Date(gift.unlockDatetime) > now : false;
      const isAnonymousSender = gift.hideSender || gift.isAnonymous;
      const isAmountHidden = gift.hideAmount && gift.status !== "completed" && isLocked;

      return {
        ...gift,
        senderId: isAnonymousSender ? null : gift.senderId,
        senderName: isAnonymousSender ? "Anonymous" : (gift.senderName || "Gift Sender"),
        senderEmail: isAnonymousSender ? null : gift.senderEmail,
        senderAvatar: isAnonymousSender ? null : gift.senderAvatar,
        amount: isAmountHidden ? null : gift.amount,
        totalAmount: isAmountHidden ? null : gift.totalAmount,
        hiddenAmount: isAmountHidden,
        isLocked,
      };
    });

    const sentGifts = rawSentGifts.map((gift) => {
      const isLocked = gift.unlockDatetime ? new Date(gift.unlockDatetime) > now : false;
      return {
        ...gift,
        isLocked,
      };
    });

    // Compute aggregated statistics
    const giftsReceivedCount = receivedGifts.length;
    const giftsSentCount = sentGifts.length;
    
    const totalReceivedValue = receivedGifts
      .filter((g) => g.status === "completed" && g.amount !== null)
      .reduce((sum, g) => sum + (g.amount || 0), 0);

    const totalSentValue = sentGifts
      .filter((g) => g.status === "completed")
      .reduce((sum, g) => sum + g.amount, 0);

    const unopenedCount = receivedGifts.filter((g) => g.isLocked || (g.status !== "completed" && g.status !== "failed")).length;

    return NextResponse.json({
      success: true,
      stats: {
        giftsReceivedCount,
        giftsSentCount,
        totalReceivedValue,
        totalSentValue,
        unopenedCount,
      },
      sentGifts,
      receivedGifts,
    });
  } catch (error) {
    console.error("[DASHBOARD_GIFTS_GET_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to retrieve dashboard gift statistics",
    );
  }
}
