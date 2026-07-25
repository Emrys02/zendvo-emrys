import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "@/lib/db";
import { users, emailVerifications } from "@/lib/db/schema";
import { eq, and, desc, lt, or, gt, sql } from "drizzle-orm";
import { validateE164PhoneNumber, sanitizePhoneNumber } from "@/lib/validation";
import {
  AuditEventType,
  logOTPEvent,
} from "@/server/services/auditService";
import { sendAdminAlert } from "./emailService";

const SUSPICIOUS_OTP_THRESHOLD = 20;
const IP_TRACKING_WINDOW_MS = 60 * 60 * 1000; 

type IpFailureState = {
  count: number;
  userIds: Set<string>;
  phoneNumbers: Set<string>;
  lastAttempt: number;
};

const otpFailuresByIp = new Map<string, IpFailureState>();

export const MAX_OTP_REQUESTS_PER_PHONE = 4;
export const OTP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface OTPRateLimitResult {
  allowed: boolean;
  remainingRequests: number;
  retryAfterMs: number;
  message?: string;
}

export async function checkOTPRequestRateLimit(
  phoneNumber: string,
): Promise<OTPRateLimitResult> {
  const windowStart = new Date(Date.now() - OTP_RATE_LIMIT_WINDOW_MS);

  const user = await db.query.users.findFirst({
    where: eq(users.phoneNumber, phoneNumber),
    columns: { id: true },
  });

  if (!user) {
    return {
      allowed: true,
      remainingRequests: MAX_OTP_REQUESTS_PER_PHONE,
      retryAfterMs: 0,
    };
  }

  const recentOTPs = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.userId, user.id),
        gt(emailVerifications.createdAt, windowStart),
      ),
    );

  const otpCount = recentOTPs[0]?.count ?? 0;

  if (otpCount >= MAX_OTP_REQUESTS_PER_PHONE) {
    const oldestOTP = await db.query.emailVerifications.findFirst({
      where: and(
        eq(emailVerifications.userId, user.id),
        gt(emailVerifications.createdAt, windowStart),
      ),
      orderBy: [emailVerifications.createdAt],
      columns: { createdAt: true },
    });

    const retryAfterMs = oldestOTP
      ? Math.max(
          0,
          OTP_RATE_LIMIT_WINDOW_MS -
            (Date.now() - new Date(oldestOTP.createdAt).getTime()),
        )
      : OTP_RATE_LIMIT_WINDOW_MS;

    return {
      allowed: false,
      remainingRequests: 0,
      retryAfterMs,
      message: `Too many OTP requests. Please wait ${Math.ceil(retryAfterMs / 60000)} minutes before requesting a new code.`,
    };
  }

  return {
    allowed: true,
    remainingRequests: MAX_OTP_REQUESTS_PER_PHONE - otpCount - 1,
    retryAfterMs: 0,
  };
}

export async function checkOTPRequestRateLimitByUserId(
  userId: string,
): Promise<OTPRateLimitResult> {
  const windowStart = new Date(Date.now() - OTP_RATE_LIMIT_WINDOW_MS);

  const recentOTPs = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.userId, userId),
        gt(emailVerifications.createdAt, windowStart),
      ),
    );

  const otpCount = recentOTPs[0]?.count ?? 0;

  if (otpCount >= MAX_OTP_REQUESTS_PER_PHONE) {
    const oldestOTP = await db.query.emailVerifications.findFirst({
      where: and(
        eq(emailVerifications.userId, userId),
        gt(emailVerifications.createdAt, windowStart),
      ),
      orderBy: [emailVerifications.createdAt],
      columns: { createdAt: true },
    });

    const retryAfterMs = oldestOTP
      ? Math.max(
          0,
          OTP_RATE_LIMIT_WINDOW_MS -
            (Date.now() - new Date(oldestOTP.createdAt).getTime()),
        )
      : OTP_RATE_LIMIT_WINDOW_MS;

    return {
      allowed: false,
      remainingRequests: 0,
      retryAfterMs,
      message: `Too many OTP requests. Please wait ${Math.ceil(retryAfterMs / 60000)} minutes before requesting a new code.`,
    };
  }

  return {
    allowed: true,
    remainingRequests: MAX_OTP_REQUESTS_PER_PHONE - otpCount - 1,
    retryAfterMs: 0,
  };
}

export function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString();
}


export function hashOTP(otp: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.createHmac("sha256", salt).update(otp).digest("hex");
  return { salt, hash };
}


export function verifyOTPHash(
  otp: string,
  storedHash: string,
  salt: string,
): boolean {
  const hash = crypto.createHmac("sha256", salt).update(otp).digest("hex");

  if (hash.length !== storedHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
}

export async function sendOTP(phoneNumber: string): Promise<{ success: boolean; message: string; error?: string; detail?: string }> {
  try {
    if (!validateE164PhoneNumber(phoneNumber)) {
      return {
        success: false,
        message: "Invalid phone number format. Please use E.164 format (e.g., +2348123456789)",
        error: "INVALID_PHONE_FORMAT",
        detail: "INVALID_PHONE_FORMAT",
      };
    }

    const sanitizedPhone = sanitizePhoneNumber(phoneNumber);

    const user = await db.query.users.findFirst({
      where: eq(users.phoneNumber, sanitizedPhone),
    });

    if (!user) {
      return {
        success: false,
        message: "User not found with this phone number",
        error: "USER_NOT_FOUND",
        detail: "USER_NOT_FOUND",
      };
    }

    if (user.status === "suspended") {
      return {
        success: false,
        message: "Account suspended",
        error: "ACCOUNT_SUSPENDED",
        detail: "ACCOUNT_SUSPENDED",
      };
    }

    const otp = generateOTP();
    await storeOTP(user.id, otp);

    console.log(`[SMS_OTP] Phone: ${sanitizedPhone}, OTP: ${otp}`);

    const smsResult = await sendSMSViaProvider(sanitizedPhone, `Your Zendvo verification code is: ${otp}. Valid for 10 minutes.`);

    if (!smsResult.success) {
      console.error("Failed to send OTP SMS:", smsResult.error);
      return {
        success: false,
        message: "Failed to send OTP SMS",
        error: "SMS_SEND_FAILED",
        detail: "SMS_SEND_FAILED",
      };
    }

    console.log(`[AUDIT] SMS OTP sent to ${sanitizedPhone} for user ${user.id}`);

    return {
      success: true,
      message: "OTP sent successfully via SMS"
    };

  } catch (error) {
    console.error("[SEND_PHONE_OTP_ERROR]", error);
    return {
      success: false,
      message: "Internal server error",
      error: "INTERNAL_ERROR",
      detail: "INTERNAL_ERROR",
    };
  }
}


async function sendSMSViaProvider(phoneNumber: string, message: string): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[MOCK_SMS] To: ${phoneNumber}, Message: ${message}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown SMS error" };
  }
}

export async function storeOTP(userId: string, otp: string, action?: string) {
  const { salt, hash } = hashOTP(otp);
  const storedValue = `${salt}:${hash}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  // PostgreSQL error code for serialization failure (40001) and deadlock (40P01).
  // Either can be raised when two SERIALIZABLE transactions conflict on the same
  // rows.  Both are safe to retry immediately from the application layer.
  const SERIALIZATION_FAILURE = "40001";
  const DEADLOCK_DETECTED = "40P01";
  const MAX_RETRIES = 3;

  let attempt = 0;
  let newVerification: typeof import("@/lib/db/schema").emailVerifications.$inferSelect | undefined;

  while (attempt < MAX_RETRIES) {
    try {
      newVerification = await db.transaction(
        async (tx) => {
          // Invalidate existing unused OTPs scoped to the same action.
          await tx
            .update(emailVerifications)
            .set({ isUsed: true })
            .where(
              and(
                eq(emailVerifications.userId, userId),
                eq(emailVerifications.isUsed, false),
                action
                  ? eq(emailVerifications.action, action)
                  : sql`${emailVerifications.action} IS NULL`,
              ),
            );

          const [inserted] = await tx
            .insert(emailVerifications)
            .values({
              userId,
              otpHash: storedValue,
              expiresAt,
              attempts: 0,
              isUsed: false,
              action: action ?? null,
            })
            .returning();

          return inserted;
        },
        { isolationLevel: "serializable" },
      );

      // Transaction committed — exit the retry loop.
      break;
    } catch (err) {
      const pgCode = (err as { code?: string }).code;
      if (
        (pgCode === SERIALIZATION_FAILURE || pgCode === DEADLOCK_DETECTED) &&
        attempt < MAX_RETRIES - 1
      ) {
        attempt++;
        continue;
      }
      // Propagate non-retryable errors or exhausted retries.
      throw err;
    }
  }

  logOTPEvent(AuditEventType.OTP_GENERATED, userId);

  await db
    .update(users)
    .set({ lastOtpSentAt: new Date() })
    .where(eq(users.id, userId));

  return newVerification!;
}

export async function verifyOTP(userId: string, otp: string, ipAddress?: string) {
  // Explicitly exclude action-scoped OTPs — those must only be consumed by the
  // action-otp/verify endpoint.  Without this guard a privileged OTP (e.g.
  // issued for delete_account) could be consumed by the general email/phone
  // verification flow and its action token would never be issued.
  const verification = await db.query.emailVerifications.findFirst({
    where: and(
      eq(emailVerifications.userId, userId),
      eq(emailVerifications.isUsed, false),
      sql`${emailVerifications.action} IS NULL`,
    ),
    orderBy: [desc(emailVerifications.createdAt)],
  });

  if (!verification) {
    return {
      success: false,
      message: "No verification code found. Please request a new one.",
      detail: "NO_VERIFICATION_FOUND",
    };
  }

  if (new Date() > verification.expiresAt) {
    return {
      success: false,
      message: "Verification code has expired. Please request a new one.",
      detail: "VERIFICATION_EXPIRED",
    };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (user && user.lockUntil && new Date() < user.lockUntil) {
    return {
      success: false,
      message: "Account is temporarily locked. Please try again later.",
      locked: true,
      detail: "ACCOUNT_LOCKED",
    };
  }

  if (verification.attempts >= 5) {
    return {
      success: false,
      message: "Maximum attempts exceeded. Account is locked.",
      locked: true,
      detail: "MAX_ATTEMPTS_EXCEEDED",
    };
  }

  let isValid = false;
  const storedHash = verification.otpHash;

  if (storedHash.includes(":")) {
    const [salt, hash] = storedHash.split(":");
    isValid = verifyOTPHash(otp, hash, salt);
  } else {
    isValid = await bcrypt.compare(otp, storedHash);
  }

  if (!isValid) {
    const newAttempts = verification.attempts + 1;

    await db
      .update(emailVerifications)
      .set({ attempts: newAttempts })
      .where(eq(emailVerifications.id, verification.id));

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    let cumulativeFailures = (user?.otpFailedAttempts || 0) + 1;
    let windowStart = user?.otpAttemptsWindowStart;

    if (!windowStart || windowStart < oneHourAgo) {
      cumulativeFailures = 1;
      windowStart = now;
    }

    await db
      .update(users)
      .set({
        otpFailedAttempts: cumulativeFailures,
        otpAttemptsWindowStart: windowStart,
      })
      .where(eq(users.id, userId));

    if (ipAddress) {
      const now = Date.now();
      let state = otpFailuresByIp.get(ipAddress);

      if (state && now - state.lastAttempt > IP_TRACKING_WINDOW_MS) {
        otpFailuresByIp.delete(ipAddress);
        state = undefined;
      }

      if (!state) {
        state = {
          count: 0,
          userIds: new Set<string>(),
          phoneNumbers: new Set<string>(),
          lastAttempt: now,
        };
      }

      state.count++;
      state.lastAttempt = now;
      state.userIds.add(userId);
      if (user?.phoneNumber) state.phoneNumbers.add(user.phoneNumber);

      otpFailuresByIp.set(ipAddress, state);

      if (state.count === SUSPICIOUS_OTP_THRESHOLD) {
        sendAdminAlert({
          userIds: Array.from(state.userIds),
          ips: [ipAddress],
          phoneNumbers: Array.from(state.phoneNumbers),
          failureCount: state.count,
        }).catch((err) => console.error("[ADMIN_ALERT_ERROR]", err));
      }
    }

    logOTPEvent(AuditEventType.OTP_VERIFIED_FAILED, userId, {
      attemptNumber: newAttempts,
      cumulativeFailures,
      remainingAttempts: 5 - newAttempts,
    });

    if (cumulativeFailures >= 10) {
      const lockUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000); 
      await db
        .update(users)
        .set({
          lockUntil,
          otpFailedAttempts: 0,
          otpAttemptsWindowStart: null,
        })
        .where(eq(users.id, userId));

      logOTPEvent(AuditEventType.ACCOUNT_LOCKED_10_ATTEMPTS, userId, {
        lockDuration: "24 hours",
        cumulativeFailures,
        reason: "10 failed OTP attempts within 1 hour",
      });

      return {
        success: false,
        message:
          "Account locked for 24 hours due to repeated failed attempts. Please contact support if you need assistance.",
        locked: true,
        shouldSendAlert: true,
        lockDuration: "24 hours",
        detail: "ACCOUNT_LOCKED_24_HOURS",
      };
    }

    if (newAttempts >= 5) {
      const lockUntil = new Date(now.getTime() + 30 * 60 * 1000); 
      await db.update(users).set({ lockUntil }).where(eq(users.id, userId));

      logOTPEvent(AuditEventType.ACCOUNT_LOCKED_5_ATTEMPTS, userId, {
        lockDuration: "30 minutes",
        attemptNumber: newAttempts,
        reason: "5 failed attempts on current OTP",
      });

      return {
        success: false,
        message: "Maximum attempts exceeded. Account locked for 30 minutes.",
        locked: true,
        shouldSendAlert: true,
        lockDuration: "30 minutes",
        detail: "ACCOUNT_LOCKED_30_MINUTES",
      };
    }

    const remainingAttempts = 5 - newAttempts;
    return {
      success: false,
      message: `Invalid verification code. ${remainingAttempts} attempts remaining.`,
      remainingAttempts,
      detail: "INVALID_VERIFICATION_CODE",
    };
  }

  await db
    .delete(emailVerifications)
    .where(eq(emailVerifications.id, verification.id));

  await db
    .update(users)
    .set({
      status: "active",
      lockUntil: null,
      loginAttempts: 0,
      otpFailedAttempts: 0,
      otpAttemptsWindowStart: null,
      isPhoneVerified: true,
    })
    .where(eq(users.id, userId));

  logOTPEvent(AuditEventType.OTP_VERIFIED_SUCCESS, userId);

  return { success: true, message: "Email verified successfully!" };
}

export async function cleanupExpiredOTPs(): Promise<number> {
  const result = await db
    .delete(emailVerifications)
    .where(lt(emailVerifications.expiresAt, new Date()))
    .returning();
  return result.length;
}


