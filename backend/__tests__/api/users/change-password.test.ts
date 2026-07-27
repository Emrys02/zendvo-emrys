import { NextRequest } from "next/server";
import { comparePassword, hashPassword } from "@/lib/auth";
import { getAuthPayload } from "@/lib/auth-session";
import { validatePassword } from "@/lib/validation";

const selectLimitMock = jest.fn();
const selectWhereMock = jest.fn(() => ({ limit: selectLimitMock }));
const selectFromMock = jest.fn(() => ({ where: selectWhereMock }));
const selectMock = jest.fn(() => ({ from: selectFromMock }));

const txUpdateWhereMock = jest.fn();
const txUpdateSetMock = jest.fn(() => ({ where: txUpdateWhereMock }));
const txUpdateMock = jest.fn(() => ({ set: txUpdateSetMock }));

const transactionMock = jest.fn(
  async (callback: (tx: { update: typeof txUpdateMock }) => Promise<void>) => {
    await callback({ update: txUpdateMock });
  },
);

jest.mock("drizzle-orm", () => ({
  eq: jest.fn(() => ({})),
}));

jest.mock("@/lib/db", () => ({
  db: {
    select: selectMock,
    transaction: transactionMock,
  },
}));

jest.mock("@/lib/db/schema", () => ({
  users: { id: "id", passwordHash: "passwordHash" },
  refreshTokens: {},
}));

jest.mock("@/lib/auth", () => ({
  comparePassword: jest.fn(),
  hashPassword: jest.fn(),
}));

jest.mock("@/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("@/lib/validation", () => ({
  validatePassword: jest.fn(),
}));

const headers = { "Content-Type": "application/json" };

describe("POST /api/users/change-password", () => {
  const validCurrentPassword = "OldP@ss123";
  const validNewPassword = "NewStrongP@ss1";
  const hashedNewPassword = "hashed-new-password";

  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthPayload as jest.Mock).mockResolvedValue({
      userId: "user-123",
      email: "test@example.com",
      role: "user",
    });
    (comparePassword as jest.Mock).mockResolvedValue(true);
    (hashPassword as jest.Mock).mockResolvedValue(hashedNewPassword);
    (validatePassword as jest.Mock).mockReturnValue(true);
  });

  it("should change password successfully with valid credentials", async () => {
    const { POST } = await import("@/app/api/users/change-password/route");
    selectLimitMock.mockResolvedValue([
      { id: "user-123", passwordHash: "hashed-current-password" },
    ]);

    const request = new NextRequest("http://localhost/api/users/change-password", {
      method: "POST",
      headers,
      body: JSON.stringify({
        currentPassword: validCurrentPassword,
        newPassword: validNewPassword,
        confirmNewPassword: validNewPassword,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toBe("Password has been changed successfully.");
    expect(comparePassword).toHaveBeenCalledWith(validCurrentPassword, "hashed-current-password");
    expect(hashPassword).toHaveBeenCalledWith(validNewPassword);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(txUpdateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: hashedNewPassword }),
    );
    expect(txUpdateWhereMock).toHaveBeenCalled();
  });

  it("should return 401 when not authenticated", async () => {
    const { POST } = await import("@/app/api/users/change-password/route");
    (getAuthPayload as jest.Mock).mockResolvedValue(null);

    const request = new NextRequest("http://localhost/api/users/change-password", {
      method: "POST",
      headers,
      body: JSON.stringify({
        currentPassword: validCurrentPassword,
        newPassword: validNewPassword,
        confirmNewPassword: validNewPassword,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.detail).toBe("Authentication required");
  });

  it("should return 400 when fields are missing", async () => {
    const { POST } = await import("@/app/api/users/change-password/route");

    const request = new NextRequest("http://localhost/api/users/change-password", {
      method: "POST",
      headers,
      body: JSON.stringify({
        newPassword: validNewPassword,
        confirmNewPassword: validNewPassword,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.detail).toBe("Current password, new password, and confirm new password are required");
  });

  it("should return 400 when new password and confirm password do not match", async () => {
    const { POST } = await import("@/app/api/users/change-password/route");

    const request = new NextRequest("http://localhost/api/users/change-password", {
      method: "POST",
      headers,
      body: JSON.stringify({
        currentPassword: validCurrentPassword,
        newPassword: validNewPassword,
        confirmNewPassword: "DifferentP@ss1",
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.detail).toBe("New password and confirm new password do not match");
  });

  it("should return 400 when new password is too weak", async () => {
    const { POST } = await import("@/app/api/users/change-password/route");
    (validatePassword as jest.Mock).mockReturnValue(false);

    const request = new NextRequest("http://localhost/api/users/change-password", {
      method: "POST",
      headers,
      body: JSON.stringify({
        currentPassword: validCurrentPassword,
        newPassword: "weak",
        confirmNewPassword: "weak",
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.detail).toContain("Password too weak");
  });

  it("should return 401 when current password is incorrect", async () => {
    const { POST } = await import("@/app/api/users/change-password/route");
    selectLimitMock.mockResolvedValue([
      { id: "user-123", passwordHash: "hashed-current-password" },
    ]);
    (comparePassword as jest.Mock).mockResolvedValue(false);

    const request = new NextRequest("http://localhost/api/users/change-password", {
      method: "POST",
      headers,
      body: JSON.stringify({
        currentPassword: "WrongP@ss123",
        newPassword: validNewPassword,
        confirmNewPassword: validNewPassword,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.detail).toBe("Current password is incorrect");
  });

  it("should return 400 for invalid JSON body", async () => {
    const { POST } = await import("@/app/api/users/change-password/route");

    const request = new NextRequest("http://localhost/api/users/change-password", {
      method: "POST",
      headers,
      body: "not-json",
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.detail).toBe("Request body must be valid JSON");
  });

  it("should return 500 on unexpected error", async () => {
    const { POST } = await import("@/app/api/users/change-password/route");
    (getAuthPayload as jest.Mock).mockRejectedValue(new Error("DB failure"));

    const request = new NextRequest("http://localhost/api/users/change-password", {
      method: "POST",
      headers,
      body: JSON.stringify({
        currentPassword: validCurrentPassword,
        newPassword: validNewPassword,
        confirmNewPassword: validNewPassword,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.detail).toBe("Internal server error");
  });
});
