import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";

/** PostgreSQL unique-constraint violation error code. */
const PG_UNIQUE_VIOLATION = "23505";

export async function POST(request: NextRequest) {
  try {
    // 1. Require authentication
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication required",
      );
    }

    const { userId } = payload;

    // 2. Parse request body — a non-object or null body is treated as empty
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const { stellarAddress } =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as { stellarAddress?: unknown })
        : {};

    if (typeof stellarAddress !== "string" || !stellarAddress.trim()) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "stellarAddress is required",
      );
    }

    const address = stellarAddress.trim();

    // 3. Validate Stellar Ed25519 public key format
    if (!StrKey.isValidEd25519PublicKey(address)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid Stellar public address",
      );
    }

    // 4. Fetch the current user's record
    const [user] = await db
      .select({ id: users.id, stellarAddress: users.stellarAddress })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "User not found",
      );
    }

    // 5. Idempotency: if the same address is already registered for this user, return 200
    if (user.stellarAddress === address) {
      return NextResponse.json(
        {
          success: true,
          message: "Stellar address already registered",
          stellarAddress: address,
        },
        { status: 200 },
      );
    }

    // 6. Uniqueness: check whether a *different* user already owns this address
    const [existingOwner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.stellarAddress, address));

    if (existingOwner) {
      return createProblemDetails(
        "about:blank",
        "Conflict",
        409,
        "Stellar address is already registered to another account",
      );
    }

    // 7. Persist the address — handle a concurrent unique-constraint violation
    try {
      const updated = await db
        .update(users)
        .set({ stellarAddress: address, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning({ id: users.id });

      // The user was deleted between our lookup (step 4) and this update.
      if (updated.length === 0) {
        return createProblemDetails(
          "about:blank",
          "Not Found",
          404,
          "User not found",
        );
      }
    } catch (updateError: unknown) {
      // Another request won the race and claimed this address between our
      // uniqueness check (step 6) and this update. Re-read to distinguish
      // between our own user winning the race (idempotent 200) and a
      // different user claiming the address (conflict 409).
      const code =
        updateError !== null &&
        typeof updateError === "object" &&
        "code" in updateError
          ? (updateError as { code: string }).code
          : null;

      if (code === PG_UNIQUE_VIOLATION) {
        const [refreshed] = await db
          .select({ id: users.id, stellarAddress: users.stellarAddress })
          .from(users)
          .where(eq(users.id, userId));

        if (refreshed?.stellarAddress === address) {
          return NextResponse.json(
            {
              success: true,
              message: "Stellar address already registered",
              stellarAddress: address,
            },
            { status: 200 },
          );
        }

        return createProblemDetails(
          "about:blank",
          "Conflict",
          409,
          "Stellar address is already registered to another account",
        );
      }

      throw updateError;
    }

    return NextResponse.json(
      {
        success: true,
        message: "Stellar address registered successfully",
        stellarAddress: address,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[WALLET_REGISTER_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to register Stellar address",
    );
  }
}
