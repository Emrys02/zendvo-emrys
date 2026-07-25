import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { gifts, notifications, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { sendAppreciationEmailToSender } from "@/server/services/emailService";

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

    // Parse body parameters
    let body: { message?: string; template?: string; id?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Empty body
    }

    // Extract ID from route params or body or URL fallback
    let giftId: string | undefined;
    if (context?.params) {
      const params = await context.params;
      giftId = params.id;
    }

    if (!giftId) {
      giftId = body.id;
    }

    if (!giftId) {
      const url = new URL(request.url);
      const segments = url.pathname.split("/").filter(Boolean);
      // Example path: /api/gifts/123/appreciate
      const appreciateIdx = segments.indexOf("appreciate");
      if (appreciateIdx > 0) {
        giftId = segments[appreciateIdx - 1];
      }
    }

    if (!giftId) {
      return createProblemDetails("about:blank", "Bad Request", 400, "Missing gift ID parameter");
    }

    const customMessage = body.message?.trim();
    const templateMessage = body.template?.trim();

    if (!customMessage && !templateMessage) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Please provide an appreciation message or select a template",
      );
    }

    const thankYouText = customMessage || templateMessage!;

    // Query gift
    const gift = await db.query.gifts.findFirst({
      where: eq(gifts.id, giftId),
    });

    if (!gift) {
      return createProblemDetails("about:blank", "Not Found", 404, "Gift not found");
    }

    // Authorization check: must be recipient
    if (gift.recipientId !== userId) {
      return createProblemDetails("about:blank", "Forbidden", 403, "You are not authorized to send appreciation for this gift");
    }

    // Fetch recipient details
    const recipientUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    const recipientName = recipientUser?.name || recipientUser?.username || "Recipient";

    // Fetch sender details if senderId is linked
    let targetSenderEmail = gift.senderEmail;
    let targetSenderName = gift.senderName;

    if (gift.senderId) {
      const senderUser = await db.query.users.findFirst({
        where: eq(users.id, gift.senderId),
      });
      if (senderUser) {
        targetSenderEmail = targetSenderEmail || senderUser.email;
        targetSenderName = targetSenderName || senderUser.name || senderUser.username;
      }
    }

    // 1. Trigger in-app notification to sender if senderId exists
    if (gift.senderId) {
      await db.insert(notifications).values({
        userId: gift.senderId,
        type: "GIFT_APPRECIATION",
        title: "💖 Gift Appreciation Received!",
        message: `${recipientName} sent you a thank-you note: "${thankYouText}"`,
        read: false,
      });
    }

    // 2. Trigger email notification to sender if email exists
    if (targetSenderEmail) {
      await sendAppreciationEmailToSender({
        senderEmail: targetSenderEmail,
        senderName: targetSenderName,
        recipientName,
        message: customMessage,
        template: templateMessage,
        amount: gift.amount,
        currency: gift.currency,
      });
    }

    return NextResponse.json({
      success: true,
      message: "Appreciation message delivered successfully to sender",
      data: {
        giftId: gift.id,
        appreciation: thankYouText,
      },
    });
  } catch (error) {
    console.error("[GIFT_APPRECIATE_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to deliver appreciation message",
    );
  }
}
