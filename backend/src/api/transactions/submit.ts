import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { SubmissionService } from "@/lib/stellar/submission_service";

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

    // Submit the XDR to the network using the robust submission service
    const result = await SubmissionService.submitXdrToNetwork(signedXdr);

    if (result.success && result.hash) {
      // Log the submitted transaction in the database
      await db.insert(transactions).values({
        userId: userId as string,
        amount: 0,
        currency: "USDC",
        type: "blockchain_submission" as const,
        status: "submitted" as const,
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