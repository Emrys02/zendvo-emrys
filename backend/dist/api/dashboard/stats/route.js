"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const schema_1 = require("@/lib/db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const auth_session_1 = require("@/lib/auth-session");
const api_utils_1 = require("@/lib/api-utils");
async function GET(request) {
    try {
        const payload = await (0, auth_session_1.getAuthPayload)(request);
        if (!payload) {
            return (0, api_utils_1.createProblemDetails)("about:blank", "Unauthorized", 401, "Unauthorized");
        }
        const { userId } = payload;
        const now = new Date();
        const [giftsReceived, giftsSent, unopenedGifts, userWallets] = await Promise.all([
            db_1.db
                .select({ count: (0, drizzle_orm_1.count)() })
                .from(schema_1.gifts)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.gifts.recipientId, userId), (0, drizzle_orm_1.eq)(schema_1.gifts.status, "completed"))),
            db_1.db
                .select({ count: (0, drizzle_orm_1.count)() })
                .from(schema_1.gifts)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.gifts.senderId, userId), (0, drizzle_orm_1.eq)(schema_1.gifts.status, "completed"))),
            db_1.db
                .select({ count: (0, drizzle_orm_1.count)() })
                .from(schema_1.gifts)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.gifts.recipientId, userId), (0, drizzle_orm_1.notInArray)(schema_1.gifts.status, ["completed", "failed", "sent"]), (0, drizzle_orm_1.isNotNull)(schema_1.gifts.unlockDatetime), (0, drizzle_orm_1.gt)(schema_1.gifts.unlockDatetime, now))),
            db_1.db
                .select({ currency: schema_1.wallets.currency, balance: schema_1.wallets.balance })
                .from(schema_1.wallets)
                .where((0, drizzle_orm_1.eq)(schema_1.wallets.userId, userId)),
        ]);
        return server_1.NextResponse.json({
            success: true,
            stats: {
                accountBalance: userWallets,
                giftsReceived: giftsReceived[0]?.count ?? 0,
                giftsSent: giftsSent[0]?.count ?? 0,
                unopenedGifts: unopenedGifts[0]?.count ?? 0,
            },
        }, { status: 200 });
    }
    catch (error) {
        console.error("Error in dashboard/stats:", error);
        return (0, api_utils_1.createProblemDetails)("about:blank", "Internal Server Error", 500, "Internal server error");
    }
}
