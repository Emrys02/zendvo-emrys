import * as jose from "jose";
import { db } from "@/lib/db";
import { usedActionTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
export type UserRole = "Sender" | "Recipient" | "Admin";

/**
 * Enumeration of sensitive actions that require OTP verification before execution.
 * Add new action types here as the platform grows.
 */
export type ActionType =
  | "delete_account"
  | "disable_2fa"
  | "change_email"
  | "change_password"
  | "withdraw_funds";

const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET || "fallback_access_secret";
const REFRESH_TOKEN_SECRET =
  process.env.JWT_REFRESH_SECRET || "fallback_refresh_secret";

const _ACTION_TOKEN_SECRET = process.env.ACTION_TOKEN_SECRET;
if (!_ACTION_TOKEN_SECRET) {
  throw new Error(
    "ACTION_TOKEN_SECRET environment variable is required. " +
      "Generate one with: openssl rand -hex 64",
  );
}
const ACTION_TOKEN_SECRET: string = _ACTION_TOKEN_SECRET;

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";
/** Action tokens are intentionally short-lived — they must be used immediately. */
const ACTION_TOKEN_EXPIRY = "10m";

const encodedAccessTokenSecret = new TextEncoder().encode(ACCESS_TOKEN_SECRET);
const encodedRefreshTokenSecret = new TextEncoder().encode(
  REFRESH_TOKEN_SECRET,
);
const encodedActionTokenSecret = new TextEncoder().encode(ACTION_TOKEN_SECRET);

export interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  fingerprint?: string;
}

export async function generateAccessToken(
  payload: TokenPayload,
): Promise<string> {
  return await new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(encodedAccessTokenSecret);
}

export async function generateRefreshToken(
  payload: TokenPayload,
): Promise<string> {
  return await new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(encodedRefreshTokenSecret);
}

export async function verifyAccessToken(
  token: string,
): Promise<TokenPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, encodedAccessTokenSecret);
    return payload as unknown as TokenPayload;
  } catch (error) {
    return null;
  }
}

export async function verifyAccessTokenDetailed(
  token: string,
): Promise<
  { valid: true; payload: TokenPayload } | { valid: false; expired: boolean }
> {
  try {
    const { payload } = await jose.jwtVerify(token, encodedAccessTokenSecret);
    return { valid: true, payload: payload as unknown as TokenPayload };
  } catch (error) {
    const typedError = error as { code?: string };
    return {
      valid: false,
      expired: typedError.code === "ERR_JWT_EXPIRED",
    };
  }
}

export async function verifyRefreshToken(
  token: string,
): Promise<TokenPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, encodedRefreshTokenSecret);
    return payload as unknown as TokenPayload;
  } catch (error) {
    return null;
  }
}

export function generateShareLinkToken(): string {
  return crypto.randomUUID();
}

// ─── Action Tokens ────────────────────────────────────────────────────────────

export interface ActionTokenPayload {
  /** The authenticated user this token was issued for. */
  userId: string;
  /** The single sensitive action the frontend is authorised to execute. */
  action: ActionType;
  /** JWT ID — used server-side to enforce single-use semantics. */
  jti?: string;
  /** Standard JWT claim — populated automatically by the signing call. */
  iat?: number;
  exp?: number;
}

/**
 * Generates a short-lived (10-minute) JWT that proves the user passed OTP
 * verification for a specific privileged action.  The frontend must include
 * this token in the `X-Action-Token` header of the subsequent high-privilege
 * request (e.g. DELETE /api/users/account).
 */
export async function generateActionToken(
  payload: Omit<ActionTokenPayload, "iat" | "exp">,
): Promise<string> {
  return await new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACTION_TOKEN_EXPIRY)
    .setJti(crypto.randomUUID()) // unique ID prevents replay within the validity window
    .sign(encodedActionTokenSecret);
}

/**
 * Verifies an action token and returns its payload, or `null` if invalid,
 * expired, or already consumed.
 *
 * Single-use enforcement: on first use the caller is responsible for
 * persisting the jti via `consumeActionToken()`.  This function only
 * *reads* the used-jti store to reject tokens that were already consumed.
 */
export async function verifyActionToken(
  token: string,
): Promise<ActionTokenPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, encodedActionTokenSecret);
    const typedPayload = payload as unknown as ActionTokenPayload;

    if (typedPayload.jti) {
      const alreadyUsed = await db.query.usedActionTokens.findFirst({
        where: eq(usedActionTokens.jti, typedPayload.jti),
        columns: { jti: true },
      });
      if (alreadyUsed) return null;
    }

    return typedPayload;
  } catch {
    return null;
  }
}

/**
 * Marks an action token as consumed so it cannot be replayed.
 * Must be called by the consuming endpoint (e.g. DELETE /api/users/account)
 * immediately after `verifyActionToken` succeeds, before performing the
 * privileged action.
 */
export async function consumeActionToken(
  payload: ActionTokenPayload,
): Promise<void> {
  if (!payload.jti || !payload.exp) return;
  await db
    .insert(usedActionTokens)
    .values({
      jti: payload.jti,
      expiresAt: new Date(payload.exp * 1000),
    })
    .onConflictDoNothing(); // idempotent — safe if called twice in a race
}
