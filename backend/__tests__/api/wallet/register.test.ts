import { NextRequest } from "next/server";
import { POST } from "../../../src/api/wallet/register/route";
import { getAuthPayload } from "../../../src/lib/auth-session";

// Valid Stellar Ed25519 public keys (56-character G-addresses)
const VALID_STELLAR_ADDRESS = "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN";
const ANOTHER_VALID_ADDRESS = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGCQTYYT45SHK4XCTQMWLS";

jest.mock("../../../src/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("@stellar/stellar-sdk", () => ({
  StrKey: {
    isValidEd25519PublicKey: jest.fn((key: string) => {
      // Simulate real Stellar validation: valid G-addresses are 56 chars starting with G
      return typeof key === "string" && key.startsWith("G") && key.length === 56;
    }),
  },
}));

jest.mock("../../../src/lib/db", () => {
  const selectReturning = jest.fn();
  const updateSet = jest.fn();

  return {
    db: {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: selectReturning,
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: updateSet,
        })),
      })),
    },
    __mocks: {
      selectReturning,
      updateSet,
    },
  };
});

const mockGetAuthPayload = getAuthPayload as jest.Mock;
const { __mocks } = require("../../../src/lib/db");

function makeRequest(body?: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/wallet/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/wallet/register", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────
  // Authentication
  // ──────────────────────────────────────────────
  it("returns 401 when no auth token is provided", async () => {
    mockGetAuthPayload.mockResolvedValue(null);

    const res = await POST(makeRequest({ stellarAddress: VALID_STELLAR_ADDRESS }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.title).toBe("Unauthorized");
  });

  // ──────────────────────────────────────────────
  // Input validation
  // ──────────────────────────────────────────────
  it("returns 400 when stellarAddress is missing", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });

    const res = await POST(makeRequest({}));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.title).toBe("Bad Request");
    expect(body.detail).toContain("stellarAddress is required");
  });

  it("returns 400 when stellarAddress is an empty string", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });

    const res = await POST(makeRequest({ stellarAddress: "   " }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.title).toBe("Bad Request");
  });

  it("returns 400 when stellarAddress is not a string", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });

    const res = await POST(makeRequest({ stellarAddress: 12345 }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.title).toBe("Bad Request");
  });

  it("returns 400 when stellarAddress fails Stellar key validation", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });

    // "INVALID" does not start with G and is not 56 chars
    const res = await POST(makeRequest({ stellarAddress: "INVALID_NOT_A_STELLAR_KEY" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.title).toBe("Bad Request");
    expect(body.detail).toContain("Invalid Stellar public address");
  });

  // ──────────────────────────────────────────────
  // Successful registration
  // ──────────────────────────────────────────────
  it("returns 201 and registers the Stellar address for the authenticated user", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });

    // First select: fetch current user (no address yet)
    // Second select: check address uniqueness (not claimed)
    __mocks.selectReturning
      .mockResolvedValueOnce([{ id: "user-1", stellarAddress: null }])
      .mockResolvedValueOnce([]);

    __mocks.updateSet.mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest({ stellarAddress: VALID_STELLAR_ADDRESS }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.stellarAddress).toBe(VALID_STELLAR_ADDRESS);
    expect(body.message).toBe("Stellar address registered successfully");
  });

  // ──────────────────────────────────────────────
  // Idempotency
  // ──────────────────────────────────────────────
  it("returns 200 when the same Stellar address is already registered to the current user", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-2" });

    // User already has this exact address — idempotent response
    __mocks.selectReturning.mockResolvedValueOnce([
      { id: "user-2", stellarAddress: VALID_STELLAR_ADDRESS },
    ]);

    const res = await POST(makeRequest({ stellarAddress: VALID_STELLAR_ADDRESS }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.stellarAddress).toBe(VALID_STELLAR_ADDRESS);
    expect(body.message).toBe("Stellar address already registered");
  });

  // ──────────────────────────────────────────────
  // Uniqueness
  // ──────────────────────────────────────────────
  it("returns 409 when the Stellar address is already claimed by another user", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-3" });

    // Current user has no address yet
    __mocks.selectReturning
      .mockResolvedValueOnce([{ id: "user-3", stellarAddress: null }])
      // Address belongs to a different user
      .mockResolvedValueOnce([{ id: "user-99" }]);

    const res = await POST(makeRequest({ stellarAddress: VALID_STELLAR_ADDRESS }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.title).toBe("Conflict");
    expect(body.detail).toContain("already registered to another account");
  });

  // ──────────────────────────────────────────────
  // User not found edge case
  // ──────────────────────────────────────────────
  it("returns 404 when the authenticated user is not found in the database", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "ghost-user" });

    __mocks.selectReturning.mockResolvedValueOnce([]);

    const res = await POST(makeRequest({ stellarAddress: VALID_STELLAR_ADDRESS }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.title).toBe("Not Found");
  });

  // ──────────────────────────────────────────────
  // Error handling
  // ──────────────────────────────────────────────
  it("returns 500 when a database error is thrown", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-5" });

    __mocks.selectReturning.mockRejectedValueOnce(new Error("DB connection error"));

    const res = await POST(makeRequest({ stellarAddress: VALID_STELLAR_ADDRESS }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.title).toBe("Internal Server Error");
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-6" });

    const req = new NextRequest("http://localhost/api/wallet/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.title).toBe("Bad Request");
  });

  it("returns 400 when the request body is JSON null", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-null" });

    const req = new NextRequest("http://localhost/api/wallet/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.title).toBe("Bad Request");
    expect(body.detail).toContain("stellarAddress is required");
  });

  // ──────────────────────────────────────────────
  // Address update (replacing an existing address)
  // ──────────────────────────────────────────────
  it("returns 201 when the user registers a new address, replacing their old one", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-7" });

    // User currently has a different address
    __mocks.selectReturning
      .mockResolvedValueOnce([{ id: "user-7", stellarAddress: ANOTHER_VALID_ADDRESS }])
      // New address is not taken
      .mockResolvedValueOnce([]);

    __mocks.updateSet.mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest({ stellarAddress: VALID_STELLAR_ADDRESS }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.stellarAddress).toBe(VALID_STELLAR_ADDRESS);
  });

  // ──────────────────────────────────────────────
  // Concurrent registration (PostgreSQL 23505)
  // ──────────────────────────────────────────────
  it("returns 200 when a concurrent request by the same user wins the race (23505 + self owns address)", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-8" });

    // Step 4: fetch user — no address yet
    // Step 6: uniqueness check — address not yet taken
    __mocks.selectReturning
      .mockResolvedValueOnce([{ id: "user-8", stellarAddress: null }])
      .mockResolvedValueOnce([]);

    // Step 7: update throws a PG unique constraint violation
    const pgError = Object.assign(new Error("unique constraint"), { code: "23505" });
    __mocks.updateSet.mockRejectedValueOnce(pgError);

    // Re-read after 23505: the user now owns the address (their own concurrent write succeeded)
    __mocks.selectReturning.mockResolvedValueOnce([
      { id: "user-8", stellarAddress: VALID_STELLAR_ADDRESS },
    ]);

    const res = await POST(makeRequest({ stellarAddress: VALID_STELLAR_ADDRESS }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.stellarAddress).toBe(VALID_STELLAR_ADDRESS);
    expect(body.message).toBe("Stellar address already registered");
  });

  it("returns 409 when a different user wins the concurrent race (23505 + other user owns address)", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-9" });

    // Step 4: fetch user — no address yet
    // Step 6: uniqueness check — address not yet taken at that instant
    __mocks.selectReturning
      .mockResolvedValueOnce([{ id: "user-9", stellarAddress: null }])
      .mockResolvedValueOnce([]);

    // Step 7: update throws a PG unique constraint violation
    const pgError = Object.assign(new Error("unique constraint"), { code: "23505" });
    __mocks.updateSet.mockRejectedValueOnce(pgError);

    // Re-read after 23505: this user still has no address (another user claimed it)
    __mocks.selectReturning.mockResolvedValueOnce([
      { id: "user-9", stellarAddress: null },
    ]);

    const res = await POST(makeRequest({ stellarAddress: VALID_STELLAR_ADDRESS }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.title).toBe("Conflict");
    expect(body.detail).toContain("already registered to another account");
  });
});