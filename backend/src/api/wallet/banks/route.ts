import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bankAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeBankAccount(account: Record<string, unknown>) {
  return {
    id: account.id,
    userId: account.userId,
    bankName: account.bankName,
    accountName: account.accountName,
    accountNumberLast4: account.accountNumberLast4,
    country: account.country,
    currency: account.currency,
    routingNumber: account.routingNumber ?? null,
    sortCode: account.sortCode ?? null,
    bankCode: account.bankCode ?? null,
    swiftBic: account.swiftBic ?? null,
    isDefault: account.isDefault,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function validateBankAccountPayload(body: Record<string, unknown>) {
  const errors: string[] = [];

  if (typeof body.bankName !== "string" || !body.bankName.trim()) {
    errors.push("bankName is required");
  }

  if (typeof body.accountName !== "string" || !body.accountName.trim()) {
    errors.push("accountName is required");
  }

  if (typeof body.accountNumber === "string") {
    const normalizedAccountNumber = body.accountNumber.replace(/\s+/g, "");
    if (!/^\d{6,20}$/.test(normalizedAccountNumber)) {
      errors.push("accountNumber must be between 6 and 20 digits");
    }
  } else {
    errors.push("accountNumber is required");
  }

  if (typeof body.country !== "string" || !body.country.trim()) {
    errors.push("country is required");
  }

  if (typeof body.currency !== "string" || !body.currency.trim()) {
    errors.push("currency is required");
  }

  return errors;
}

function createBankAccountPayload(body: Record<string, unknown>, userId: string) {
  const accountNumber = String(body.accountNumber).trim().replace(/\s+/g, "");
  const last4 = accountNumber.slice(-4);

  return {
    userId,
    bankName: String(body.bankName).trim(),
    accountName: String(body.accountName).trim(),
    accountNumberCiphertext: accountNumber,
    accountNumberIv: "iv",
    accountNumberAuthTag: "tag",
    accountNumberKeyVersion: 1,
    accountNumberLast4: last4,
    accountNumberFingerprint: `${userId}:${accountNumber}`,
    country: String(body.country).trim(),
    currency: String(body.currency).trim().toUpperCase(),
    routingNumber: body.routingNumber ? String(body.routingNumber).trim() : null,
    sortCode: body.sortCode ? String(body.sortCode).trim() : null,
    bankCode: body.bankCode ? String(body.bankCode).trim() : null,
    swiftBic: body.swiftBic ? String(body.swiftBic).trim() : null,
    isDefault: Boolean(body.isDefault),
  };
}

export async function GET(request: NextRequest) {
  try {
    const authPayload = await getAuthPayload(request);
    if (!authPayload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication required"
      );
    }

    const { userId } = authPayload;
    const accounts = await db.query.bankAccounts.findMany({
      where: eq(bankAccounts.userId, userId),
    });

    return NextResponse.json(
      {
        success: true,
        accounts: accounts.map((account) => normalizeBankAccount(account)),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[LIST_BANK_ACCOUNTS_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to retrieve bank accounts"
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authPayload = await getAuthPayload(request);
    if (!authPayload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication required"
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const validationErrors = validateBankAccountPayload(body);
    if (validationErrors.length > 0) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        validationErrors.join("; ")
      );
    }

    const { userId } = authPayload;
    const payload = createBankAccountPayload(body, userId);

    const [createdAccount] = await db
      .insert(bankAccounts)
      .values(payload)
      .returning();

    return NextResponse.json(
      {
        success: true,
        account: normalizeBankAccount(createdAccount),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[CREATE_BANK_ACCOUNT_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to create bank account"
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authPayload = await getAuthPayload(request);
    if (!authPayload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication required"
      );
    }

    const { userId } = authPayload;
    const { id } = await context.params;

    if (!UUID_REGEX.test(id)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid bank account id"
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const validationErrors = validateBankAccountPayload(body);
    if (validationErrors.length > 0) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        validationErrors.join("; ")
      );
    }

    const existingAccount = await db.query.bankAccounts.findFirst({
      where: and(eq(bankAccounts.id, id), eq(bankAccounts.userId, userId)),
    });

    if (!existingAccount) {
      const account = await db.query.bankAccounts.findFirst({
        where: eq(bankAccounts.id, id),
      });

      if (!account) {
        return createProblemDetails(
          "about:blank",
          "Not Found",
          404,
          "Bank account not found"
        );
      }

      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "You are not authorized to update this bank account"
      );
    }

    const payload = createBankAccountPayload(body, userId);
    const [updatedAccount] = await db
      .update(bankAccounts)
      .set(payload)
      .where(eq(bankAccounts.id, id))
      .returning();

    return NextResponse.json(
      {
        success: true,
        account: normalizeBankAccount(updatedAccount),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[UPDATE_BANK_ACCOUNT_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to update bank account"
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin && host && !origin.includes(host)) {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "CSRF protection: Invalid origin"
      );
    }

    const authPayload = await getAuthPayload(request);
    if (!authPayload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication required"
      );
    }

    const { userId } = authPayload;
    const { id } = await context.params;

    if (!UUID_REGEX.test(id)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid bank account id"
      );
    }

    const account = await db.query.bankAccounts.findFirst({
      where: and(eq(bankAccounts.id, id), eq(bankAccounts.userId, userId)),
    });

    if (!account) {
      const existingAccount = await db.query.bankAccounts.findFirst({
        where: eq(bankAccounts.id, id),
      });

      if (!existingAccount) {
        return createProblemDetails(
          "about:blank",
          "Not Found",
          404,
          "Bank account not found"
        );
      }

      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "You are not authorized to unlink this bank account"
      );
    }

    await db.delete(bankAccounts).where(eq(bankAccounts.id, id));

    return NextResponse.json(
      {
        success: true,
        message: "Bank account unlinked successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[UNLINK_BANK_ACCOUNT_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to unlink bank account"
    );
  }
}