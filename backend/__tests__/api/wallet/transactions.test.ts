import { NextRequest } from "next/server";
import { GET } from "@/app/api/wallet/transactions/route";
import { db } from "@/lib/db";
import { getAuthPayload } from "@/lib/auth-session";

jest.mock("drizzle-orm", () => ({
  eq: jest.fn(() => ({})),
  or: jest.fn(() => ({})),
  desc: jest.fn(() => ({})),
}));

jest.mock("@/lib/db", () => ({
  db: {
    select: jest.fn(),
  },
}));

jest.mock("@/lib/db/schema", () => ({
  gifts: {
    id: "id",
    recipientId: "recipient_id",
    senderId: "sender_id",
    amount: "amount",
    currency: "currency",
    status: "status",
    createdAt: "created_at",
  },
  transactions: {
    id: "id",
    userId: "user_id",
    type: "type",
    status: "status",
    amount: "amount",
    currency: "currency",
    createdAt: "created_at",
  },
}));

jest.mock("@/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

const makeRequest = (overrides?: { page?: number; limit?: number; type?: string; status?: string }) => {
  const params = new URLSearchParams();
  if (overrides?.page) params.set("page", String(overrides.page));
  if (overrides?.limit) params.set("limit", String(overrides.limit));
  if (overrides?.type) params.set("type", overrides.type);
  if (overrides?.status) params.set("status", overrides.status);
  const url = `http://localhost/api/wallet/transactions?${params.toString()}`;
  return new NextRequest(url, { method: "GET" });
};

describe("GET /api/wallet/transactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue(null);
    const response = await GET(makeRequest());
    const json = await response.json();
    expect(response.status).toBe(401);
    expect(json.detail).toBe("Unauthorized");
  });

  it("returns 400 for invalid type", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });
    const response = await GET(makeRequest({ type: "invalid_type" }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.detail).toContain("Invalid type");
  });

  it("returns 400 for invalid status", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });
    const response = await GET(makeRequest({ status: "invalid_status" }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.detail).toContain("Invalid status");
  });

  it("aggregates gifts and transactions into a unified feed", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });

    const now = new Date("2024-06-01T00:00:00Z");
    const giftReceived = [
      {
        id: "gift-recv-1",
        recipientId: "user-1",
        senderId: "user-2",
        amount: 50,
        currency: "USDC",
        status: "completed",
        createdAt: now,
      },
    ];
    const giftSent = [
      {
        id: "gift-sent-1",
        recipientId: "user-3",
        senderId: "user-1",
        amount: 25,
        currency: "USDC",
        status: "pending_otp",
        createdAt: new Date("2024-05-30T00:00:00Z"),
      },
    ];
    const txDeposit = [
      {
        id: "tx-dep-1",
        userId: "user-1",
        type: "deposit",
        status: "completed",
        amount: 100,
        currency: "USDC",
        createdAt: new Date("2024-05-29T00:00:00Z"),
      },
    ];
    const txWithdrawal = [
      {
        id: "tx-wd-1",
        userId: "user-1",
        type: "withdrawal",
        status: "failed",
        amount: 20,
        currency: "USDC",
        createdAt: new Date("2024-05-28T00:00:00Z"),
      },
    ];

    const buildChain = (data: any[]) => {
      const orderByMock = jest.fn().mockResolvedValue(data);
      const whereMock = jest.fn(() => ({ orderBy: orderByMock }));
      const fromMock = jest.fn(() => ({ where: whereMock }));
      return { from: fromMock };
    };

    const selectMock = jest
      .fn()
      .mockImplementationOnce(() => buildChain([...giftReceived, ...giftSent]))
      .mockImplementationOnce(() => buildChain([...txDeposit, ...txWithdrawal]));

    (db.select as jest.Mock).mockImplementation(selectMock);

    const response = await GET(makeRequest({ page: "1", limit: "10" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toHaveLength(4);
    expect(json.total).toBe(4);
    expect(json.page).toBe(1);
    expect(json.limit).toBe(10);

    const types = json.data.map((t: any) => t.type);
    expect(types).toContain("gift_received");
    expect(types).toContain("gift_sent");
    expect(types).toContain("top_up");
    expect(types).toContain("withdrawal");

    expect(json.data[0].id).toBe("gift-recv-1");
    expect(json.data[1].id).toBe("gift-sent-1");
    expect(json.data[2].id).toBe("tx-dep-1");
    expect(json.data[3].id).toBe("tx-wd-1");
  });

  it("filters by type", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });

    const gifts = [
      {
        id: "g1",
        recipientId: "user-1",
        senderId: "user-2",
        amount: 10,
        currency: "USDC",
        status: "completed",
        createdAt: new Date("2024-06-01T00:00:00Z"),
      },
    ];
    const txs = [
      {
        id: "t1",
        userId: "user-1",
        type: "deposit",
        status: "completed",
        amount: 10,
        currency: "USDC",
        createdAt: new Date("2024-05-30T00:00:00Z"),
      },
    ];

    const buildChain = (data: any[]) => {
      const orderByMock = jest.fn().mockResolvedValue(data);
      const whereMock = jest.fn(() => ({ orderBy: orderByMock }));
      const fromMock = jest.fn(() => ({ where: whereMock }));
      return { from: fromMock };
    };

    (db.select as jest.Mock).mockImplementation(
      jest.fn().mockImplementationOnce(() => buildChain(gifts)).mockImplementationOnce(() => buildChain(txs)),
    );

    const response = await GET(makeRequest({ type: "gift_received" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].type).toBe("gift_received");
  });

  it("filters by status", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });

    const gifts = [
      {
        id: "g1",
        recipientId: "user-1",
        senderId: "user-2",
        amount: 10,
        currency: "USDC",
        status: "completed",
        createdAt: new Date("2024-06-01T00:00:00Z"),
      },
      {
        id: "g2",
        recipientId: "user-1",
        senderId: "user-2",
        amount: 20,
        currency: "USDC",
        status: "failed",
        createdAt: new Date("2024-05-30T00:00:00Z"),
      },
    ];
    const txs: any[] = [];

    const buildChain = (data: any[]) => {
      const orderByMock = jest.fn().mockResolvedValue(data);
      const whereMock = jest.fn(() => ({ orderBy: orderByMock }));
      const fromMock = jest.fn(() => ({ where: whereMock }));
      return { from: fromMock };
    };

    (db.select as jest.Mock).mockImplementation(
      jest.fn().mockImplementationOnce(() => buildChain(gifts)).mockImplementationOnce(() => buildChain(txs)),
    );

    const response = await GET(makeRequest({ status: "completed" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].status).toBe("completed");
  });

  it("paginates results correctly", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });

    const gifts = Array.from({ length: 5 }, (_, i) => ({
      id: `g${i}`,
      recipientId: "user-1",
      senderId: "user-2",
      amount: 10 + i,
      currency: "USDC",
      status: "completed",
      createdAt: new Date(`2024-06-${String(5 - i).padStart(2, "0")}T00:00:00Z`),
    }));
    const txs: any[] = [];

    const buildChain = (data: any[]) => {
      const orderByMock = jest.fn().mockResolvedValue(data);
      const whereMock = jest.fn(() => ({ orderBy: orderByMock }));
      const fromMock = jest.fn(() => ({ where: whereMock }));
      return { from: fromMock };
    };

    (db.select as jest.Mock).mockImplementation(
      jest.fn().mockImplementationOnce(() => buildChain(gifts)).mockImplementationOnce(() => buildChain(txs)),
    );

    const response = await GET(makeRequest({ page: "2", limit: "2" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.page).toBe(2);
    expect(json.limit).toBe(2);
    expect(json.total).toBe(5);
  });
});
