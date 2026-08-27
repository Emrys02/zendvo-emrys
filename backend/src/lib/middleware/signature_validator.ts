import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { Keypair } from "@stellar/stellar-sdk";
import { getAuthPayload } from "@/lib/auth-session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

// ─── Nonce Store ──────────────────────────────────────────────────────────────

/**
 * In-memory store for consumed request nonces.
 * Prevents replay attacks within the 300-second signature validity window.
 *
 * Each entry maps a nonce string to its expiry timestamp (ms since epoch).
 * Expired entries are lazily evicted on every read or write.
 */
class NonceStore {
  private store = new Map<string, number>();

  /** Removes all entries whose TTL has elapsed. */
  private evict(): void {
    const now = Date.now();
    for (const [nonce, expiresAt] of this.store) {
      if (now >= expiresAt) {
        this.store.delete(nonce);
      }
    }
  }

  /**
   * Returns `true` if the nonce is currently recorded (and not yet expired).
   * Evicts stale entries before checking.
   */
  has(nonce: string): boolean {
    this.evict();
    return this.store.has(nonce);
  }

  /**
   * Records a nonce with the given TTL in seconds.
   * Evicts stale entries before storing.
   */
  set(nonce: string, ttlSeconds: number): void {
    this.evict();
    this.store.set(nonce, Date.now() + ttlSeconds * 1000);
  }
}

const nonceStore = new NonceStore();

// ─── Helper ───────────────────────────────────────────────────────────────────

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Validates the Ed25519 request signature supplied by the Stellar wallet owner.
 *
 * This middleware-style function is designed to be called at the top of a
 * Next.js route handler.  It returns `null` when all checks pass (the caller
 * should continue processing the request) or a `NextResponse` error when any
 * check fails (the caller should return that response immediately).
 *
 * @example
 * ```ts
 * // In a route handler:
 * // const sigError = await validateRequestSignature(request);
 * // if (sigError) return sigError;
 * ```
 *
 * ### Validation pipeline
 * 1. Header presence (`x-signature`, `x-timestamp`)
 * 2. Timestamp freshness (±300 s)
 * 3. Authentication (`Authorization: Bearer <token>`)
 * 4. Stellar public-key lookup from the database
 * 5. Canonical payload construction and SHA-256 body hash
 * 6. Ed25519 signature verification via the Stellar SDK
 * 7. Nonce/replay-attack prevention (300 s TTL)
 */
export async function validateRequestSignature(
  request: NextRequest,
): Promise<NextResponse | null> {
  // ── 1. Header extraction ─────────────────────────────────────────────────
  const rawSignature = request.headers.get("x-signature") ?? "";
  const rawTimestamp = request.headers.get("x-timestamp") ?? "";

  if (!rawSignature) {
    return NextResponse.json(
      { error: "Missing X-Signature header" },
      { status: 401 },
    );
  }

  if (!rawTimestamp) {
    return NextResponse.json(
      { error: "Missing X-Timestamp header" },
      { status: 401 },
    );
  }

  // ── 2. Timestamp validation ──────────────────────────────────────────────
  const ts = parseInt(rawTimestamp, 10);

  if (!Number.isFinite(ts)) {
    return NextResponse.json(
      { error: "Invalid X-Timestamp value" },
      { status: 400 },
    );
  }

  if (Math.abs(Date.now() / 1000 - ts) > 300) {
    return NextResponse.json(
      { error: "Request timestamp expired" },
      { status: 401 },
    );
  }

  // ── 3. Auth check ────────────────────────────────────────────────────────
  const authPayload = await getAuthPayload(request);
  if (!authPayload) {
    return NextResponse.json(
      { error: "Unauthenticated request" },
      { status: 401 },
    );
  }

  const { userId } = authPayload;

  // ── 4. Public key lookup ─────────────────────────────────────────────────
  let stellarAddress: string | null;

  try {
    const [row] = await db
      .select({ stellarAddress: users.stellarAddress })
      .from(users)
      .where(eq(users.id, userId));

    stellarAddress = row?.stellarAddress ?? null;
  } catch {
    return NextResponse.json(
      { error: "Internal error during key lookup" },
      { status: 500 },
    );
  }

  if (!stellarAddress) {
    return NextResponse.json(
      { error: "No public key on record for user" },
      { status: 401 },
    );
  }

  // ── 5. Signed payload construction ──────────────────────────────────────
  const bodyText = await request.text();
  const bodyHash = createHash("sha256").update(bodyText).digest("hex");
  const pathname = new URL(request.url).pathname;
  const payloadStr = `${ts}:${request.method.toUpperCase()}:${pathname}:${bodyHash}`;
  const payloadBuffer = Buffer.from(payloadStr, "utf8");

  // ── 6. Signature verification ────────────────────────────────────────────
  const signatureBuffer = Buffer.from(rawSignature, "base64");

  let verified: boolean;
  try {
    verified = Keypair.fromPublicKey(stellarAddress).verify(
      payloadBuffer,
      signatureBuffer,
    );
  } catch {
    return NextResponse.json(
      { error: "Signature verification failed" },
      { status: 400 },
    );
  }

  if (!verified) {
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 },
    );
  }

  // ── 7. Replay prevention ─────────────────────────────────────────────────
  const nonce = `${userId}:${ts}:${sha256hex(rawSignature)}`;

  if (nonceStore.has(nonce)) {
    return NextResponse.json(
      { error: "Duplicate request detected" },
      { status: 401 },
    );
  }

  nonceStore.set(nonce, 300);

  // ── All checks passed ────────────────────────────────────────────────────
  return null;
}
