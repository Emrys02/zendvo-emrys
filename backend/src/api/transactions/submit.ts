import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { SubmissionService } from "@/lib/stellar/submission_service";
import { TransactionBuilder, Networks } from "@stellar/stellar-sdk";

export async function POST(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Unauthorized",
      );
    }

    const { userId } = payload;

    const body = await request.json();
    const { signedXdr } = body;

    if (!signedXdr || typeof signedXdr !== "string") {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Missing or invalid signed XDR",
      );
    }

    let tx;
    try {
      const networkPassphrase = process.env.STELLAR_NETWORK === 'public' ? Networks.PUBLIC : Networks.TESTNET;
      tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
    } catch (e) {
      return createProblemDetails("about:blank", "Bad Request", 400, "Invalid XDR format");
    }

    let amount = 0;
    let hasUsdc = false;
    for (const op of tx.operations) {
      if (op.type === "payment" && !op.asset.isNative() && op.asset.getCode() === "USDC") {
        hasUsdc = true;
        amount = parseFloat(op.amount);
        break;
      }
    }

    if (!hasUsdc) {
      return createProblemDetails("about:blank", "Bad Request", 400, "Transaction must contain a USDC payment");
    }

    const userResult = await db.select().from(users).where(eq(users.id, userId as string)).limit(1);
    const user = userResult[0];

    if (!user || !user.stellarAddress) {
      return createProblemDetails("about:blank", "Bad Request", 400, "User stellar address not found");
    }

    // Submit the XDR to the network using the robust submission service
    const result = await SubmissionService.submitXdrToNetwork(signedXdr, user.stellarAddress);

    if (result.success && result.hash) {
      // Log the submitted transaction in the database
      await db.insert(transactions).values({
        userId: userId as string,
        amount,
        currency: "USDC",
        type: "blockchain_submission" as const,
        status: "pending" as const,
        reference: result.hash,
      });

      return new Response(
        JSON.stringify({
          success: true,
          hash: result.hash,
          status: result.status,
          attempts: result.attempts,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Return the error from the submission service
    return createProblemDetails(
      "about:blank",
      "Submission Failed",
      400,
      result.error || "Transaction submission failed",
    );
  } catch (error) {
    console.error("[TRANSACTION_SUBMIT_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to submit transaction",
    );
  }
}