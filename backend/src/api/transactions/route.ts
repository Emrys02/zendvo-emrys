import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails, paginatedResponse } from "@/lib/api-utils";
import { eq, desc, count } from "drizzle-orm";

export async function GET(request: NextRequest) {
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

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") ?? "20", 10)));
    const offset = (page - 1) * limit;

    const [data, total] = await Promise.all([
      db
        .select()
        .from(transactions)
        .where(eq(transactions.userId, payload.userId))
        .orderBy(desc(transactions.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: count() })
        .from(transactions)
        .where(eq(transactions.userId, payload.userId))
        .then((res) => Number(res[0].count)),
    ]);

    return paginatedResponse(data, total, page, limit);
  } catch (error) {
    console.error("[TRANSACTIONS_GET_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
