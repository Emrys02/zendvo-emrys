"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionsRelations = exports.bankAccountsRelations = exports.notificationsRelations = exports.walletsRelations = exports.giftsRelations = exports.refreshTokensRelations = exports.passwordResetsRelations = exports.emailVerificationsRelations = exports.usersRelations = exports.webhookRetryQueue = exports.transactions = exports.bankAccounts = exports.transactionTypeEnum = exports.transactionStatusEnum = exports.notifications = exports.wallets = exports.gifts = exports.giftStatusEnum = exports.refreshTokens = exports.passwordResets = exports.emailVerifications = exports.users = exports.userStatusEnum = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
exports.userStatusEnum = (0, pg_core_1.pgEnum)("user_status", [
    "unverified",
    "active",
    "suspended",
]);
exports.users = (0, pg_core_1.pgTable)("users", {
    id: (0, pg_core_1.uuid)("id").defaultRandom().primaryKey(),
    email: (0, pg_core_1.text)("email").notNull(),
    passwordHash: (0, pg_core_1.text)("password_hash").notNull(),
    name: (0, pg_core_1.text)("name"),
    phoneNumber: (0, pg_core_1.text)("phone_number"),
    username: (0, pg_core_1.text)("username"),
    avatarUrl: (0, pg_core_1.text)("avatar_url"),
    role: (0, pg_core_1.text)("role").default("user").notNull(),
    status: (0, exports.userStatusEnum)("status").default("unverified").notNull(),
    loginAttempts: (0, pg_core_1.integer)("login_attempts").default(0).notNull(),
    lockUntil: (0, pg_core_1.timestamp)("lock_until"),
    otpFailedAttempts: (0, pg_core_1.integer)("otp_failed_attempts").default(0).notNull(),
    otpAttemptsWindowStart: (0, pg_core_1.timestamp)("otp_attempts_window_start"),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow().notNull(),
    lastLogin: (0, pg_core_1.timestamp)("last_login"),
    lastOtpSentAt: (0, pg_core_1.timestamp)("last_otp_sent_at"),
    isPhoneVerified: (0, pg_core_1.boolean)("is_phone_verified").default(false).notNull(),
    phoneLast4: (0, pg_core_1.text)("phone_last_4"),
}, (table) => {
    return [
        (0, pg_core_1.unique)("users_phone_number_unique").on(table.phoneNumber),
        (0, pg_core_1.unique)("users_email_unique").on(table.email),
        (0, pg_core_1.unique)("users_username_unique").on(table.username),
        (0, pg_core_1.index)("users_phone_number_idx").on(table.phoneNumber),
        (0, pg_core_1.index)("users_status_idx").on(table.status),
        (0, pg_core_1.index)("users_created_at_idx").on(table.createdAt),
    ];
});
exports.emailVerifications = (0, pg_core_1.pgTable)("email_verifications", {
    id: (0, pg_core_1.uuid)("id").defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)("user_id")
        .notNull()
        .references(() => exports.users.id),
    otpHash: (0, pg_core_1.text)("otp_hash").notNull(),
    expiresAt: (0, pg_core_1.timestamp)("expires_at").notNull(),
    attempts: (0, pg_core_1.integer)("attempts").default(0).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
    isUsed: (0, pg_core_1.boolean)("is_used").default(false).notNull(),
}, (table) => {
    return [
        (0, pg_core_1.index)("ev_user_id_idx").on(table.userId),
        (0, pg_core_1.index)("ev_expires_at_idx").on(table.expiresAt),
    ];
});
exports.passwordResets = (0, pg_core_1.pgTable)("password_resets", {
    id: (0, pg_core_1.uuid)("id").defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)("user_id")
        .notNull()
        .references(() => exports.users.id),
    token: (0, pg_core_1.text)("token").notNull().unique(),
    expiresAt: (0, pg_core_1.timestamp)("expires_at").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
    usedAt: (0, pg_core_1.timestamp)("used_at"),
    ipAddress: (0, pg_core_1.text)("ip_address"),
}, (table) => {
    return [
        (0, pg_core_1.index)("pr_user_id_idx").on(table.userId),
        (0, pg_core_1.index)("pr_expires_at_idx").on(table.expiresAt),
    ];
});
exports.refreshTokens = (0, pg_core_1.pgTable)("refresh_tokens", {
    id: (0, pg_core_1.uuid)("id").defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)("user_id")
        .notNull()
        .references(() => exports.users.id),
    token: (0, pg_core_1.text)("token").notNull().unique(),
    expiresAt: (0, pg_core_1.timestamp)("expires_at").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
    revokedAt: (0, pg_core_1.timestamp)("revoked_at"),
    deviceInfo: (0, pg_core_1.text)("device_info"),
    deviceId: (0, pg_core_1.text)("device_id"),
    fingerprint: (0, pg_core_1.text)("fingerprint"),
}, (table) => {
    return [(0, pg_core_1.index)("rt_user_id_idx").on(table.userId)];
});
exports.giftStatusEnum = (0, pg_core_1.pgEnum)("gift_status", [
    "pending_otp",
    "otp_verified",
    "pending_review",
    "confirmed",
    "completed",
    "sent",
    "failed",
]);
exports.gifts = (0, pg_core_1.pgTable)("gifts", {
    id: (0, pg_core_1.uuid)("id").defaultRandom().primaryKey(),
    senderId: (0, pg_core_1.uuid)("sender_id").references(() => exports.users.id),
    recipientId: (0, pg_core_1.uuid)("recipient_id").notNull().references(() => exports.users.id),
    amount: (0, pg_core_1.doublePrecision)("amount").notNull(),
    fee: (0, pg_core_1.doublePrecision)("fee").default(0).notNull(),
    totalAmount: (0, pg_core_1.doublePrecision)("total_amount").notNull(),
    currency: (0, pg_core_1.text)("currency").notNull(),
    message: (0, pg_core_1.text)("message"),
    template: (0, pg_core_1.text)("template"),
    status: (0, exports.giftStatusEnum)("status").default("pending_otp").notNull(),
    otpHash: (0, pg_core_1.text)("otp_hash"),
    otpExpiresAt: (0, pg_core_1.timestamp)("otp_expires_at"),
    otpAttempts: (0, pg_core_1.integer)("otp_attempts").default(0).notNull(),
    transactionId: (0, pg_core_1.text)("transaction_id").unique(),
    blockchainTxHash: (0, pg_core_1.text)("blockchain_tx_hash"),
    paymentReference: (0, pg_core_1.text)("payment_reference").unique("gift_payment_reference_unique"),
    paymentProvider: (0, pg_core_1.text)("payment_provider"),
    paymentVerifiedAt: (0, pg_core_1.timestamp)("payment_verified_at"),
    hideAmount: (0, pg_core_1.boolean)("hide_amount").default(false).notNull(),
    hideSender: (0, pg_core_1.boolean)("hide_sender").default(false).notNull(),
    isAnonymous: (0, pg_core_1.boolean)("is_anonymous").default(false).notNull(),
    unlockDatetime: (0, pg_core_1.timestamp)("unlock_datetime"),
    senderName: (0, pg_core_1.text)("sender_name"),
    senderEmail: (0, pg_core_1.text)("sender_email"),
    senderAvatar: (0, pg_core_1.text)("sender_avatar"),
    shareLink: (0, pg_core_1.text)("share_link").unique(),
    shareLinkToken: (0, pg_core_1.text)("share_link_token").unique(),
    slug: (0, pg_core_1.text)("slug").unique(),
    shortCode: (0, pg_core_1.text)("short_code").unique(),
    coverImageId: (0, pg_core_1.text)("cover_image_id"),
    linkExpiresAt: (0, pg_core_1.timestamp)("link_expires_at"),
    completedAt: (0, pg_core_1.timestamp)("completed_at"),
    recipientPhone: (0, pg_core_1.text)("recipient_phone"),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("gift_sender_id_idx").on(table.senderId),
    (0, pg_core_1.index)("gift_recipient_id_idx").on(table.recipientId),
    (0, pg_core_1.index)("gift_status_idx").on(table.status),
    (0, pg_core_1.index)("gift_sender_email_recipient_idx").on(table.senderEmail, table.recipientId),
    (0, pg_core_1.index)("gift_share_link_token_idx").on(table.shareLinkToken),
    (0, pg_core_1.index)("gift_slug_idx").on(table.slug),
    (0, pg_core_1.index)("gift_short_code_idx").on(table.shortCode),
    (0, pg_core_1.index)("gift_blockchain_tx_hash_idx").on(table.blockchainTxHash),
]);
exports.wallets = (0, pg_core_1.pgTable)("wallets", {
    id: (0, pg_core_1.uuid)("id").defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id),
    currency: (0, pg_core_1.text)("currency").notNull(),
    balance: (0, pg_core_1.doublePrecision)("balance").default(0).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.unique)("wallet_user_currency_key").on(table.userId, table.currency),
    (0, pg_core_1.index)("wallet_user_id_idx").on(table.userId),
]);
exports.notifications = (0, pg_core_1.pgTable)("notifications", {
    id: (0, pg_core_1.uuid)("id").defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id),
    type: (0, pg_core_1.text)("type").notNull(),
    title: (0, pg_core_1.text)("title").notNull(),
    message: (0, pg_core_1.text)("message").notNull(),
    read: (0, pg_core_1.boolean)("read").default(false).notNull(),
    metadata: (0, pg_core_1.text)("metadata"),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("notif_user_id_idx").on(table.userId),
    (0, pg_core_1.index)("notif_created_at_idx").on(table.createdAt),
]);
exports.transactionStatusEnum = (0, pg_core_1.pgEnum)("transaction_status", [
    "pending",
    "completed",
    "failed",
]);
exports.transactionTypeEnum = (0, pg_core_1.pgEnum)("transaction_type", [
    "deposit",
    "withdrawal",
    "transfer",
]);
exports.bankAccounts = (0, pg_core_1.pgTable)("bank_accounts", {
    id: (0, pg_core_1.uuid)("id").defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id),
    country: (0, pg_core_1.text)("country").notNull(),
    currency: (0, pg_core_1.text)("currency").notNull(),
    swiftBic: (0, pg_core_1.text)("swift_bic").notNull(),
    accountNumber: (0, pg_core_1.text)("account_number").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("bank_accounts_user_id_idx").on(table.userId),
]);
exports.transactions = (0, pg_core_1.pgTable)("transactions", {
    id: (0, pg_core_1.uuid)("id").defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id),
    walletId: (0, pg_core_1.uuid)("wallet_id").references(() => exports.wallets.id),
    type: (0, exports.transactionTypeEnum)("type").notNull(),
    status: (0, exports.transactionStatusEnum)("status").default("pending").notNull(),
    amount: (0, pg_core_1.doublePrecision)("amount").notNull(),
    currency: (0, pg_core_1.text)("currency").notNull(),
    reference: (0, pg_core_1.text)("reference"),
    provider: (0, pg_core_1.text)("provider"),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("tx_user_id_idx").on(table.userId),
    (0, pg_core_1.index)("tx_wallet_id_idx").on(table.walletId),
    (0, pg_core_1.index)("tx_created_at_idx").on(table.createdAt),
]);
exports.webhookRetryQueue = (0, pg_core_1.pgTable)("WebhookRetryQueue", {
    id: (0, pg_core_1.uuid)("id").defaultRandom().primaryKey(),
    eventType: (0, pg_core_1.text)("event_type").notNull(),
    payload: (0, pg_core_1.jsonb)("payload").notNull(),
    retryCount: (0, pg_core_1.integer)("retry_count").default(0).notNull(),
    maxRetries: (0, pg_core_1.integer)("max_retries").default(5).notNull(),
    nextAttemptAt: (0, pg_core_1.timestamp)("next_attempt_at", { withTimezone: true }).notNull(),
    lastError: (0, pg_core_1.text)("last_error"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
exports.usersRelations = (0, drizzle_orm_1.relations)(exports.users, ({ many }) => ({
    emailVerifications: many(exports.emailVerifications),
    passwordResets: many(exports.passwordResets),
    refreshTokens: many(exports.refreshTokens),
    wallets: many(exports.wallets),
    notifications: many(exports.notifications),
    sentGifts: many(exports.gifts, { relationName: "sentGifts" }),
    receivedGifts: many(exports.gifts, { relationName: "receivedGifts" }),
    bankAccounts: many(exports.bankAccounts),
    transactions: many(exports.transactions),
}));
exports.emailVerificationsRelations = (0, drizzle_orm_1.relations)(exports.emailVerifications, ({ one }) => ({
    user: one(exports.users, {
        fields: [exports.emailVerifications.userId],
        references: [exports.users.id],
    }),
}));
exports.passwordResetsRelations = (0, drizzle_orm_1.relations)(exports.passwordResets, ({ one }) => ({
    user: one(exports.users, {
        fields: [exports.passwordResets.userId],
        references: [exports.users.id],
    }),
}));
exports.refreshTokensRelations = (0, drizzle_orm_1.relations)(exports.refreshTokens, ({ one }) => ({
    user: one(exports.users, {
        fields: [exports.refreshTokens.userId],
        references: [exports.users.id],
    }),
}));
exports.giftsRelations = (0, drizzle_orm_1.relations)(exports.gifts, ({ one }) => ({
    sender: one(exports.users, {
        fields: [exports.gifts.senderId],
        references: [exports.users.id],
        relationName: "sentGifts",
    }),
    recipient: one(exports.users, {
        fields: [exports.gifts.recipientId],
        references: [exports.users.id],
        relationName: "receivedGifts",
    }),
}));
exports.walletsRelations = (0, drizzle_orm_1.relations)(exports.wallets, ({ one, many }) => ({
    user: one(exports.users, { fields: [exports.wallets.userId], references: [exports.users.id] }),
    transactions: many(exports.transactions),
}));
exports.notificationsRelations = (0, drizzle_orm_1.relations)(exports.notifications, ({ one }) => ({
    user: one(exports.users, { fields: [exports.notifications.userId], references: [exports.users.id] }),
}));
exports.bankAccountsRelations = (0, drizzle_orm_1.relations)(exports.bankAccounts, ({ one }) => ({
    user: one(exports.users, { fields: [exports.bankAccounts.userId], references: [exports.users.id] }),
}));
exports.transactionsRelations = (0, drizzle_orm_1.relations)(exports.transactions, ({ one }) => ({
    user: one(exports.users, { fields: [exports.transactions.userId], references: [exports.users.id] }),
    wallet: one(exports.wallets, { fields: [exports.transactions.walletId], references: [exports.wallets.id] }),
}));
