import { GET } from "../../src/api/wallet/balance/route";
import { getAuthPayload } from "../../src/lib/auth-session";
import { NextRequest } from "next/server";

jest.mock("../../src/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("../../src/lib/db", () => {
  const where = jest.fn();
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  return {
    db: { select },
    __mocks: { select, from, where },
  };
});

describe("GET /api/wallet/balance", () => {
  const mockGetAuthPayload = getAuthPayload as jest.Mock;
  const { __mocks } = require("../../src/lib/db");

  beforeEach(() => {
    jest.clearAllMocks();
    __mocks.select.mockReturnValue({ from: __mocks.from });
    __mocks.from.mockReturnValue({ where: __mocks.where });
  });

  it("returns 401 when the user is not authenticated", async () => {
    mockGetAuthPayload.mockResolvedValue(null);

    const req = new NextRequest("http://localhost:3000/api/wallet/balance");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.title).toBe("Unauthorized");
    expect(__mocks.select).not.toHaveBeenCalled();
  });

  it("returns zero balance when the user has no wallets", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    __mocks.where.mockResolvedValue([]);

    const req = new NextRequest("http://localhost:3000/api/wallet/balance");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      balance: {
        amount: 0,
        currency: "USDC",
        formatted: "0.00 USDC",
        updatedAt: null,
      },
      balances: [],
      displayCurrency: "USDC",
    });
  });

  it("returns the authenticated user's USDC balance for the Wallet screen", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-2" });
    const updatedAt = new Date("2026-07-26T12:00:00.000Z");
    __mocks.where.mockResolvedValue([
      { currency: "USDC", balance: 250.5, updatedAt },
      { currency: "NGN", balance: 100000, updatedAt },
    ]);

    const req = new NextRequest("http://localhost:3000/api/wallet/balance");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.balance).toEqual({
      amount: 250.5,
      currency: "USDC",
      formatted: "250.50 USDC",
      updatedAt: "2026-07-26T12:00:00.000Z",
    });
    expect(body.balances).toHaveLength(2);
    expect(body.displayCurrency).toBe("USDC");
  });

  it("maps USDT display requests to the platform USDC wallet", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-3" });
    __mocks.where.mockResolvedValue([
      {
        currency: "USDC",
        balance: 42,
        updatedAt: new Date("2026-07-26T15:00:00.000Z"),
      },
    ]);

    const req = new NextRequest(
      "http://localhost:3000/api/wallet/balance?currency=USDT",
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.balance.currency).toBe("USDC");
    expect(body.balance.amount).toBe(42);
    expect(body.balance.formatted).toBe("42.00 USDC");
  });

  it("returns a specific currency when requested", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-4" });
    __mocks.where.mockResolvedValue([
      { currency: "USDC", balance: 10, updatedAt: new Date() },
      { currency: "NGN", balance: 5000, updatedAt: new Date() },
    ]);

    const req = new NextRequest(
      "http://localhost:3000/api/wallet/balance?currency=NGN",
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.balance.currency).toBe("NGN");
    expect(body.balance.amount).toBe(5000);
    expect(body.balance.formatted).toBe("5000.00 NGN");
  });

  it("returns 500 when the database query fails", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-5" });
    __mocks.where.mockRejectedValue(new Error("db down"));

    const req = new NextRequest("http://localhost:3000/api/wallet/balance");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.title).toBe("Internal Server Error");
  });
});
