import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { giftsMetadata } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { z } from "zod";

const createMetadataSchema = z.object({
  contractGiftId: z.string(),
  message: z.string().optional(),
  hideAmount: z.boolean().optional(),
  stayAnonymous: z.boolean().optional(),
  imageUrl: z.string().optional(),
  processingFee: z.number().optional(),
  status: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails("about:blank", "Unauthorized", 401, "Unauthorized");
    }

    const { userId } = payload;
    const body = await request.json();
    const parsed = createMetadataSchema.safeParse(body);

    if (!parsed.success) {
      return createProblemDetails("about:blank", "Bad Request", 400, "Invalid input data");
    }

    const data = parsed.data;

    const [metadata] = await db
      .insert(giftsMetadata)
      .values({
        contractGiftId: data.contractGiftId,
        userId: userId,
        message: data.message,
        hideAmount: data.hideAmount ?? false,
        stayAnonymous: data.stayAnonymous ?? false,
        imageUrl: data.imageUrl,
        processingFee: data.processingFee ?? 0,
        status: data.status ?? "pending",
      })
      .returning();

    return NextResponse.json({ success: true, metadata }, { status: 201 });
  } catch (error) {
    console.error("Error in POST /api/gifts/metadata:", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error"
    );
  }
}
