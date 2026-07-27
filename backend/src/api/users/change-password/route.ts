import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, refreshTokens } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { comparePassword, hashPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/validation";
import { createProblemDetails } from "@/lib/api-utils";

export async function POST(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails("about:blank", "Unauthorized", 401, "Authentication required");
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return createProblemDetails("about:blank", "Bad Request", 400, "Invalid Content-Type. Expected application/json");
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return createProblemDetails("about:blank", "Bad Request", 400, "Request body must be valid JSON");
    }

    if (typeof body !== "object" || body === null) {
      return createProblemDetails("about:blank", "Bad Request", 400, "Request body must be a valid JSON object");
    }

    const { currentPassword, newPassword, confirmNewPassword } = body as Record<string, unknown>;

    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || typeof confirmNewPassword !== "string") {
      return createProblemDetails("about:blank", "Bad Request", 400, "Current password, new password, and confirm new password are required");
    }

    if (newPassword !== confirmNewPassword) {
      return createProblemDetails("about:blank", "Bad Request", 400, "New password and confirm new password do not match");
    }

    if (!validatePassword(newPassword)) {
      return createProblemDetails("about:blank", "Bad Request", 400, "Password too weak. Must be at least 8 characters with uppercase, lowercase, digit, and special character");
    }

    const userRows = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.id, payload.userId))
      .limit(1);

    const user = userRows[0];
    if (!user) {
      return createProblemDetails("about:blank", "Not Found", 404, "User not found");
    }

    const isCurrentPasswordValid = await comparePassword(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      return createProblemDetails("about:blank", "Unauthorized", 401, "Current password is incorrect");
    }

    const hashedPassword = await hashPassword(newPassword);

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash: hashedPassword,
          updatedAt: new Date(),
        })
        .where(eq(users.id, payload.userId));

      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.userId, payload.userId));
    });

    console.log(`[AUTH_AUDIT] Password changed for user: ${payload.userId}`);

    return NextResponse.json(
      { success: true, message: "Password has been changed successfully." },
      { status: 200 },
    );
  } catch (error) {
    console.error("[CHANGE_PASSWORD_ERROR]", error);
    return createProblemDetails("about:blank", "Internal Server Error", 500, "Internal server error");
  }
}