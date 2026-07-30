import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, actionTokens } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyOTP } from "@/server/services/otpService";
import { createProblemDetails } from "@/lib/api-utils";
import { getAuthPayload } from "@/lib/auth-session";
import { sendSecurityAlertEmail } from "@/server/services/emailService";
import { validateEmail, sanitizeInput } from "@/lib/validation";
import { logAuditEvent, AuditEventType } from "@/server/services/auditService";
import crypto from "crypto";

const ACTION_TOKEN_EXPIRY_MS = 5 * 60 * 1000;
const DELETION_ACTION = "delete_account";

function generateActionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function POST(request: NextRequest) {
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid or missing request body"
      );
    }

    if (!body || typeof body !== "object") {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Request body must be a JSON object"
      );
    }

    const { email, otp } = body as Record<string, unknown>;

    if (typeof email !== "string" || typeof otp !== "string") {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Email and OTP are required and must be strings"
      );
    }

    if (!/^\d{6}$/.test(otp)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid OTP format. Must be 6 digits."
      );
    }

    const sanitizedEmail = sanitizeInput(email);

    if (!validateEmail(sanitizedEmail)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid email format"
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "User not found"
      );
    }

    if (user.email.toLowerCase() !== sanitizedEmail.toLowerCase()) {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "Email does not match authenticated user"
      );
    }

    const result = await verifyOTP(userId, otp);

    if (!result.success) {
      if (result.shouldSendAlert) {
        await sendSecurityAlertEmail(sanitizedEmail, user.name || undefined);
      }
      const status = result.locked ? 429 : 400;
      return NextResponse.json(
        { success: false, error: result.message },
        { status }
      );
    }

    const tokenValue = generateActionToken();
    const expiresAt = new Date(Date.now() + ACTION_TOKEN_EXPIRY_MS);

    await db
      .update(actionTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(actionTokens.userId, userId),
          eq(actionTokens.action, DELETION_ACTION)
        )
      );

    const [newActionToken] = await db
      .insert(actionTokens)
      .values({
        userId,
        token: tokenValue,
        action: DELETION_ACTION,
        expiresAt,
      })
      .returning();

    logAuditEvent({
      timestamp: new Date(),
      eventType: AuditEventType.ACCOUNT_DELETION_ACTION_TOKEN_GENERATED,
      userId,
      metadata: {
        actionTokenId: newActionToken.id,
        expiresAt: expiresAt.toISOString(),
      },
      message: `Action token generated for account deletion for user ${userId}`,
    });

    return NextResponse.json(
      {
        success: true,
        message: "OTP verified. Use the action token to confirm account deletion.",
        actionToken: tokenValue,
        expiresAt: expiresAt.toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[VERIFY_DELETION_OTP_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error"
    );
  }
}
