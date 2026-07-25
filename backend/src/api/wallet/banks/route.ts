import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bankAccounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";

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

    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(id)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid bank account id"
      );
    }

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

    if (account.userId !== userId) {
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