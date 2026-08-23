import * as jose from "jose";
export type UserRole = "Sender" | "Recipient" | "Admin";

const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET || "fallback_access_secret";
const REFRESH_TOKEN_SECRET =
  process.env.JWT_REFRESH_SECRET || "fallback_refresh_secret";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";

const encodedAccessTokenSecret = new TextEncoder().encode(ACCESS_TOKEN_SECRET);
const encodedRefreshTokenSecret = new TextEncoder().encode(
  REFRESH_TOKEN_SECRET,
);

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
  } catch {
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
  } catch {
    return null;
  }
}

export function generateShareLinkToken(): string {
  return crypto.randomUUID();
}
