"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("@/lib/db");
const schema_1 = require("@/lib/db/schema");
const auth_session_1 = require("@/lib/auth-session");
const api_utils_1 = require("@/lib/api-utils");
const validation_1 = require("@/lib/validation");
const rate_limiter_1 = require("@/lib/rate-limiter");
// 20 lookups per minute per authenticated user — enough for legitimate use,
// tight enough to prevent phone-number enumeration.
const RESOLVE_RATE_LIMIT = 20;
const RESOLVE_RATE_WINDOW_MS = 60_000;
async function GET(request) {
    try {
        // --- Authentication ---
        const payload = await (0, auth_session_1.getAuthPayload)(request);
        if (!payload) {
            return (0, api_utils_1.createProblemDetails)("about:blank", "Unauthorized", 401, "Authentication is required to resolve a recipient.");
        }
        // --- Rate limiting (keyed per authenticated user) ---
        const rateLimitStatus = (0, rate_limiter_1.consumeRateLimit)(`resolve:${payload.userId}`, RESOLVE_RATE_LIMIT, RESOLVE_RATE_WINDOW_MS);
        if (rateLimitStatus.limited) {
            return (0, api_utils_1.createProblemDetails)("about:blank", "Too Many Requests", 429, "Too many lookup attempts. Please wait before trying again.");
        }
        // --- Input validation ---
        const { searchParams } = new URL(request.url);
        const rawPhone = searchParams.get("phoneNumber");
        if (!rawPhone || rawPhone.trim() === "") {
            return (0, api_utils_1.createProblemDetails)("about:blank", "Bad Request", 400, "Query parameter 'phoneNumber' is required.");
        }
        if (!(0, validation_1.validateE164PhoneNumber)(rawPhone)) {
            return (0, api_utils_1.createProblemDetails)("about:blank", "Bad Request", 400, "Invalid phone number format. Use E.164 format (e.g. +2348123456789).");
        }
        const sanitizedPhone = (0, validation_1.sanitizePhoneNumber)(rawPhone);
        // --- Database lookup ---
        const recipientRows = await db_1.db
            .select({
            id: schema_1.users.id,
            name: schema_1.users.name,
            avatarUrl: schema_1.users.avatarUrl,
        })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.eq)(schema_1.users.phoneNumber, sanitizedPhone))
            .limit(1);
        const recipient = recipientRows[0];
        if (!recipient) {
            return (0, api_utils_1.createProblemDetails)("about:blank", "Not Found", 404, "No account found with the provided phone number.");
        }
        return server_1.NextResponse.json({
            success: true,
            data: {
                id: recipient.id,
                name: recipient.name,
                avatarUrl: recipient.avatarUrl,
            },
        }, { status: 200 });
    }
    catch (error) {
        console.error("[RESOLVE_RECIPIENT_ERROR]", error);
        return (0, api_utils_1.createProblemDetails)("about:blank", "Internal Server Error", 500, "Internal server error.");
    }
}
