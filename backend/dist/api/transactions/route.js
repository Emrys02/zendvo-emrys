"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const db_1 = require("@/lib/db");
const schema_1 = require("@/lib/db/schema");
const auth_session_1 = require("@/lib/auth-session");
const api_utils_1 = require("@/lib/api-utils");
const drizzle_orm_1 = require("drizzle-orm");
async function GET(request) {
    try {
        const payload = await (0, auth_session_1.getAuthPayload)(request);
        if (!payload) {
            return (0, api_utils_1.createProblemDetails)("about:blank", "Unauthorized", 401, "Unauthorized");
        }
        const url = new URL(request.url);
        const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
        const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") ?? "20", 10)));
        const offset = (page - 1) * limit;
        const [data, total] = await Promise.all([
            db_1.db
                .select()
                .from(schema_1.transactions)
                .where((0, drizzle_orm_1.eq)(schema_1.transactions.userId, payload.userId))
                .orderBy(schema_1.transactions.createdAt.desc())
                .limit(limit)
                .offset(offset),
            db_1.db
                .select({ count: db_1.db.count() })
                .from(schema_1.transactions)
                .where((0, drizzle_orm_1.eq)(schema_1.transactions.userId, payload.userId))
                .then((res) => Number(res[0].count)),
        ]);
        return (0, api_utils_1.paginatedResponse)(data, total, page, limit);
    }
    catch (error) {
        console.error("[TRANSACTIONS_GET_ERROR]", error);
        return (0, api_utils_1.createProblemDetails)("about:blank", "Internal Server Error", 500, "Internal server error");
    }
}
