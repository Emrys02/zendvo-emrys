import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { generateSecret, generateURI } from "otplib";
import QRCode from "qrcode";

type ToggleBodyValid = { success: true; data: { enabled: boolean } };
type ToggleBodyInvalid = {
  success: false;
  error: { flatten: () => { fieldErrors: Record<string, string[]> } };
};
type ToggleBodyResult = ToggleBodyValid | ToggleBodyInvalid;

function validateToggleBody(body: unknown): ToggleBodyResult {
  if (
    !body ||
    typeof body !== "object" ||
    !("enabled" in body) ||
    typeof (body as { enabled: unknown }).enabled !== "boolean"
  ) {
    return {
      success: false,
      error: {
        flatten: () => ({
          fieldErrors: {
            enabled: ["Field 'enabled' is required and must be a boolean."],
          },
        }),
      },
    };
  }

  return {
    success: true,
    data: { enabled: (body as { enabled: boolean }).enabled },
  };
}

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

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid Content-Type. Expected application/json",
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Request body must be valid JSON",
      );
    }

    const validationResult = validateToggleBody(body);
    if (!validationResult.success) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid request body",
        undefined,
        { errors: validationResult.error.flatten().fieldErrors },
      );
    }

    const { enabled } = validationResult.data;

    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
    });

    if (!user) {
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "User not found",
      );
    }

    if (enabled) {
      const secret = generateSecret();
      const uri = generateURI({
        secret,
        issuer: "Zendvo",
        label: user.email,
      });

      let qrCodeDataUrl: string;
      try {
        qrCodeDataUrl = await QRCode.toDataURL(uri);
      } catch {
        qrCodeDataUrl = "";
      }

      await db
        .update(users)
        .set({
          totpSecret: secret,
          is2faEnabled: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, payload.userId));

      return NextResponse.json(
        {
          success: true,
          is2faEnabled: true,
          totpSecret: secret,
          otpauthUri: uri,
          qrCodeDataUrl,
        },
        { status: 200 },
      );
    }

    await db
      .update(users)
      .set({
        totpSecret: null,
        is2faEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, payload.userId));

    return NextResponse.json(
      {
        success: true,
        is2faEnabled: false,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("[2FA_TOGGLE_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
