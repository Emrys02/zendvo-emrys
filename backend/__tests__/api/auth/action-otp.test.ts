import { NextRequest } from "next/server";
import { POST as actionOtpPOST } from "@/api/auth/action-otp/route";
import { db } from "@/lib/db";
import * as authSession from "@/lib/auth-session";
import * as emailService from "@/server/services/emailService";
import * as otpService from "@/server/services/otpService";
import { resetCooldownStore, checkActionOtpCooldown } from "@/lib/middleware/rateLimit";

jest.mock("@/lib/db", () => ({
  db: {
    query: {
      users: {
        findFirst: jest.fn(),
      },
    },
  },
}));

jest.mock("@/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("@/server/services/otpService", () => ({
  generateOTP: jest.fn(() => "654321"),
  storeOTP: jest.fn().mockResolvedValue(undefined),
  checkOTPRequestRateLimitByUserId: jest.fn().mockResolvedValue({
    allowed: true,
    remainingRequests: 3,
    retryAfterMs: 0,
  }),
}));

jest.mock("@/server/services/emailService", () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue({ success: true }),
}));

describe("POST /api/auth/action-otp/send Endpoint", () => {
  const mockUser = {
    id: "user-abc-123",
    email: "user@example.com",
    name: "John Doe",
    status: "unverified",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetCooldownStore();
  });

  it("should return 401 Unauthorized if not authenticated", async () => {
    (authSession.getAuthPayload as jest.Mock).mockResolvedValue(null);

    const request = new NextRequest("http://localhost/api/auth/action-otp/send", {
      method: "POST",
      body: JSON.stringify({ action: "transfer_confirm" }),
    });

    const response = await actionOtpPOST(request);
    expect(response.status).toBe(401);
  });

  it("should send OTP successfully for authenticated user", async () => {
    (authSession.getAuthPayload as jest.Mock).mockResolvedValue({
      userId: mockUser.id,
      email: mockUser.email,
    });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);

    const request = new NextRequest("http://localhost/api/auth/action-otp/send", {
      method: "POST",
      body: JSON.stringify({ action: "transfer_confirm" }),
    });

    const response = await actionOtpPOST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.action).toBe("transfer_confirm");
    expect(otpService.storeOTP).toHaveBeenCalledWith(mockUser.id, "654321");
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
      mockUser.email,
      "654321",
      mockUser.name,
    );
  });

  it("should normalize unknown/unsupported action to 'default'", async () => {
    (authSession.getAuthPayload as jest.Mock).mockResolvedValue({
      userId: mockUser.id,
      email: mockUser.email,
    });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);

    const request = new NextRequest("http://localhost/api/auth/action-otp/send", {
      method: "POST",
      body: JSON.stringify({ action: "malicious_unbounded_action_123" }),
    });

    const response = await actionOtpPOST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.action).toBe("default");
  });

  it("should return 429 and Retry-After header when requested within 60s cooldown window", async () => {
    (authSession.getAuthPayload as jest.Mock).mockResolvedValue({
      userId: mockUser.id,
      email: mockUser.email,
    });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);

    const makeRequest = () =>
      new NextRequest("http://localhost/api/auth/action-otp/send", {
        method: "POST",
        body: JSON.stringify({ action: "transfer_confirm" }),
      });

    // First request - succeeds
    const firstRes = await actionOtpPOST(makeRequest());
    expect(firstRes.status).toBe(200);

    // Immediate second request - blocked by 60s cooldown
    const secondRes = await actionOtpPOST(makeRequest());
    expect(secondRes.status).toBe(429);
    expect(secondRes.headers.get("Retry-After")).toBe("60");

    const body = await secondRes.json();
    expect(body.detail).toContain("Rate limit exceeded");
  });

  it("should NOT record cooldown if email sending fails", async () => {
    (authSession.getAuthPayload as jest.Mock).mockResolvedValue({
      userId: mockUser.id,
      email: mockUser.email,
    });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);
    (emailService.sendVerificationEmail as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: "SMTP Error",
    });

    const request = new NextRequest("http://localhost/api/auth/action-otp/send", {
      method: "POST",
      body: JSON.stringify({ action: "withdraw" }),
    });

    const response = await actionOtpPOST(request);
    expect(response.status).toBe(500);

    // Verify cooldown store is empty / not recorded for this action
    expect(checkActionOtpCooldown(mockUser.id, "withdraw").isRateLimited).toBe(false);
  });

  it("should return 404 if authenticated user is not found in database", async () => {
    (authSession.getAuthPayload as jest.Mock).mockResolvedValue({
      userId: "non-existent-user",
      email: "missing@example.com",
    });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue(null);

    const request = new NextRequest("http://localhost/api/auth/action-otp/send", {
      method: "POST",
      body: JSON.stringify({ action: "withdraw" }),
    });

    const response = await actionOtpPOST(request);
    expect(response.status).toBe(404);
  });

  it("should return 403 if user account is suspended", async () => {
    (authSession.getAuthPayload as jest.Mock).mockResolvedValue({
      userId: mockUser.id,
      email: mockUser.email,
    });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue({
      ...mockUser,
      status: "suspended",
    });

    const request = new NextRequest("http://localhost/api/auth/action-otp/send", {
      method: "POST",
      body: JSON.stringify({ action: "withdraw" }),
    });

    const response = await actionOtpPOST(request);
    expect(response.status).toBe(403);
  });

  it("should return 429 if overall user OTP rate limit is exceeded", async () => {
    (authSession.getAuthPayload as jest.Mock).mockResolvedValue({
      userId: mockUser.id,
      email: mockUser.email,
    });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);
    (otpService.checkOTPRequestRateLimitByUserId as jest.Mock).mockResolvedValue({
      allowed: false,
      remainingRequests: 0,
      retryAfterMs: 300000,
      message: "Too many OTP requests. Please wait 5 minutes.",
    });

    const request = new NextRequest("http://localhost/api/auth/action-otp/send", {
      method: "POST",
      body: JSON.stringify({ action: "profile_update" }),
    });

    const response = await actionOtpPOST(request);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("300");
  });
});
