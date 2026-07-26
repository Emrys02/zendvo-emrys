import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { wallets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";

/** Platform stablecoin used for Wallet screen display by default. */
const DEFAULT_DISPLAY_CURRENCY = "USDC";

/** Accept common stablecoin aliases so clients can request USDT and still resolve USDC. */
const CURRENCY_ALIASES: Record<string, string> = {
  USDT: "USDC",
  USDC: "USDC",
};

function normalizeCurrency(currency?: string | null): string {
  if (!currency) {
    return DEFAULT_DISPLAY_CURRENCY;
  }
  const upper = currency.trim().toUpperCase();
  return CURRENCY_ALIASES[upper] ?? upper;
}

function formatAmount(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

export async function GET(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication required",
      );
    }

    const { userId } = payload;
    const requestedCurrency = normalizeCurrency(
      request.nextUrl.searchParams.get("currency"),
    );

    const userWallets = await db
      .select({
        currency: wallets.currency,
        balance: wallets.balance,
        updatedAt: wallets.updatedAt,
      })
      .from(wallets)
      .where(eq(wallets.userId, userId));

    const balances = userWallets.map((wallet) => {
      const currency = wallet.currency.toUpperCase();
      const amount = Number(wallet.balance) || 0;
      return {
        currency,
        amount,
        formatted: formatAmount(amount, currency),
        updatedAt: wallet.updatedAt?.toISOString?.() ?? wallet.updatedAt,
      };
    });

    const primary =
      balances.find((b) => b.currency === requestedCurrency) ??
      balances.find((b) => b.currency === DEFAULT_DISPLAY_CURRENCY) ??
      balances[0] ??
      null;

    const amount = primary?.amount ?? 0;
    const currency = primary?.currency ?? requestedCurrency;

    return NextResponse.json(
      {
        success: true,
        balance: {
          amount,
          currency,
          formatted: formatAmount(amount, currency),
          updatedAt: primary?.updatedAt ?? null,
        },
        balances,
        displayCurrency: currency,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[WALLET_BALANCE_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to retrieve wallet balance",
    );
  }
}
