import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { comparePassword, hashPassword } from "@/lib/auth";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { revokeAllUserRefreshTokens } from "@/server/db/authRepository";

const changePasswordSchema = z.object({
  old_password: z.string().min(8, "Current password is required"),
  new_password: z.string().min(8, "New password must be at least 8 characters"),
});

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

    const validation = changePasswordSchema.safeParse(body);
    if (!validation.success) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid change password request",
        undefined,
        {
          errors: validation.error.flatten().fieldErrors,
        },
      );
    }

    const { old_password, new_password } = validation.data;

    if (old_password === new_password) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "The new password must be different from the current password",
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
      columns: { passwordHash: users.passwordHash },
    });

    if (!user) {
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "User not found",
      );
    }

    const isCurrentPasswordValid = await comparePassword(
      old_password,
      user.passwordHash,
    );
    if (!isCurrentPasswordValid) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Current password is incorrect",
      );
    }

    const hashedPassword = await hashPassword(new_password);
    await db
      .update(users)
      .set({ passwordHash: hashedPassword, updatedAt: new Date() })
      .where(eq(users.id, payload.userId));

    await revokeAllUserRefreshTokens(payload.userId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("[CHANGE_PASSWORD_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
