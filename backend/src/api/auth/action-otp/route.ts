import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import {
  generateOTP,
  storeOTP,
  checkOTPRequestRateLimitByUserId,
} from "@/server/services/otpService";
import { sendActionOtpEmail } from "@/server/services/emailService";
import { createProblemDetails } from "@/lib/api-utils";
import {
  checkActionOtpCooldown,
  recordActionOtpRequest,
} from "@/lib/middleware/rateLimit";

const COOLDOWN_WINDOW_MS = 60 * 1000;

const ALLOWED_ACTIONS = new Set([
  "default",
  "transfer_confirm",
  "withdraw",
  "password_reset",
  "email_verification",
  "profile_update",
  "login_2fa",
  "delete_account",
  "disable_2fa",
  "change_email",
  "change_password",
  "withdraw_funds",
]);

export async function POST(request: NextRequest) {
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

    let action = "default";
    try {
      const body = await request.json();
      if (
        body &&
        typeof body.action === "string" &&
        ALLOWED_ACTIONS.has(body.action.trim())
      ) {
        action = body.action.trim();
      }
    } catch {
      // If request body is empty or not JSON, action defaults to "default"
    }

    // 1. Check in-memory action cooldown
    const cooldownResult = checkActionOtpCooldown(
      payload.userId,
      action,
      COOLDOWN_WINDOW_MS,
    );

    if (cooldownResult.isRateLimited) {
      const response = createProblemDetails(
        "about:blank",
        "Too Many Requests",
        429,
        `Rate limit exceeded. Please wait ${cooldownResult.retryAfterSeconds} seconds before requesting a new code.`,
        undefined,
        { retryAfterSeconds: cooldownResult.retryAfterSeconds },
      );
      response.headers.set(
        "Retry-After",
        String(cooldownResult.retryAfterSeconds),
      );
      return response;
    }

    // 2. User verification
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
        "Account suspended",
      );
    }

    // 3. Overall OTP rate limit check
    const rateLimitResult = await checkOTPRequestRateLimitByUserId(user.id);
    if (!rateLimitResult.allowed) {
      const retryAfterSec = Math.ceil(
        (rateLimitResult.retryAfterMs || COOLDOWN_WINDOW_MS) / 1000,
      );
      const response = createProblemDetails(
        "about:blank",
        "Too Many Requests",
        429,
        rateLimitResult.message || "Rate limit exceeded",
        undefined,
        { retryAfterSeconds: retryAfterSec },
      );
      response.headers.set("Retry-After", String(retryAfterSec));
      return response;
    }

    const otp = generateOTP();
    await storeOTP(user.id, otp, action);

    const emailResult = await sendActionOtpEmail(
      user.email,
      otp,
      action,
      user.name || undefined,
    );

    if (!emailResult.success) {
      console.error(
        `[ACTION_OTP_ERROR] Failed to send OTP email for user: ${user.id}`,
        emailResult.error,
      );
      return createProblemDetails(
        "about:blank",
        "Internal Server Error",
        500,
        "Failed to send OTP email",
      );
    }

    // Record the request timestamp for cooldown tracking ONLY after successful OTP email send
    recordActionOtpRequest(payload.userId, action);

    return NextResponse.json(
      {
        success: true,
        message: "OTP sent successfully",
        action,
        expiresIn: "10 minutes",
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[ACTION_OTP_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
