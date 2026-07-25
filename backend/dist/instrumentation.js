"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        const { checkMigrationStatus } = await Promise.resolve().then(() => __importStar(require("./lib/db/migration-checker")));
        console.log("🔍 Checking database migration status...");
        try {
            const status = await checkMigrationStatus();
            if (status.inSync) {
                console.log(status.message);
            }
            else {
                console.error(status.message);
                console.error("⚠️  Server will continue, but database operations may fail.");
                console.error("   Run 'npm run db:migrate' or 'npx drizzle-kit push' to sync the database.");
                if (process.env.NODE_ENV === "production" &&
                    process.env.STRICT_MIGRATION_CHECK === "true") {
                    console.error("❌ STRICT_MIGRATION_CHECK enabled. Halting startup.");
                    process.exit(1);
                }
            }
        }
        catch (error) {
            console.error("❌ Failed to check migration status:", error);
            console.error("⚠️  Server will continue, but this should be investigated.");
        }
        // --- CRON JOB HERE ---
        try {
            console.log("⏰ Initializing background task schedulers...");
            const { startGiftReleaseJob } = await Promise.resolve().then(() => __importStar(require("./server/jobs/giftReleaseJob")));
            startGiftReleaseJob();
            console.log("🚀 Scheduled Gift Release Cron Job successfully running.");
        }
        catch (cronError) {
            console.error("❌ Failed to initialize background cron jobs:", cronError);
        }
        // --------------------------------
    }
}
