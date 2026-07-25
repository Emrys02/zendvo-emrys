import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { gifts, transactions } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails, paginatedResponse } from "@/lib/api-utils";
import { eq, or, desc } from "drizzle-orm";

type WalletTransactionType = "gift_received" | "gift_sent" | "withdrawal" | "top_up";
type WalletTransactionStatus = "completed" | "pending" | "failed";

interface WalletTransaction {
  id: string;
  type: WalletTransactionType;
  amount: number;
  currency: string;
  dateTime: string;
  status: WalletTransactionStatus;
}

function mapGiftStatus(status: string): WalletTransactionStatus {
  if (status === "completed" || status === "sent") return "completed";
  if (status === "failed") return "failed";
  return "pending";
}

export async function GET(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails("about:blank", "Unauthorized", 401, "Unauthorized");
    }

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") ?? "20", 10)));
    const typeParam = url.searchParams.get("type");
    const statusParam = url.searchParams.get("status");

    const allowedTypes: WalletTransactionType[] = [
      "gift_received",
      "gift_sent",
      "withdrawal",
      "top_up",
    ];
    const allowedStatuses: WalletTransactionStatus[] = ["completed", "pending", "failed"];

    if (typeParam && !allowedTypes.includes(typeParam as WalletTransactionType)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        `Invalid type. Allowed: ${allowedTypes.join(", ")}`,
      );
    }

    if (statusParam && !allowedStatuses.includes(statusParam as WalletTransactionStatus)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        `Invalid status. Allowed: ${allowedStatuses.join(", ")}`,
      );
    }

    const [userGifts, userTransactions] = await Promise.all([
      db
        .select()
        .from(gifts)
        .where(
          or(
            eq(gifts.recipientId, payload.userId),
            eq(gifts.senderId, payload.userId),
          ),
        )
        .orderBy(desc(gifts.createdAt)),
      db
        .select()
        .from(transactions)
        .where(eq(transactions.userId, payload.userId))
        .orderBy(desc(transactions.createdAt)),
    ]);

    const unified: WalletTransaction[] = [];

    for (const g of userGifts) {
      const isReceived = g.recipientId === payload.userId;
      unified.push({
        id: g.id,
        type: isReceived ? "gift_received" : "gift_sent",
        amount: g.amount,
        currency: g.currency,
        dateTime: g.createdAt.toISOString(),
        status: mapGiftStatus(g.status),
      });
    }

    for (const t of userTransactions) {
      if (t.type === "transfer") continue;
      const mappedType = t.type === "deposit" ? "top_up" : "withdrawal";
      unified.push({
        id: t.id,
        type: mappedType,
        amount: t.amount,
        currency: t.currency,
        dateTime: t.createdAt.toISOString(),
        status: t.status as WalletTransactionStatus,
      });
    }

    unified.sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());

    let filtered = unified;
    if (typeParam) {
      filtered = filtered.filter(t => t.type === typeParam);
    }
    if (statusParam) {
      filtered = filtered.filter(t => t.status === statusParam);
    }

    const total = filtered.length;
    const start = (page - 1) * limit;
    const paginated = filtered.slice(start, start + limit);

    return paginatedResponse(paginated, total, page, limit);
  } catch (error) {
    console.error("[WALLET_TRANSACTIONS_GET_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
