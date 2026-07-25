"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGift = createGift;
exports.findGiftByPaymentReference = findGiftByPaymentReference;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("@/lib/db");
const schema_1 = require("@/lib/db/schema");
async function createGift(input) {
    const fee = 0;
    const totalAmount = input.amount + fee;
    const [gift] = await db_1.db
        .insert(schema_1.gifts)
        .values({
        senderId: null,
        recipientId: input.recipientId,
        amount: input.amount,
        fee,
        totalAmount,
        currency: input.currency,
        paymentReference: input.paymentReference,
        paymentProvider: input.paymentProvider,
        senderName: input.senderName ?? null,
        senderEmail: input.senderEmail ?? null,
        message: input.message ?? null,
        template: input.template ?? null,
        recipientPhone: input.recipientPhone ?? null,
        isAnonymous: input.isAnonymous ?? false,
        status: "pending_otp",
    })
        .returning();
    return {
        id: gift.id,
        recipientId: gift.recipientId,
        amount: gift.amount,
        fee: gift.fee,
        totalAmount: gift.totalAmount,
        currency: gift.currency,
        paymentReference: gift.paymentReference,
        paymentProvider: gift.paymentProvider,
        status: gift.status,
        createdAt: gift.createdAt,
    };
}
async function findGiftByPaymentReference(reference) {
    const gift = await db_1.db.query.gifts.findFirst({
        where: (0, drizzle_orm_1.eq)(schema_1.gifts.paymentReference, reference),
    });
    if (!gift)
        return null;
    return {
        id: gift.id,
        recipientId: gift.recipientId,
        amount: gift.amount,
        fee: gift.fee,
        totalAmount: gift.totalAmount,
        currency: gift.currency,
        paymentReference: gift.paymentReference,
        paymentProvider: gift.paymentProvider,
        status: gift.status,
        createdAt: gift.createdAt,
    };
}
