import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  users,
  emailVerifications,
  passwordResets,
  refreshTokens,
  gifts,
  wallets,
  notifications,
  bankAccounts,
  transactions,
} from "@/lib/db/schema";
import { eq, and, or, inArray } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { verifyOTP } from "@/server/services/otpService";
import { logAuditEvent, AuditEventType } from "@/server/services/auditService";
import { comparePassword } from "@/lib/auth";

export async function DELETE(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Unauthorized",
      );
    }

    const body = await request.json().catch(() => ({}));
    const { password, otp } = body as { password?: string; otp?: string };

    if (!password || !otp) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Password and OTP are required for account deletion",
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
    });

    if (!user) {
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "User not found",
      );
    }

    if (user.status === "suspended") {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "Account is suspended",
      );
    }

    const passwordValid = await comparePassword(password, user.passwordHash);
    if (!passwordValid) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Invalid password",
      );
    }

    const otpResult = await verifyOTP(user.id, otp);
    if (!otpResult.success) {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        otpResult.message,
      );
    }

    const sentGifts = await db.query.gifts.findMany({
      where: eq(gifts.senderId, user.id),
      columns: { id: true, status: true },
    });

    const receivedGifts = await db.query.gifts.findMany({
      where: eq(gifts.recipientId, user.id),
      columns: { id: true, status: true },
    });

    const unclaimedSentCount = sentGifts.filter(
      (g) =>
        g.status === "pending_otp" ||
        g.status === "otp_verified" ||
        g.status === "pending_review" ||
        g.status === "confirmed",
    ).length;

    const unclaimedReceivedCount = receivedGifts.filter(
      (g) =>
        g.status === "pending_otp" ||
        g.status === "otp_verified" ||
        g.status === "pending_review" ||
        g.status === "confirmed" ||
        g.status === "sent",
    ).length;

    const allGiftIds = [
      ...sentGifts.map((g) => g.id),
      ...receivedGifts.map((g) => g.id),
    ];

    await db.transaction(async (tx) => {
      if (allGiftIds.length > 0) {
        await tx.delete(gifts).where(inArray(gifts.id, allGiftIds));
      }

      await tx
        .delete(emailVerifications)
        .where(eq(emailVerifications.userId, user.id));
      await tx
        .delete(passwordResets)
        .where(eq(passwordResets.userId, user.id));
      await tx
        .delete(refreshTokens)
        .where(eq(refreshTokens.userId, user.id));
      await tx.delete(notifications).where(eq(notifications.userId, user.id));
      await tx
        .delete(bankAccounts)
        .where(eq(bankAccounts.userId, user.id));
      await tx
        .delete(transactions)
        .where(eq(transactions.userId, user.id));
      await tx.delete(wallets).where(eq(wallets.userId, user.id));

      await tx.delete(users).where(eq(users.id, user.id));
    });

    logAuditEvent({
      timestamp: new Date(),
      eventType: AuditEventType.ACCOUNT_UNLOCKED,
      userId: user.id,
      metadata: {
        action: "ACCOUNT_DELETED",
        deletedSentGifts: sentGifts.length,
        deletedReceivedGifts: receivedGifts.length,
        unclaimedSentGifts: unclaimedSentCount,
        unclaimedReceivedGifts: unclaimedReceivedCount,
      },
      message: `Account deleted for user ${user.id}. Deleted ${sentGifts.length} sent gifts (${unclaimedSentCount} unclaimed), ${receivedGifts.length} received gifts (${unclaimedReceivedCount} unclaimed).`,
    });

    const response = NextResponse.json(
      {
        success: true,
        message: "Account deleted successfully",
        deletedSentGifts: sentGifts.length,
        deletedReceivedGifts: receivedGifts.length,
      },
      { status: 200 },
    );

    response.cookies.set("access_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    response.cookies.set("refresh_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error("[DELETE_ACCOUNT_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
