import { verifyWebhookSignature } from "@/lib/stellar/webhook_signature";

// ── Mock the Stellar SDK Keypair ──────────────────────────────────────────────

jest.mock("@stellar/stellar-sdk", () => {
  let shouldVerify = true;

  return {
    Keypair: {
      fromPublicKey: jest.fn(() => ({
        verify: jest.fn((_data: Uint8Array, sig: Uint8Array) => {
          // Return controlled result; sig length > 0 = valid, empty = invalid
          if (sig.length === 0) return false;
          return shouldVerify;
        }),
      })),
    },
    __setShouldVerify: (val: boolean) => {
      shouldVerify = val;
    },
  };
});

const { __setShouldVerify } = require("@stellar/stellar-sdk") as {
  __setShouldVerify: (val: boolean) => void;
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("verifyWebhookSignature", () => {
  const HOST = "wallet.example.com";
  const BODY = '{"id":"tx-1","status":"completed"}';
  const SIGNING_KEY = "GANK22UVLM5TQ7LN3K7OZ3GJDYBDYXMX6RVIRZOS3HX2U7SAQ5YJPXLY";
  const NOW = 1_700_000_000;

  beforeEach(() => {
    jest.clearAllMocks();
    __setShouldVerify(true);
  });

  it("returns valid for a correct signature", () => {
    const sig = "dGVzdHNpZw=="; // base64("testsig") — non-empty = passes mock
    const header = `t=${NOW}, s=${sig}`;

    const result = verifyWebhookSignature(header, HOST, BODY, SIGNING_KEY, NOW);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns invalid when Signature header is null", () => {
    const result = verifyWebhookSignature(null, HOST, BODY, SIGNING_KEY, NOW);

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Missing Signature header");
  });

  it("returns invalid when Signature header is undefined", () => {
    const result = verifyWebhookSignature(
      undefined,
      HOST,
      BODY,
      SIGNING_KEY,
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Missing Signature header");
  });

  it("returns invalid for malformed header (no comma)", () => {
    const result = verifyWebhookSignature(
      "invalidheader",
      HOST,
      BODY,
      SIGNING_KEY,
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Malformed Signature header");
  });

  it("returns invalid for header missing timestamp", () => {
    const result = verifyWebhookSignature(
      "s=abc123",
      HOST,
      BODY,
      SIGNING_KEY,
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Malformed Signature header");
  });

  it("returns invalid for header missing signature value", () => {
    const result = verifyWebhookSignature(
      `t=${NOW}`,
      HOST,
      BODY,
      SIGNING_KEY,
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Malformed Signature header");
  });

  it("returns invalid when timestamp is too old", () => {
    const oldTimestamp = NOW - 300; // 5 minutes ago
    const sig = "dGVzdHNpZw==";
    const header = `t=${oldTimestamp}, s=${sig}`;

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      SIGNING_KEY,
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Signature expired");
    expect(result.error).toContain("300s old");
  });

  it("returns valid when timestamp is within threshold", () => {
    const recentTimestamp = NOW - 60; // 1 minute ago
    const sig = "dGVzdHNpZw==";
    const header = `t=${recentTimestamp}, s=${sig}`;

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      SIGNING_KEY,
      NOW,
    );

    expect(result.valid).toBe(true);
  });

  it("returns valid when timestamp is slightly in the future", () => {
    const futureTimestamp = NOW + 30; // 30 seconds in future
    const sig = "dGVzdHNpZw==";
    const header = `t=${futureTimestamp}, s=${sig}`;

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      SIGNING_KEY,
      NOW,
    );

    expect(result.valid).toBe(true);
  });

  it("returns invalid when Ed25519 verification fails", () => {
    __setShouldVerify(false);
    const sig = "dGVzdHNpZw==";
    const header = `t=${NOW}, s=${sig}`;

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      SIGNING_KEY,
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Signature verification failed");
  });

  it("returns valid with X-Stellar-Signature header format", () => {
    // This function just parses the header; the caller decides which header to pass
    const sig = "dGVzdHNpZw==";
    const header = `t=${NOW}, s=${sig}`;

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      SIGNING_KEY,
      NOW,
    );

    expect(result.valid).toBe(true);
  });

  it("handles signature values containing base64 padding", () => {
    // base64 can contain = characters, which the parser must handle
    const sigWithPadding = "dGVzdC==/sig=";
    const header = `t=${NOW}, s=${sigWithPadding}`;

    // Should not throw — parsing handles '=' in base64
    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      SIGNING_KEY,
      NOW,
    );

    // Result depends on whether verification passes
    expect(typeof result.valid).toBe("boolean");
  });

  it("returns error when Keypair.fromPublicKey throws (invalid key)", () => {
    const { Keypair } = require("@stellar/stellar-sdk");
    Keypair.fromPublicKey.mockImplementationOnce(() => {
      throw new Error("Invalid key");
    });

    const sig = "dGVzdHNpZw==";
    const header = `t=${NOW}, s=${sig}`;

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      "INVALID_KEY",
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Signature verification error");
    expect(result.error).toContain("Invalid key");
  });
});
