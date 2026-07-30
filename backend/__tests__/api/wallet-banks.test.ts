import { GET, POST, PUT, DELETE } from "../../src/api/wallet/banks/route";
import { getAuthPayload } from "../../src/lib/auth-session";
import { NextRequest } from "next/server";

jest.mock("../../src/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("../../src/lib/db", () => {
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const insert = jest.fn();
  const values = jest.fn();
  const returning = jest.fn();
  const update = jest.fn();
  const set = jest.fn();
  const where = jest.fn();
  const deleteFn = jest.fn();

  return {
    db: {
      insert: jest.fn(() => ({ values: values.mockReturnValue({ returning }) })),
      update: jest.fn(() => ({ set: set.mockReturnValue({ where }) })),
      delete: jest.fn(() => ({ where })),
      query: {
        bankAccounts: {
          findMany,
          findFirst,
        },
      },
    },
    __mocks: {
      findMany,
      findFirst,
      insert,
      values,
      returning,
      update,
      set,
      where,
      deleteFn,
    },
  };
});

describe("wallet bank account routes", () => {
  const mockGetAuthPayload = getAuthPayload as jest.Mock;
  const { __mocks } = require("../../src/lib/db");

  beforeEach(() => {
    jest.clearAllMocks();
    __mocks.findMany.mockReset();
    __mocks.findFirst.mockReset();
    __mocks.values.mockReset();
    __mocks.returning.mockReset();
    __mocks.set.mockReset();
    __mocks.where.mockReset();
    __mocks.insert.mockReset();
    __mocks.update.mockReset();
    __mocks.deleteFn.mockReset();

    __mocks.values.mockReturnValue({ returning: __mocks.returning });
    __mocks.returning.mockResolvedValue([]);
    __mocks.set.mockReturnValue({ where: __mocks.where });
    __mocks.where.mockReturnValue({ returning: __mocks.returning });
  });

  it("returns 401 for unauthenticated list requests", async () => {
    mockGetAuthPayload.mockResolvedValue(null);

    const req = new NextRequest("http://localhost:3000/api/wallet/banks");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.title).toBe("Unauthorized");
  });

  it("lists the authenticated user's bank accounts", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    __mocks.findMany.mockResolvedValue([
      {
        id: "acc-1",
        bankName: "First Bank",
        accountName: "Ada Lovelace",
        accountNumberLast4: "4242",
        country: "NG",
        currency: "NGN",
        isDefault: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const req = new NextRequest("http://localhost:3000/api/wallet/banks");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].accountNumberLast4).toBe("4242");
  });

  it("creates a new bank account with validation", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-2" });
    const returnedAccount = {
      id: "acc-2",
      userId: "user-2",
      bankName: "Access Bank",
      accountName: "Grace Hopper",
      accountNumberLast4: "1234",
      country: "NG",
      currency: "NGN",
      isDefault: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    __mocks.returning.mockResolvedValue([returnedAccount]);

    const req = new NextRequest("http://localhost:3000/api/wallet/banks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bankName: "Access Bank",
        accountName: "Grace Hopper",
        accountNumber: "1234567890",
        country: "NG",
        currency: "NGN",
      }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.account.bankName).toBe("Access Bank");
  });

  it("rejects invalid account numbers on create", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-3" });

    const req = new NextRequest("http://localhost:3000/api/wallet/banks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bankName: "Access Bank",
        accountName: "Grace Hopper",
        accountNumber: "12",
        country: "NG",
        currency: "NGN",
      }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.title).toBe("Bad Request");
  });

  it("updates an existing bank account owned by the user", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-4" });
    __mocks.findFirst.mockResolvedValueOnce({
      id: "acc-3",
      userId: "user-4",
      bankName: "GTB",
      accountName: "Alice",
      accountNumberLast4: "1111",
      country: "NG",
      currency: "NGN",
      isDefault: false,
    });
    __mocks.returning.mockResolvedValueOnce([
      {
        id: "acc-3",
        userId: "user-4",
        bankName: "Zenith",
        accountName: "Alice",
        accountNumberLast4: "5555",
        country: "NG",
        currency: "NGN",
        isDefault: false,
      },
    ]);

    const req = new NextRequest("http://localhost:3000/api/wallet/banks/11111111-1111-1111-1111-111111111111", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bankName: "Zenith",
        accountName: "Alice",
        accountNumber: "5555555555",
        country: "NG",
        currency: "NGN",
      }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.account.bankName).toBe("Zenith");
  });

  it("prevents updating another user's bank account", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-5" });
    __mocks.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "acc-4",
      userId: "user-9",
      bankName: "GTB",
      accountName: "Bob",
      accountNumberLast4: "2222",
      country: "NG",
      currency: "NGN",
      isDefault: false,
    });

    const req = new NextRequest("http://localhost:3000/api/wallet/banks/22222222-2222-2222-2222-222222222222", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bankName: "Zenith",
        accountName: "Bob",
        accountNumber: "4444444444",
        country: "NG",
        currency: "NGN",
      }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: "22222222-2222-2222-2222-222222222222" }) });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.title).toBe("Forbidden");
  });

  it("deletes a bank account that belongs to the user", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-6" });
    __mocks.findFirst.mockResolvedValueOnce({
      id: "acc-5",
      userId: "user-6",
      bankName: "First Bank",
      accountName: "Carol",
      accountNumberLast4: "9999",
      country: "NG",
      currency: "NGN",
      isDefault: false,
    });

    const req = new NextRequest("http://localhost:3000/api/wallet/banks/33333333-3333-3333-3333-333333333333", {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: "33333333-3333-3333-3333-333333333333" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
