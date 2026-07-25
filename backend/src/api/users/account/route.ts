import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { actionTokens } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { deleteAccount } from "@/lib/services/cleanup";
import { logAuditEvent, AuditEventType } from "@/server/services/auditService";

export async function DELETE(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin && host && !origin.includes(host)) {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "CSRF protection: Invalid origin"
      );
    }

    const authPayload = await getAuthPayload(request);
    if (!authPayload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication required"
      );
    }

    const { userId } = authPayload;

    let actionToken: string | undefined;

    try {
      const body = await request.json();
      actionToken = body.actionToken;
    } catch {
      const authHeader = request.headers.get("x-action-token");
      if (authHeader) {
        actionToken = authHeader;
      }
    }

    if (!actionToken) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Action token is required. Please verify your OTP first via /api/auth/verify-deletion-otp."
      );
    }

    const storedToken = await db.query.actionTokens.findFirst({
      where: and(
        eq(actionTokens.token, actionToken),
        eq(actionTokens.userId, userId),
        eq(actionTokens.action, "delete_account")
      ),
    });

    if (!storedToken) {
      logAuditEvent({
        timestamp: new Date(),
        eventType: AuditEventType.ACCOUNT_DELETION_FAILED,
        userId,
        metadata: { reason: "Invalid action token" },
        message: `Account deletion attempt with invalid action token for user ${userId}`,
      });

      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "Invalid action token"
      );
    }

    if (storedToken.usedAt) {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "Action token has already been used"
      );
    }

    if (storedToken.revokedAt) {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "Action token has been revoked"
      );
    }

    if (new Date() > storedToken.expiresAt) {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "Action token has expired. Please request a new one."
      );
    }

    await db
      .update(actionTokens)
      .set({ usedAt: new Date() })
      .where(eq(actionTokens.id, storedToken.id));

    logAuditEvent({
      timestamp: new Date(),
      eventType: AuditEventType.ACCOUNT_DELETION_REQUESTED,
      userId,
      metadata: { actionTokenId: storedToken.id },
      message: `Account deletion initiated for user ${userId}`,
    });

    const result = await deleteAccount(userId);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          message: result.message,
          error: result.error,
          detail: result.detail,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: result.message,
        giftsResolved: result.giftsResolved,
        giftsCancelled: result.giftsCancelled,
        tokensRevoked: result.tokensRevoked,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[DELETE_ACCOUNT_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to delete account"
    );
  }
}
