import cron from 'node-cron';
import { db } from "@/lib/db";
import { gifts, wallets, transactions, notifications } from "@/lib/db/schema";
import { eq, and, lte, sql } from "drizzle-orm";

let isProcessing = false;

export const startGiftReleaseJob = () => {
  cron.schedule('*/1 * * * *', async () => {
    if (isProcessing) {
      console.warn('[Cron Job] Previous execution is still active. Skipping tick.');
      return;
    }

    try {
      isProcessing = true;
      const now = new Date();

      console.log('[Cron Job] Checking for mature time-locked gifts...');

      // 1. Find all potential candidate records that passed their unlock window
      const matureGifts = await db
        .select()
        .from(gifts)
        .where(
          and(
            eq(gifts.status, 'confirmed'),
            lte(gifts.unlockDatetime, now)
          )
        );

      if (matureGifts.length === 0) return;

      console.log(`[Cron Job] Evaluating ${matureGifts.length} potential records...`);

      for (const candidateGift of matureGifts) {
        try {
          await db.transaction(async (tx) => {
            
            // 2. Lock the specific gift row using a database level lock (SELECT FOR UPDATE)
            // This prevents other server instances from picking it up concurrently.
            const [lockedGift] = await tx
              .select()
              .from(gifts)
              .where(eq(gifts.id, candidateGift.id))
              .for('update');

            // 3. Defensive Check: Ensure another worker thread did not process this record already
            if (!lockedGift || lockedGift.status !== 'confirmed') {
              console.log(`[Cron Job] Gift ${candidateGift.id} already modified by another instance. Skipping.`);
              return;
            }

            // 4. Safely credit the recipient's wallet balance
            const updatedWallets = await tx
              .update(wallets)
              .set({ 
                balance: sql`${wallets.balance} + ${lockedGift.amount}`, 
                updatedAt: new Date() 
              })
              .where(eq(wallets.userId, lockedGift.recipientId))
              .returning();

            if (updatedWallets.length === 0) {
              throw new Error(`Wallet not found for user ID: ${lockedGift.recipientId}`);
            }

            // 5. Shift state status values safely to completed
            await tx
              .update(gifts)
              .set({ status: 'completed', updatedAt: new Date() })
              .where(eq(gifts.id, lockedGift.id));

            // 6. Write history record inside the corrected 'transaction' table structure
            await tx.insert(transactions).values({
              userId: lockedGift.recipientId,
              amount: lockedGift.amount,
              type: 'transfer',
              status: 'completed',
              currency: 'USDC',
              reference: lockedGift.id,
            });

            // 7. Insert the in-app notification context
            await tx.insert(notifications).values({
              userId: lockedGift.recipientId,
              type: 'gift_unlocked',
              title: 'Gift Unlocked!',
              message: `Your time-locked cash gift of ${lockedGift.amount} USDC has been released to your wallet.`,
              read: false,
            });

            console.log(`[Cron Job] Successfully released gift ID: ${lockedGift.id}`);
          });
        } catch (giftError) {
          console.error(`[Cron Job] Failed to process individual gift target ID ${candidateGift.id}:`, giftError);
        }
      }
    } catch (error) {
      console.error('[Cron Job] Error executing gift release batch:', error);
    } finally {
      isProcessing = false;
    }
  });
};