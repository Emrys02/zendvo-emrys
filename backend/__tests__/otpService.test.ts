import {
  generateOTP,
  storeOTP,
  verifyOTP,
  cleanupExpiredOTPs,
} from "../src/server/services/otpService";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

jest.mock("@/lib/db", () => ({
  db: {
    query: {
      emailVerifications: {
        findFirst: jest.fn(),
      },
      users: {
        findFirst: jest.fn(),
      },
    },
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve()),
      })),
    })),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        returning: jest.fn(() => Promise.resolve([{}])),
      })),
    })),
    delete: jest.fn(() => ({
      where: jest.fn(() => ({
        returning: jest.fn(() => Promise.resolve([{ id: "1" }, { id: "2" }])),
      })),
    })),
    transaction: jest.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        update: jest.fn(() => ({
          set: jest.fn(() => ({
            where: jest.fn(() => Promise.resolve()),
          })),
        })),
        insert: jest.fn(() => ({
          values: jest.fn(() => ({
            returning: jest.fn(() => Promise.resolve([{ id: "ev-new" }])),
          })),
        })),
      };
      return fn(tx);
    }),
  },
}));

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.requireActual("bcryptjs").hash,
}));

describe("OTP Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("generateOTP", () => {
    it("should generate a 6-digit string", () => {
      const otp = generateOTP();
      expect(otp).toHaveLength(6);
      expect(otp).toMatch(/^\d{6}$/);
    });
  });

  describe("storeOTP", () => {
    it("invalidates previous records and inserts new OTP inside a serializable transaction", async () => {
      // Capture the tx object passed to the transaction callback so we can
      // assert that invalidation and insertion happen on the tx, not on db
      // directly.
      let capturedTx: { update: jest.Mock; insert: jest.Mock } | undefined;

      (db.transaction as jest.Mock).mockImplementationOnce(
        async (fn: (tx: unknown) => unknown, opts: { isolationLevel: string }) => {
          expect(opts.isolationLevel).toBe("serializable");

          const tx = {
            update: jest.fn(() => ({
              set: jest.fn(() => ({
                where: jest.fn(() => Promise.resolve()),
              })),
            })),
            insert: jest.fn(() => ({
              values: jest.fn(() => ({
                returning: jest.fn(() =>
                  Promise.resolve([{ id: "ev-new", userId: "user-123" }]),
                ),
              })),
            })),
          };
          capturedTx = tx;
          return fn(tx);
        },
      );

      await storeOTP("user-123", "123456");

      // Transaction was used (not a direct db call).
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(capturedTx!.update).toHaveBeenCalled();  // invalidation inside tx
      expect(capturedTx!.insert).toHaveBeenCalled();  // insertion inside tx
      // The lastOtpSentAt write happens outside the transaction.
      expect(db.update).toHaveBeenCalled();
    });

    it("retries the transaction on serialization failure and succeeds", async () => {
      let callCount = 0;
      const tx = {
        update: jest.fn(() => ({
          set: jest.fn(() => ({
            where: jest.fn(() => Promise.resolve()),
          })),
        })),
        insert: jest.fn(() => ({
          values: jest.fn(() => ({
            returning: jest.fn(() =>
              Promise.resolve([{ id: "ev-new", userId: "user-123" }]),
            ),
          })),
        })),
      };

      (db.transaction as jest.Mock).mockImplementation(
        async (fn: (tx: unknown) => unknown) => {
          callCount++;
          if (callCount < 2) {
            // Simulate a Postgres serialization failure on the first attempt.
            const err = new Error("could not serialize access") as Error & { code: string };
            err.code = "40001";
            throw err;
          }
          return fn(tx);
        },
      );

      await storeOTP("user-123", "123456");

      expect(db.transaction).toHaveBeenCalledTimes(2);
      expect(tx.insert).toHaveBeenCalled();
    });

    it("re-throws after exhausting retries on persistent serialization failure", async () => {
      const err = new Error("could not serialize access") as Error & { code: string };
      err.code = "40001";

      (db.transaction as jest.Mock).mockRejectedValue(err);

      await expect(storeOTP("user-123", "123456")).rejects.toThrow(
        "could not serialize access",
      );

      expect(db.transaction).toHaveBeenCalledTimes(3); // MAX_RETRIES
    });
  });

  describe("verifyOTP", () => {
    it("should fail if no verification found", async () => {
      (db.query.emailVerifications.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await verifyOTP("user-123", "123456");

      expect(result.detail).toBeDefined();
      expect(result.message).toContain("No verification code found");
    });

    it("should fail if expired", async () => {
      (db.query.emailVerifications.findFirst as jest.Mock).mockResolvedValue({
        id: "ev-1",
        otpHash: "salt:hash",
        expiresAt: new Date(Date.now() - 1000),
        attempts: 0,
      });

      const result = await verifyOTP("user-123", "123456");

      expect(result.detail).toBeDefined();
      expect(result.message).toContain("expired");
    });
  });

  describe("cleanupExpiredOTPs", () => {
    it("should return deleted count", async () => {
      const count = await cleanupExpiredOTPs();
      expect(count).toBe(2);
    });
  });
});
