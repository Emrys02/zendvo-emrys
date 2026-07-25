"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startGiftReleaseJob = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const db_1 = require("../lib/db");
const schema_1 = require("../lib/db/schema");
const drizzle_orm_1 = require("drizzle-orm");
let isProcessing = false;
const startGiftReleaseJob = () => {
    node_cron_1.default.schedule('*/1 * * * *', async () => {
        if (isProcessing) {
            console.warn('[Cron Job] Previous execution is still active. Skipping tick.');
            return;
        }
        try {
            isProcessing = true;
            const now = new Date();
            console.log('[Cron Job] Checking for mature time-locked gifts...');
            // 1. Find all potential candidate records that passed their unlock window
            const matureGifts = await db_1.db
                .select()
                .from(schema_1.gifts)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.gifts.status, 'confirmed'), (0, drizzle_orm_1.lte)(schema_1.gifts.unlockDatetime, now)));
            if (matureGifts.length === 0)
                return;
            console.log(`[Cron Job] Evaluating ${matureGifts.length} potential records...`);
            for (const candidateGift of matureGifts) {
                try {
                    await db_1.db.transaction(async (tx) => {
                        // 2. Lock the specific gift row using a database level lock (SELECT FOR UPDATE)
                        // This prevents other server instances from picking it up concurrently.
                        const [lockedGift] = await tx
                            .select()
                            .from(schema_1.gifts)
                            .where((0, drizzle_orm_1.eq)(schema_1.gifts.id, candidateGift.id))
                            .for('update');
                        // 3. Defensive Check: Ensure another worker thread did not process this record already
                        if (!lockedGift || lockedGift.status !== 'confirmed') {
                            console.log(`[Cron Job] Gift ${candidateGift.id} already modified by another instance. Skipping.`);
                            return;
                        }
                        // 4. Safely credit the recipient's wallet balance
                        const updatedWallets = await tx
                            .update(schema_1.wallets)
                            .set({
                            balance: (0, drizzle_orm_1.sql) `${schema_1.wallets.balance} + ${lockedGift.amount}`,
                            updatedAt: new Date()
                        })
                            .where((0, drizzle_orm_1.eq)(schema_1.wallets.userId, lockedGift.recipientId))
                            .returning();
                        if (updatedWallets.length === 0) {
                            throw new Error(`Wallet not found for user ID: ${lockedGift.recipientId}`);
                        }
                        // 5. Shift state status values safely to completed
                        await tx
                            .update(schema_1.gifts)
                            .set({ status: 'completed', updatedAt: new Date() })
                            .where((0, drizzle_orm_1.eq)(schema_1.gifts.id, lockedGift.id));
                        // 6. Write history record inside the corrected 'transaction' table structure
                        await tx.insert(schema_1.transaction).values({
                            userId: lockedGift.recipientId,
                            amount: lockedGift.amount,
                            type: 'gift_receive',
                            status: 'success',
                            referenceId: lockedGift.id,
                        });
                        // 7. Insert the in-app notification context
                        await tx.insert(schema_1.notifications).values({
                            userId: lockedGift.recipientId,
                            title: '🎁 Gift Unlocked!',
                            message: `Your time-locked cash gift of ${lockedGift.amount} USDC has been released to your wallet.`,
                            isRead: false,
                        });
                        console.log(`[Cron Job] Successfully released gift ID: ${lockedGift.id}`);
                    });
                }
                catch (giftError) {
                    console.error(`[Cron Job] Failed to process individual gift target ID ${candidateGift.id}:`, giftError);
                }
            }
        }
        catch (error) {
            console.error('[Cron Job] Error executing gift release batch:', error);
        }
        finally {
            isProcessing = false;
        }
    });
};
exports.startGiftReleaseJob = startGiftReleaseJob;
