import { NextRequest, NextResponse } from "next/server";
import { consumeRateLimit } from "@/lib/rate-limiter";
import { verifyAccessToken } from "@/lib/tokens";

const AUTH_RATE_LIMIT = 100;
const AUTH_RATE_WINDOW_MS = 60_000;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  if (pathname.startsWith("/api/auth")) {
    const ip = request.headers.get("x-forwarded-for") ?? "anonymous";
    const key = `auth-rl:${ip}`;
    const status = consumeRateLimit(key, AUTH_RATE_LIMIT, AUTH_RATE_WINDOW_MS);

    response.headers.set("x-ratelimit-remaining", String(status.remaining));
    response.headers.set("x-ratelimit-limit", String(AUTH_RATE_LIMIT));
    response.headers.set("x-ratelimit-reset", String(status.resetMs));
  }

  if (pathname.startsWith("/api/")) {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7);
      const payload = await verifyAccessToken(token);
      if (payload) {
        response.headers.set(
          "x-middleware-request-x-account-type",
          payload.role,
        );
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
