import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { users, wallets } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import {
  sanitizeInput,
  sanitizePhoneNumber,
  validateE164PhoneNumber,
  validateEmail,
} from "@/lib/validation";
import { consumeRateLimit } from "@/lib/rate-limiter";

// 20 lookups per minute per authenticated user — enough for legitimate use,
// tight enough to prevent phone-number / email enumeration.
const RESOLVE_RATE_LIMIT = 20;
const RESOLVE_RATE_WINDOW_MS = 60_000;

/** Mask an email: "john.doe@example.com" → "jo***@example.com" */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

/**
 * Mask a phone number safely: "+2348123456789" → "+234*****6789"
 *
 * We show at most the first 4 chars (country-code prefix) and the last 4 digits.
 * The two visible windows are clamped so they never overlap — for short but
 * valid E.164 numbers the prefix is shortened and/or the suffix is omitted to
 * guarantee at least 3 hidden characters in the middle.
 */
function maskPhone(phone: string): string {
  const len = phone.length;
  if (len <= 6) return "***";

  // How many chars we want to show at the start (country code hint)
  const wantPrefix = phone.startsWith("+") ? 4 : 3;
  // How many chars we want to show at the end (last-4 confirmation)
  const wantSuffix = 4;
  // Minimum hidden chars to guarantee real obfuscation
  const minHidden = 3;

  // Total budget: we must hide at least minHidden chars
  const maxVisible = len - minHidden;

  // Clamp prefix + suffix to the available budget, prefix takes priority
  const actualPrefix = Math.min(wantPrefix, maxVisible);
  const actualSuffix = Math.min(wantSuffix, Math.max(0, maxVisible - actualPrefix));

  const prefix = phone.slice(0, actualPrefix);
  const suffix = actualSuffix > 0 ? phone.slice(len - actualSuffix) : "";
  const hiddenCount = len - actualPrefix - actualSuffix;
  const hidden = "*".repeat(hiddenCount);

  return `${prefix}${hidden}${suffix}`;
}

export async function GET(request: NextRequest) {
  try {
    // --- Authentication ---
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication is required to resolve a recipient.",
      );
    }

    // --- Rate limiting (keyed per authenticated user) ---
    const rateLimitStatus = consumeRateLimit(
      `resolve:${payload.userId}`,
      RESOLVE_RATE_LIMIT,
      RESOLVE_RATE_WINDOW_MS,
    );
    if (rateLimitStatus.limited) {
      return createProblemDetails(
        "about:blank",
        "Too Many Requests",
        429,
        "Too many lookup attempts. Please wait before trying again.",
      );
    }

    // --- Input extraction ---
    const { searchParams } = new URL(request.url);
    const rawPhone = searchParams.get("phoneNumber");
    const rawEmail = searchParams.get("email");

    // Exactly one of phoneNumber or email must be provided
    if (!rawPhone && !rawEmail) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Provide either a 'phoneNumber' or 'email' query parameter.",
      );
    }

    if (rawPhone && rawEmail) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Provide only one of 'phoneNumber' or 'email', not both.",
      );
    }

    // --- Validate & normalise the input ---
    let whereCondition;
    let lookupType: "phone" | "email";

    if (rawPhone) {
      const trimmed = sanitizeInput(rawPhone);
      if (!validateE164PhoneNumber(trimmed)) {
        return createProblemDetails(
          "about:blank",
          "Bad Request",
          400,
          "Invalid phone number format. Use E.164 format (e.g. +2348123456789).",
        );
      }
      const sanitizedPhone = sanitizePhoneNumber(trimmed);
      whereCondition = eq(users.phoneNumber, sanitizedPhone);
      lookupType = "phone";
    } else {
      // rawEmail is guaranteed non-null here
      const trimmed = sanitizeInput(rawEmail as string);
      if (!validateEmail(trimmed)) {
        return createProblemDetails(
          "about:blank",
          "Bad Request",
          400,
          "Invalid email address format.",
        );
      }
      // Normalise to lowercase so lookup matches regardless of how the address
      // was stored (defensive — registration should also lowercase, but this
      // ensures resolution never silently fails due to case drift).
      whereCondition = eq(users.email, trimmed.toLowerCase());
      lookupType = "email";
    }

    // --- Database lookup ---
    const recipientRows = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        email: users.email,
        phoneNumber: users.phoneNumber,
      })
      .from(users)
      .where(whereCondition)
      .limit(1);

    const recipient = recipientRows[0];

    if (!recipient) {
      const notFoundDetail =
        lookupType === "phone"
          ? "No account found with the provided phone number."
          : "No account found with the provided email address.";
      return createProblemDetails("about:blank", "Not Found", 404, notFoundDetail);
    }

    // Prevent a sender from looking themselves up (optional guard — harmless but clean)
    // We intentionally allow it so the sender can confirm their own profile renders correctly.

    // --- Fetch the recipient's primary wallet currency ---
    // Order by createdAt ASC so we always pick the earliest (primary) wallet
    // deterministically — a user may hold multiple currency wallets.
    const walletRows = await db
      .select({ currency: wallets.currency })
      .from(wallets)
      .where(eq(wallets.userId, recipient.id))
      .orderBy(asc(wallets.createdAt))
      .limit(1);

    const currency = walletRows[0]?.currency ?? null;

    // --- Build sanitised public profile (no raw PII) ---
    const maskedEmail = recipient.email ? maskEmail(recipient.email) : null;
    const maskedPhone = recipient.phoneNumber ? maskPhone(recipient.phoneNumber) : null;

    return NextResponse.json(
      {
        success: true,
        data: {
          id: recipient.id,
          name: recipient.name,
          avatarUrl: recipient.avatarUrl,
          maskedEmail,
          maskedPhone,
          currency,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[RESOLVE_RECIPIENT_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error.",
    );
  }
}
