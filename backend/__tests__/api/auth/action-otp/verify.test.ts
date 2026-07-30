/**
 * Tests for POST /api/auth/action-otp/verify
 *
 * Covers:
 *   - Happy path: valid OTP → action token returned
 *   - Authentication guard (missing / invalid Bearer token)
 *   - Input validation (missing code, missing action, wrong format, invalid action)
 *   - CSRF origin mismatch
 *   - No active OTP in DB
 *   - Expired OTP
 *   - Invalid OTP code (wrong hash)
 *   - Max attempts exceeded
 *   - Suspended account
 *   - Locked account
 */

import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/action-otp/verify/route";
import { db } from "@/lib/db";
import * as otpService from "@/server/services/otpService";
import * as tokens from "@/lib/tokens";
import * as authSession from "@/lib/auth-session";

// ─── Mock: Database ───────────────────────────────────────────────────────────

const mockFindFirstUsers = jest.fn();
const mockFindFirstVerifications = jest.fn();
const mockDeleteReturning = jest.fn();
const mockUpdateReturning = jest.fn();

// Default return values (overridden per-test where needed)
// delete(...).where(...).returning() → [{ id: "verification-1" }]  (1 row deleted)
// update(...).set(...).where(...).returning() → [{ attempts: 1 }]   (1 row updated)

jest.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst: (...args: unknown[]) => mockFindFirstUsers(...args) },
      emailVerifications: {
        findFirst: (...args: unknown[]) => mockFindFirstVerifications(...args),
      },
    },
    delete: jest.fn(() => ({
      where: jest.fn(() => ({
        returning: mockDeleteReturning,
      })),
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => ({
          returning: mockUpdateReturning,
        })),
      })),
    })),
  },
}));

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((_col: unknown, _val: unknown) => ({})),
  and: jest.fn((..._args: unknown[]) => ({})),
  desc: jest.fn((_col: unknown) => ({})),
  lt: jest.fn((_col: unknown, _val: unknown) => ({})),
  sql: Object.assign(
    jest.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => ({})),
    { raw: jest.fn((_s: string) => ({})) },
  ),
}));

jest.mock("@/lib/db/schema", () => ({
  users: { id: "id", status: "status", lockUntil: "lockUntil" },
  emailVerifications: {
    userId: "userId",
    isUsed: "isUsed",
    action: "action",
    createdAt: "createdAt",
    id: "id",
    attempts: "attempts",
  },
}));

// ─── Mock: OTP helpers ────────────────────────────────────────────────────────

jest.mock("@/server/services/otpService", () => ({
  verifyOTPHash: jest.fn(),
}));

// ─── Mock: Token generation ───────────────────────────────────────────────────

jest.mock("@/lib/tokens", () => ({
  generateActionToken: jest.fn().mockResolvedValue("mock-action-token"),
  verifyAccessToken: jest.fn(),
}));

// ─── Mock: Auth session ────────────────────────────────────────────────────────

jest.mock("@/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

// ─── Mock: Audit logger (no-op in tests) ──────────────────────────────────────

jest.mock("@/server/services/auditService", () => ({
  AuditEventType: {
    OTP_VERIFIED_SUCCESS: "OTP_VERIFIED_SUCCESS",
    OTP_VERIFIED_FAILED: "OTP_VERIFIED_FAILED",
  },
  logOTPEvent: jest.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = "http://localhost/api/auth/action-otp/verify";

const makeRequest = (
  body: object,
  options: { origin?: string; authorization?: string } = {},
) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: "localhost",
  };

  if (options.origin !== undefined) {
    headers["origin"] = options.origin;
  }
  if (options.authorization !== undefined) {
    headers["authorization"] = options.authorization;
  }

  return new NextRequest(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

const ACTIVE_OTP_RECORD = {
  id: "verification-1",
  userId: "user-123",
  otpHash: "salt123:hash456",
  expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes in future
  attempts: 0,
  isUsed: false,
  action: "delete_account",
  createdAt: new Date(),
};

const ACTIVE_USER = {
  id: "user-123",
  status: "active",
  lockUntil: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/auth/action-otp/verify", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: authenticated request
    (authSession.getAuthPayload as jest.Mock).mockResolvedValue({
      userId: "user-123",
      email: "test@example.com",
      role: "Sender",
    });
    // Default: valid OTP hash verification
    (otpService.verifyOTPHash as jest.Mock).mockReturnValue(true);
    // Default: active user
    mockFindFirstUsers.mockResolvedValue(ACTIVE_USER);
    // Default: active OTP record (scoped to the action in the request)
    mockFindFirstVerifications.mockResolvedValue(ACTIVE_OTP_RECORD);
    // Default: successful atomic delete (1 row consumed — no race)
    mockDeleteReturning.mockResolvedValue([{ id: "verification-1" }]);
    // Default: successful atomic increment (1 row updated, attempts now = 1)
    mockUpdateReturning.mockResolvedValue([{ attempts: 1 }]);
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it("returns 200 with an action token when OTP is valid", async () => {
    const request = makeRequest(
      { code: "123456", action: "delete_account" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.action_token).toBe("mock-action-token");
    expect(tokens.generateActionToken).toHaveBeenCalledWith({
      userId: "user-123",
      action: "delete_account",
    });
  });

  it("deletes the OTP record after successful verification to prevent replay", async () => {
    const request = makeRequest(
      { code: "123456", action: "withdraw_funds" },
      { authorization: "Bearer valid-access-token" },
    );

    // OTP record scoped to withdraw_funds
    mockFindFirstVerifications.mockResolvedValue({
      ...ACTIVE_OTP_RECORD,
      action: "withdraw_funds",
    });

    await POST(request);

    expect(mockDeleteReturning).toHaveBeenCalled();
  });

  it("accepts all valid action types", async () => {
    const validActions = [
      "delete_account",
      "disable_2fa",
      "change_email",
      "change_password",
      "withdraw_funds",
    ];

    for (const action of validActions) {
      mockFindFirstVerifications.mockResolvedValue({
        ...ACTIVE_OTP_RECORD,
        action,
      });

      const request = makeRequest(
        { code: "654321", action },
        { authorization: "Bearer valid-access-token" },
      );

      const response = await POST(request);
      expect(response.status).toBe(200);
    }
  });

  // ── Authentication ──────────────────────────────────────────────────────────

  it("returns 401 when no Authorization header is provided", async () => {
    (authSession.getAuthPayload as jest.Mock).mockResolvedValue(null);

    const request = makeRequest({ code: "123456", action: "delete_account" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.detail).toContain("Authentication required");
  });

  it("returns 401 when Bearer token is invalid", async () => {
    (authSession.getAuthPayload as jest.Mock).mockResolvedValue(null);

    const request = makeRequest(
      { code: "123456", action: "delete_account" },
      { authorization: "Bearer invalid-token" },
    );
    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  // ── CSRF ────────────────────────────────────────────────────────────────────

  it("returns 403 when origin does not match host", async () => {
    const request = makeRequest(
      { code: "123456", action: "delete_account" },
      {
        origin: "https://evil.example.com",
        authorization: "Bearer valid-access-token",
      },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.detail).toContain("CSRF");
  });

  it("allows request when origin matches host", async () => {
    const request = makeRequest(
      { code: "123456", action: "delete_account" },
      {
        origin: "http://localhost",
        authorization: "Bearer valid-access-token",
      },
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it("returns 400 when 'code' field is missing", async () => {
    const request = makeRequest(
      { action: "delete_account" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.detail).toContain("'code' is required");
  });

  it("returns 400 when 'code' is not 6 digits", async () => {
    const request = makeRequest(
      { code: "12345", action: "delete_account" }, // 5 digits — invalid
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.detail).toContain("6-digit");
  });

  it("returns 400 when 'code' contains non-numeric characters", async () => {
    const request = makeRequest(
      { code: "12a456", action: "delete_account" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("returns 400 when 'action' field is missing", async () => {
    const request = makeRequest(
      { code: "123456" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.detail).toContain("'action' is required");
  });

  it("returns 400 for an unrecognised action type", async () => {
    const request = makeRequest(
      { code: "123456", action: "not_a_real_action" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  // ── Account state ────────────────────────────────────────────────────────────

  it("returns 403 when the account is suspended", async () => {
    mockFindFirstUsers.mockResolvedValue({ ...ACTIVE_USER, status: "suspended" });

    const request = makeRequest(
      { code: "123456", action: "delete_account" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.detail).toContain("suspended");
  });

  it("returns 429 when the account is temporarily locked", async () => {
    mockFindFirstUsers.mockResolvedValue({
      ...ACTIVE_USER,
      lockUntil: new Date(Date.now() + 30 * 60 * 1000),
    });

    const request = makeRequest(
      { code: "123456", action: "delete_account" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);

    expect(response.status).toBe(429);
  });

  // ── OTP record state ──────────────────────────────────────────────────────────

  it("returns 400 when there is no active OTP in the database", async () => {
    mockFindFirstVerifications.mockResolvedValue(null);

    const request = makeRequest(
      { code: "123456", action: "delete_account" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.detail).toContain("No active verification code found");
  });

  it("returns 400 and cleans up record when OTP has expired", async () => {
    mockFindFirstVerifications.mockResolvedValue({
      ...ACTIVE_OTP_RECORD,
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    });

    const request = makeRequest(
      { code: "123456", action: "delete_account" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.detail).toContain("expired");
    // The expired cleanup path calls db.delete(...).where(...) without .returning()
    // so we verify db.delete was called at all.
    const { db: mockDb } = jest.requireMock("@/lib/db");
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("returns 429 when attempt limit for the current OTP record is already reached", async () => {
    mockFindFirstVerifications.mockResolvedValue({
      ...ACTIVE_OTP_RECORD,
      attempts: 5,
    });

    const request = makeRequest(
      { code: "123456", action: "delete_account" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);

    expect(response.status).toBe(429);
  });

  // ── Incorrect code ─────────────────────────────────────────────────────────

  it("returns 400 and atomically increments attempts when the code does not match", async () => {
    (otpService.verifyOTPHash as jest.Mock).mockReturnValue(false);

    const request = makeRequest(
      { code: "000000", action: "delete_account" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Invalid verification code");
    // Should NOT delete the OTP record — the user can retry
    expect(mockDeleteReturning).not.toHaveBeenCalled();
    // Should atomically increment the attempt counter
    expect(mockUpdateReturning).toHaveBeenCalled();
  });

  it("reports remaining attempts count accurately in the error message", async () => {
    (otpService.verifyOTPHash as jest.Mock).mockReturnValue(false);
    mockFindFirstVerifications.mockResolvedValue({
      ...ACTIVE_OTP_RECORD,
      attempts: 3, // 3 used → 1 remaining after this failure
    });
    // After atomic increment, DB returns attempts = 4
    mockUpdateReturning.mockResolvedValue([{ attempts: 4 }]);

    const request = makeRequest(
      { code: "000000", action: "delete_account" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("1 attempt remaining");
  });

  // ── Race condition guards ──────────────────────────────────────────────────

  it("returns 429 when a concurrent request already pushed attempts to the cap", async () => {
    (otpService.verifyOTPHash as jest.Mock).mockReturnValue(false);
    // Atomic increment matches 0 rows → cap was already hit by a race
    mockUpdateReturning.mockResolvedValue([]);

    const request = makeRequest(
      { code: "000000", action: "delete_account" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);

    expect(response.status).toBe(429);
  });

  it("returns 400 when a concurrent request already consumed the OTP", async () => {
    // Valid code but conditional delete matches 0 rows → already consumed
    mockDeleteReturning.mockResolvedValue([]);

    const request = makeRequest(
      { code: "123456", action: "delete_account" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.detail).toContain("already been used");
  });

  // ── Action scoping ─────────────────────────────────────────────────────────

  it("returns 400 when no OTP exists for the requested action (cross-action replay attempt)", async () => {
    // OTP was issued for change_password but request asks for delete_account
    mockFindFirstVerifications.mockResolvedValue(null);

    const request = makeRequest(
      { code: "123456", action: "delete_account" },
      { authorization: "Bearer valid-access-token" },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.detail).toContain("No active verification code found");
  });
});
