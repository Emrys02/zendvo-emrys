import { NextRequest } from "next/server";

jest.mock("drizzle-orm", () => ({
  eq: jest.fn(() => ({})),
  and: jest.fn(() => ({})),
  or: jest.fn(() => ({})),
  inArray: jest.fn(() => ({})),
}));

const makeChainable = () => {
  const chain: any = {};
  chain.where = jest.fn().mockResolvedValue([]);
  chain.set = jest.fn().mockReturnValue(chain);
  chain.returning = jest.fn().mockResolvedValue([]);
  return chain;
};

jest.mock("@/lib/db", () => ({
  db: {
    query: {
      users: {
        findFirst: jest.fn(),
      },
      gifts: {
        findMany: jest.fn(),
      },
    },
    delete: jest.fn(() => makeChainable()),
    update: jest.fn(() => makeChainable()),
    transaction: jest.fn(async (cb: any) => {
      const tx = {
        delete: jest.fn(() => makeChainable()),
        update: jest.fn(() => makeChainable()),
      };
      return await cb(tx);
    }),
  },
}));

jest.mock("@/lib/db/schema", () => ({
  users: { id: "id" },
  emailVerifications: { userId: "user_id" },
  passwordResets: { userId: "user_id" },
  refreshTokens: { userId: "user_id" },
  gifts: { senderId: "sender_id", recipientId: "recipient_id", id: "id", status: "status" },
  wallets: { userId: "user_id" },
  notifications: { userId: "user_id" },
  bankAccounts: { userId: "user_id" },
  transactions: { userId: "user_id" },
}));

jest.mock("@/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  comparePassword: jest.fn(),
}));

jest.mock("@/server/services/otpService", () => ({
  verifyOTP: jest.fn(),
}));

jest.mock("@/server/services/auditService", () => ({
  logAuditEvent: jest.fn(),
  AuditEventType: { ACCOUNT_UNLOCKED: "ACCOUNT_UNLOCKED" },
}));

jest.mock("@/lib/api-utils", () => ({
  createProblemDetails: jest.fn(
    (_type: string, _title: string, status: number, detail: string) => {
      return new Response(JSON.stringify({ status, detail }), {
        status,
        headers: { "Content-Type": "application/problem+json" },
      });
    },
  ),
}));

import { db } from "@/lib/db";
import { getAuthPayload } from "@/lib/auth-session";
import { verifyOTP } from "@/server/services/otpService";
import { comparePassword } from "@/lib/auth";
import { logAuditEvent } from "@/server/services/auditService";

describe("DELETE /api/users/account", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const makeRequest = (body: Record<string, unknown>) =>
    new NextRequest("http://localhost/api/users/account", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const mockUser = {
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    passwordHash: "hashed-password",
    status: "active",
  };

  it("returns 401 when not authenticated", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue(null);
    const { DELETE } = await import("@/api/users/security/route");

    const response = await DELETE(makeRequest({ password: "pass", otp: "123456" }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.detail).toBe("Unauthorized");
  });

  it("returns 400 when password is missing", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });
    const { DELETE } = await import("@/api/users/security/route");

    const response = await DELETE(makeRequest({ otp: "123456" }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.detail).toBe("Password and OTP are required for account deletion");
  });

  it("returns 400 when otp is missing", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });
    const { DELETE } = await import("@/api/users/security/route");

    const response = await DELETE(makeRequest({ password: "pass" }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.detail).toBe("Password and OTP are required for account deletion");
  });

  it("returns 404 when user not found", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue(null);
    const { DELETE } = await import("@/api/users/security/route");

    const response = await DELETE(makeRequest({ password: "pass", otp: "123456" }));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.detail).toBe("User not found");
  });

  it("returns 403 when account is suspended", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue({
      ...mockUser,
      status: "suspended",
    });
    const { DELETE } = await import("@/api/users/security/route");

    const response = await DELETE(makeRequest({ password: "pass", otp: "123456" }));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.detail).toBe("Account is suspended");
  });

  it("returns 401 when password is invalid", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);
    (comparePassword as jest.Mock).mockResolvedValue(false);
    const { DELETE } = await import("@/api/users/security/route");

    const response = await DELETE(makeRequest({ password: "wrong", otp: "123456" }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.detail).toBe("Invalid password");
  });

  it("returns 403 when OTP verification fails", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);
    (comparePassword as jest.Mock).mockResolvedValue(true);
    (verifyOTP as jest.Mock).mockResolvedValue({
      success: false,
      message: "Invalid OTP",
    });
    const { DELETE } = await import("@/api/users/security/route");

    const response = await DELETE(makeRequest({ password: "pass", otp: "000000" }));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.detail).toBe("Invalid OTP");
  });

  it("deletes account successfully with no gifts", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);
    (comparePassword as jest.Mock).mockResolvedValue(true);
    (verifyOTP as jest.Mock).mockResolvedValue({ success: true });
    (db.query.gifts.findMany as jest.Mock).mockResolvedValue([]);

    const { DELETE } = await import("@/api/users/security/route");
    const response = await DELETE(makeRequest({ password: "pass", otp: "123456" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toBe("Account deleted successfully");
    expect(json.deletedSentGifts).toBe(0);
    expect(json.deletedReceivedGifts).toBe(0);
    expect(db.transaction).toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalled();
  });

  it("deletes account and cleans up gifts", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);
    (comparePassword as jest.Mock).mockResolvedValue(true);
    (verifyOTP as jest.Mock).mockResolvedValue({ success: true });
    (db.query.gifts.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: "gift-1", status: "pending_otp" }])
      .mockResolvedValueOnce([{ id: "gift-2", status: "completed" }]);

    const { DELETE } = await import("@/api/users/security/route");
    const response = await DELETE(makeRequest({ password: "pass", otp: "123456" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.deletedSentGifts).toBe(1);
    expect(json.deletedReceivedGifts).toBe(1);
  });
});
