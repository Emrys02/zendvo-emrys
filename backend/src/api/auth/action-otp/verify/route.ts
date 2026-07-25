/**
 * POST /api/auth/action-otp/verify
 *
 * Validates a 6-digit OTP that was previously issued for a sensitive action,
 * then returns a short-lived "action token" the frontend must attach as the
 * `X-Action-Token` header when executing that privileged request.
 *
 * Flow:
 *   1. Client sends { code, action } in the request body (authenticated).
 *   2. Handler resolves the caller's user ID from their Bearer access token.
 *   3. Retrieves the most-recent, un-used OTP for that user from the DB,
 *      scoped to the requested action to prevent cross-action token minting.
 *   4. Verifies expiry and HMAC hash.
 *   5. Atomically deletes the OTP record (prevents replay and race conditions).
 *   6. Issues and returns a 10-minute action JWT.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, emailVerifications } from "@/lib/db/schema";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import { verifyOTPHash } from "@/server/services/otpService";
import { generateActionToken, type ActionType } from "@/lib/tokens";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import {
  AuditEventType,
  logOTPEvent,
} from "@/server/services/auditService";

/** All sensitive actions the platform recognises. */
const VALID_ACTIONS: ActionType[] = [
  "delete_account",
  "disable_2fa",
  "change_email",
  "change_password",
  "withdraw_funds",
];

function isValidAction(value: unknown): value is ActionType {
  return typeof value === "string" && VALID_ACTIONS.includes(value as ActionType);
}

export async function POST(request: NextRequest) {
  try {
    // ── 1. CSRF guard ──────────────────────────────────────────────────────
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin && host && !origin.includes(host)) {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "CSRF protection: Invalid origin",
      );
    }

    // ── 2. Authenticate the caller ─────────────────────────────────────────
    const authPayload = await getAuthPayload(request);
    if (!authPayload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication required. Please log in and try again.",
      );
    }

    const { userId } = authPayload;

    // ── 3. Parse & validate request body ──────────────────────────────────
    let body: { code?: unknown; action?: unknown };
    try {
      body = await request.json();
    } catch {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Request body must be valid JSON.",
      );
    }

    const { code, action } = body;

    if (!code || typeof code !== "string") {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Field 'code' is required and must be a string.",
      );
    }

    // Normalise: strip whitespace, ensure it's exactly 6 digits
    const sanitizedCode = code.trim();
    if (!/^\d{6}$/.test(sanitizedCode)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Field 'code' must be a 6-digit numeric string.",
      );
    }

    if (!isValidAction(action)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        `Field 'action' is required and must be one of: ${VALID_ACTIONS.join(", ")}.`,
      );
    }

    // ── 4. Load the user record ───────────────────────────────────────────
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, status: true, lockUntil: true },
    });

    if (!user) {
      // Should be unreachable for a valid JWT, but defensive coding.
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "User not found.",
      );
    }

    if (user.status === "suspended") {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "Account suspended.",
      );
    }

    if (user.lockUntil && new Date() < user.lockUntil) {
      return createProblemDetails(
        "about:blank",
        "Too Many Requests",
        429,
        "Account is temporarily locked due to repeated failed attempts. Please try again later.",
      );
    }

    // ── 5. Retrieve the active OTP record (scoped to the requested action) ──
    const verification = await db.query.emailVerifications.findFirst({
      where: and(
        eq(emailVerifications.userId, userId),
        eq(emailVerifications.isUsed, false),
        eq(emailVerifications.action, action),
      ),
      orderBy: [desc(emailVerifications.createdAt)],
    });

    if (!verification) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "No active verification code found. Please request a new one.",
      );
    }

    // ── 6. Check expiry ───────────────────────────────────────────────────
    if (new Date() > verification.expiresAt) {
      // Clean up the stale record proactively
      await db
        .delete(emailVerifications)
        .where(eq(emailVerifications.id, verification.id));

      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Verification code has expired. Please request a new one.",
      );
    }

    // ── 7. Check attempt limit ────────────────────────────────────────────
    if (verification.attempts >= 5) {
      return createProblemDetails(
        "about:blank",
        "Too Many Requests",
        429,
        "Maximum verification attempts exceeded. Please request a new code.",
      );
    }

    // ── 8. Verify HMAC hash ───────────────────────────────────────────────
    let isValid = false;
    const storedHash = verification.otpHash;

    if (storedHash.includes(":")) {
      const [salt, hash] = storedHash.split(":");
      isValid = verifyOTPHash(sanitizedCode, hash, salt);
    }

    if (!isValid) {
      // Atomically increment the attempt counter at the DB level to prevent
      // concurrent requests from both reading the same stale value and each
      // writing the same incremented count, which would allow bypassing the cap.
      // The WHERE clause also guards the cap itself: if another concurrent
      // request already pushed attempts to 5, this update matches zero rows
      // and we return the cap-exceeded response instead.
      const incremented = await db
        .update(emailVerifications)
        .set({ attempts: sql`attempts + 1` })
        .where(
          and(
            eq(emailVerifications.id, verification.id),
            lt(emailVerifications.attempts, 5),
          ),
        )
        .returning({ attempts: emailVerifications.attempts });

      if (incremented.length === 0) {
        // Another concurrent request hit the cap first.
        return createProblemDetails(
          "about:blank",
          "Too Many Requests",
          429,
          "Maximum verification attempts exceeded. Please request a new code.",
        );
      }

      const newAttempts = incremented[0].attempts;
      const remaining = 5 - newAttempts;

      logOTPEvent(AuditEventType.OTP_VERIFIED_FAILED, userId, {
        context: "action-otp-verify",
        action,
        attemptNumber: newAttempts,
        remainingAttempts: remaining,
      });

      return NextResponse.json(
        {
          success: false,
          error: `Invalid verification code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
        },
        { status: 400 },
      );
    }

    // ── 9. Atomically consume the OTP — prevents replay and double-mint ───
    // Use a conditional DELETE so that only one of two concurrent valid
    // requests can actually remove the record.  If another request already
    // deleted it, `deleted` will be an empty array and we reject this one.
    const deleted = await db
      .delete(emailVerifications)
      .where(
        and(
          eq(emailVerifications.id, verification.id),
          eq(emailVerifications.isUsed, false),
        ),
      )
      .returning({ id: emailVerifications.id });

    if (deleted.length === 0) {
      // Race: a concurrent request consumed this OTP first.
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Verification code has already been used. Please request a new one.",
      );
    }

    logOTPEvent(AuditEventType.OTP_VERIFIED_SUCCESS, userId, {
      context: "action-otp-verify",
      action,
    });

    // ── 10. Issue the action token ────────────────────────────────────────
    const actionToken = await generateActionToken({ userId, action });

    return NextResponse.json(
      {
        success: true,
        message: "OTP verified. Use the action token to authorise your request.",
        action_token: actionToken,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[ACTION_OTP_VERIFY_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
