import { NextRequest } from "next/server";
import { GET } from "@/app/api/users/resolve/route";
import { db } from "@/lib/db";
import { getAuthPayload } from "@/lib/auth-session";

// Import schema tokens so we can assert they are passed to eq/asc calls.
import { users, wallets } from "@/lib/db/schema";

// drizzle-orm: real identity implementations so we can inspect call args.
// eq(col, val) returns a recognisable tagged object; asc(col) likewise.
jest.mock("drizzle-orm", () => ({
  eq: jest.fn((col: unknown, val: unknown) => ({ __eq: { col, val } })),
  asc: jest.fn((col: unknown) => ({ __asc: col })),
}));

import { eq, asc } from "drizzle-orm";

jest.mock("@/lib/db", () => ({
  db: { select: jest.fn() },
}));

jest.mock("@/lib/db/schema", () => ({
  users: {
    id: "users.id",
    name: "users.name",
    avatarUrl: "users.avatarUrl",
    phoneNumber: "users.phoneNumber",
    email: "users.email",
  },
  wallets: {
    userId: "wallets.userId",
    currency: "wallets.currency",
    createdAt: "wallets.createdAt",
  },
}));

jest.mock("@/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

// --------------------------------------------------------------------------
// Request helpers
// --------------------------------------------------------------------------
const makePhoneRequest = (phoneNumber?: string) =>
  new NextRequest(
    phoneNumber
      ? `http://localhost/api/users/resolve?phoneNumber=${encodeURIComponent(phoneNumber)}`
      : "http://localhost/api/users/resolve",
    { method: "GET" },
  );

const makeEmailRequest = (email?: string) =>
  new NextRequest(
    email
      ? `http://localhost/api/users/resolve?email=${encodeURIComponent(email)}`
      : "http://localhost/api/users/resolve",
    { method: "GET" },
  );

// --------------------------------------------------------------------------
// Mock builder — returns captured spies for semantic assertion.
//
// Users chain:   select → from → where(eq) → limit
// Wallets chain: select → from → where(eq) → orderBy(asc) → limit
// --------------------------------------------------------------------------
function mockDbSelectChain(usersResult: unknown[], walletsResult: unknown[] = []) {
  let callCount = 0;

  const spies = {
    usersWhere: jest.fn(),
    walletsWhere: jest.fn(),
    walletsOrderBy: jest.fn(),
  };

  (db.select as jest.Mock).mockImplementation(() => {
    callCount++;

    if (callCount === 1) {
      // users query
      const limitMock = jest.fn().mockResolvedValue(usersResult);
      spies.usersWhere.mockReturnValue({ limit: limitMock });
      return { from: jest.fn(() => ({ where: spies.usersWhere })) };
    } else {
      // wallets query
      const limitMock = jest.fn().mockResolvedValue(walletsResult);
      spies.walletsOrderBy.mockReturnValue({ limit: limitMock });
      spies.walletsWhere.mockReturnValue({ orderBy: spies.walletsOrderBy });
      return { from: jest.fn(() => ({ where: spies.walletsWhere })) };
    }
  });

  return spies;
}

// --------------------------------------------------------------------------
describe("GET /api/users/resolve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Authentication ────────────────────────────────────────────────────────

  it("returns 401 when no auth token is provided", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue(null);

    const res = await GET(makePhoneRequest("+2348123456789"));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.detail).toBeDefined();
  });

  // ── Missing / conflicting params ──────────────────────────────────────────

  it("returns 400 when neither phoneNumber nor email is provided", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "s-1", email: "s@x.com", role: "user" });

    const res = await GET(makePhoneRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.detail).toContain("phoneNumber");
  });

  it("returns 400 when both phoneNumber and email are provided", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "s-2", email: "s@x.com", role: "user" });

    const url =
      "http://localhost/api/users/resolve?phoneNumber=%2B2348123456789&email=jane%40example.com";
    const res = await GET(new NextRequest(url, { method: "GET" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.detail).toContain("only one");
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it("returns 400 for an invalid phone number format", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "s-3", email: "s@x.com", role: "user" });

    const res = await GET(makePhoneRequest("not-a-phone"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.detail).toContain("Invalid phone number");
  });

  it("returns 400 for an invalid email format", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "s-4", email: "s@x.com", role: "user" });

    const res = await GET(makeEmailRequest("not-an-email"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.detail).toContain("Invalid email");
  });

  // ── Not found ─────────────────────────────────────────────────────────────

  it("returns 404 when no user matches the phone number", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "s-5", email: "s@x.com", role: "user" });
    mockDbSelectChain([]);

    const res = await GET(makePhoneRequest("+2348123456789"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.detail).toBeDefined();
  });

  it("returns 404 when no user matches the email", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "s-6", email: "s@x.com", role: "user" });
    mockDbSelectChain([]);

    const res = await GET(makeEmailRequest("nobody@example.com"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.detail).toBeDefined();
  });

  // ── Phone lookup — query semantics ────────────────────────────────────────

  it("queries users.phoneNumber with the sanitised E.164 value and returns public profile", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "s-7", email: "s@x.com", role: "user" });

    const spies = mockDbSelectChain(
      [
        {
          id: "r-uuid",
          name: "Jane Doe",
          avatarUrl: "https://cdn/a.jpg",
          email: "jane@example.com",
          phoneNumber: "+2348123456789",
        },
      ],
      [{ currency: "NGN" }],
    );

    const res = await GET(makePhoneRequest("+2348123456789"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe("r-uuid");
    expect(json.data.currency).toBe("NGN");

    // WHERE clause must use users.phoneNumber with the sanitised number
    expect(spies.usersWhere).toHaveBeenCalledWith(
      expect.objectContaining({ __eq: { col: users.phoneNumber, val: "+2348123456789" } }),
    );

    // Wallet query must be ordered by wallets.createdAt ASC
    expect(spies.walletsOrderBy).toHaveBeenCalledWith(
      expect.objectContaining({ __asc: wallets.createdAt }),
    );

    // Raw PII absent
    expect(json.data.email).toBeUndefined();
    expect(json.data.phoneNumber).toBeUndefined();
    expect(json.data.passwordHash).toBeUndefined();

    // Masked fields present and actually masked
    expect(json.data.maskedEmail).not.toBe("jane@example.com");
    expect(json.data.maskedPhone).not.toBe("+2348123456789");
    expect((json.data.maskedPhone.match(/\*/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  // ── Email lookup — query semantics ────────────────────────────────────────

  it("queries users.email and returns public profile", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "s-8", email: "s@x.com", role: "user" });

    const spies = mockDbSelectChain(
      [
        {
          id: "r-uuid-2",
          name: "John Smith",
          avatarUrl: null,
          email: "john@example.com",
          phoneNumber: "+447911234567",
        },
      ],
      [{ currency: "GBP" }],
    );

    const res = await GET(makeEmailRequest("john@example.com"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe("r-uuid-2");
    expect(json.data.currency).toBe("GBP");

    // WHERE clause must use users.email
    expect(spies.usersWhere).toHaveBeenCalledWith(
      expect.objectContaining({ __eq: { col: users.email, val: "john@example.com" } }),
    );

    // Raw PII absent, masked present
    expect(json.data.email).toBeUndefined();
    expect(json.data.maskedEmail).not.toBe("john@example.com");
  });

  // ── Email normalisation — WHERE value must be lowercase ───────────────────

  it("passes a lowercased email to the WHERE clause regardless of input casing", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "s-11", email: "s@x.com", role: "user" });

    const spies = mockDbSelectChain(
      [{ id: "ci-user", name: "Case User", avatarUrl: null, email: "ci@example.com", phoneNumber: null }],
      [],
    );

    const res = await GET(makeEmailRequest("CI@Example.COM"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe("ci-user");

    // The WHERE value must be the normalised lowercase form
    expect(spies.usersWhere).toHaveBeenCalledWith(
      expect.objectContaining({ __eq: { col: users.email, val: "ci@example.com" } }),
    );
    // The original mixed-case input must NOT have been forwarded to the DB
    const calledVal = (spies.usersWhere as jest.Mock).mock.calls[0][0].__eq.val;
    expect(calledVal).not.toBe("CI@Example.COM");
  });

  // ── Wallet ordering ───────────────────────────────────────────────────────

  it("orders wallet query by asc(createdAt) and uses the wallet.userId predicate", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "s-13", email: "s@x.com", role: "user" });

    // Simulate user with two wallets; mock returns the earliest (NGN) first
    const spies = mockDbSelectChain(
      [{ id: "multi-wallet-user", name: "Multi", avatarUrl: null, email: "m@m.com", phoneNumber: "+2341234567890" }],
      [{ currency: "NGN" }],
    );

    const res = await GET(makePhoneRequest("+2341234567890"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.currency).toBe("NGN");

    // orderBy must have been called with asc(wallets.createdAt)
    expect(spies.walletsOrderBy).toHaveBeenCalledWith(
      expect.objectContaining({ __asc: wallets.createdAt }),
    );

    // WHERE must scope to the correct recipient id
    expect(spies.walletsWhere).toHaveBeenCalledWith(
      expect.objectContaining({ __eq: { col: wallets.userId, val: "multi-wallet-user" } }),
    );
  });

  // ── International numbers ─────────────────────────────────────────────────

  it("accepts E.164 numbers with country codes other than +234", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "s-9", email: "s@x.com", role: "user" });

    mockDbSelectChain(
      [{ id: "uk-user", name: "John Smith", avatarUrl: null, email: "js@uk.com", phoneNumber: "+447911234567" }],
      [],
    );

    const res = await GET(makePhoneRequest("+447911234567"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe("uk-user");
  });

  // ── Short phone masking safety ────────────────────────────────────────────

  it("always hides at least 3 chars for a short valid E.164 number", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "s-12", email: "s@x.com", role: "user" });

    mockDbSelectChain(
      [{ id: "short-phone-user", name: "Short", avatarUrl: null, email: "s@s.com", phoneNumber: "+1234567" }],
      [],
    );

    const res = await GET(makePhoneRequest("+1234567"));
    const json = await res.json();

    expect(res.status).toBe(200);
    const masked: string = json.data.maskedPhone;
    expect((masked.match(/\*/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(masked).not.toBe("+1234567");
  });

  // ── No wallet ─────────────────────────────────────────────────────────────

  it("returns null currency when user has no wallet", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "s-10", email: "s@x.com", role: "user" });

    mockDbSelectChain(
      [{ id: "no-wallet-user", name: "No Wallet", avatarUrl: null, email: "nw@example.com", phoneNumber: "+2348000000000" }],
      [],
    );

    const res = await GET(makePhoneRequest("+2348000000000"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.currency).toBeNull();
  });
});
