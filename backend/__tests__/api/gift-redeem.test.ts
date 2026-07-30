import { POST } from "../../src/api/gifts/redeem/route";
import { db } from "../../src/lib/db";
import { gifts, wallets, transactions, notifications } from "../../src/lib/db/schema";
import { getAuthPayload } from "../../src/lib/auth-session";
import { NextRequest } from "next/server";

jest.mock("../../src/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("../../src/lib/soroban", () => ({
  buildSorobanRedeemTx: jest.fn(() => ({
    contractId: "CC_TEST_CONTRACT",
    txHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    unsignedXdr: "AAAAAgAAAABzdHJlYW1pbmcgdGV4dA==",
  })),
}));

jest.mock("../../src/lib/db", () => {
  const mockGifts: any[] = [];
  const mockWallets: any[] = [];
  const mockTransactions: any[] = [];
  const mockNotifications: any[] = [];

  return {
    db: {
      query: {
        gifts: {
          findFirst: jest.fn(async ({ where }: any) => {
            return mockGifts[0] || null;
          }),
        },
        wallets: {
          findFirst: jest.fn(async () => null),
        },
      },
      transaction: jest.fn(async (callback: any) => {
        const tx = {
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockResolvedValue([]),
          }),
          query: {
            wallets: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
          },
        };
        return await callback(tx);
      }),
    },
    __mockGifts: mockGifts,
    __mockWallets: mockWallets,
  };
});

describe("POST /api/gifts/:id/redeem", () => {
  const mockGetAuthPayload = getAuthPayload as jest.Mock;
  const { __mockGifts } = require("../../src/lib/db");

  beforeEach(() => {
    jest.clearAllMocks();
    __mockGifts.length = 0;
  });

  it("should return 401 Unauthorized if request is not authenticated", async () => {
    mockGetAuthPayload.mockResolvedValue(null);

    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/redeem", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(401);
  });

  it("should return 404 Not Found if gift does not exist", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-recipient" });

    const req = new NextRequest("http://localhost:3000/api/gifts/gift-nonexistent/redeem", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "gift-nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("should return 403 Forbidden if logged in user is not the gift recipient", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "other-user" });
    __mockGifts.push({
      id: "gift-1",
      recipientId: "user-recipient",
      senderId: "user-sender",
      amount: 50,
      currency: "USDC",
      status: "confirmed",
      unlockDatetime: new Date(Date.now() - 10000),
    });

    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/redeem", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(403);
  });

  it("should return 400 Bad Request if time-lock has not expired", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-recipient" });
    const futureDate = new Date(Date.now() + 86400000); // 1 day in future
    __mockGifts.push({
      id: "gift-1",
      recipientId: "user-recipient",
      senderId: "user-sender",
      amount: 50,
      currency: "USDC",
      status: "confirmed",
      unlockDatetime: futureDate,
    });

    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/redeem", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.title).toContain("Gift Locked");
  });

  it("should return 400 Bad Request if gift has already been redeemed", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-recipient" });
    const pastDate = new Date(Date.now() - 10000);
    __mockGifts.push({
      id: "gift-1",
      recipientId: "user-recipient",
      senderId: "user-sender",
      amount: 50,
      currency: "USDC",
      status: "completed",
      unlockDatetime: pastDate,
    });

    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/redeem", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.title).toBe("Already Claimed");
  });

  it("should successfully redeem gift when unlocked and recipient matches", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-recipient" });
    const pastDate = new Date(Date.now() - 10000);
    __mockGifts.push({
      id: "gift-1",
      recipientId: "user-recipient",
      senderId: "user-sender",
      amount: 50,
      currency: "USDC",
      status: "confirmed",
      unlockDatetime: pastDate,
    });

    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/redeem", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("redeemed successfully");
    expect(body.soroban).toBeDefined();
    expect(body.soroban.unsignedXdr).toBeDefined();
    expect(body.soroban.unsignedXdr).not.toBe("AAAA...");
    expect(body.soroban.txHash).toHaveLength(64);
  });

  it("should extract giftId from request body if context params are missing", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-recipient" });
    const pastDate = new Date(Date.now() - 10000);
    __mockGifts.push({
      id: "gift-2",
      recipientId: "user-recipient",
      senderId: "user-sender",
      amount: 100,
      currency: "USDC",
      status: "confirmed",
      unlockDatetime: pastDate,
    });

    const req = new NextRequest("http://localhost:3000/api/gifts/redeem", {
      method: "POST",
      body: JSON.stringify({ id: "gift-2" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
