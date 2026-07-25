import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { userProfileUpdateSchema } from "@/lib/validations/auth";

export async function PUT(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails("about:blank", "Unauthorized", 401, "Unauthorized");
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return createProblemDetails("about:blank", "Bad Request", 400, "Invalid Content-Type. Expected application/json");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return createProblemDetails("about:blank", "Bad Request", 400, "Request body must be valid JSON");
    }

    const validation = userProfileUpdateSchema.safeParse(body);
    if (!validation.success) {
      return createProblemDetails("about:blank", "Bad Request", 400, "Invalid profile details", undefined, {
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const [updatedUser] = await db
      .update(users)
      .set({ ...validation.data, updatedAt: new Date() })
      .where(eq(users.id, payload.userId))
      .returning({
        id: users.id,
        name: users.name,
        phoneNumber: users.phoneNumber,
        email: users.email,
        avatarUrl: users.avatarUrl,
        username: users.username,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    if (!updatedUser) {
      return createProblemDetails("about:blank", "Not Found", 404, "User not found");
    }

    return NextResponse.json({ success: true, user: updatedUser }, { status: 200 });
  } catch (error: unknown) {
    const databaseError = error as { code?: string; constraint?: string };
    if (databaseError.code === "23505") {
      const field = databaseError.constraint?.includes("phone")
        ? "Phone number"
        : databaseError.constraint?.includes("email")
          ? "Email address"
          : "Profile value";
      return createProblemDetails("about:blank", "Conflict", 409, `${field} is already in use`);
    }

    console.error("[PROFILE_UPDATE_ERROR]", error);
    return createProblemDetails("about:blank", "Internal Server Error", 500, "Internal server error");
  }
}
