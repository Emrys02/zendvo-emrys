"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRouter = void 0;
const express_1 = require("express");
const adapter_1 = require("./adapter");
// Middleware to limit request size for uploads
const limitUploadSize = (req, res, next) => {
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_FILE_SIZE) {
        return res.status(413).json({
            type: "about:blank",
            title: "Payload Too Large",
            status: 413,
            detail: "Request body exceeds the 10MB limit."
        });
    }
    next();
};
// Auth
const route_1 = require("./api/auth/route");
const route_2 = require("./api/auth/forgot-password/route");
const route_3 = require("./api/auth/login/route");
const route_4 = require("./api/auth/logout/route");
const route_5 = require("./api/auth/me/route");
const route_6 = require("./api/auth/refresh/route");
const route_7 = require("./api/auth/register/route");
const route_8 = require("./api/auth/resend-otp/route");
const route_9 = require("./api/auth/resend-verification/route");
const route_10 = require("./api/auth/reset-password/route");
const route_11 = require("./api/auth/revoke/route");
const route_12 = require("./api/auth/send-otp/route");
const route_13 = require("./api/auth/send-phone-otp/route");
const route_14 = require("./api/auth/send-verification/route");
const route_15 = require("./api/auth/verify-email/route");
const route_16 = require("./api/auth/verify-otp/route");
// Upload
const route_17 = require("./api/upload/image/route");
exports.apiRouter = (0, express_1.Router)();
// 1. Authentication routes
exports.apiRouter.post("/api/auth", (0, adapter_1.makeExpressHandler)(route_1.POST));
exports.apiRouter.post("/api/auth/forgot-password", (0, adapter_1.makeExpressHandler)(route_2.POST));
exports.apiRouter.post("/api/auth/login", (0, adapter_1.makeExpressHandler)(route_3.POST));
exports.apiRouter.post("/api/auth/logout", (0, adapter_1.makeExpressHandler)(route_4.POST));
exports.apiRouter.get("/api/auth/me", (0, adapter_1.makeExpressHandler)(route_5.GET));
exports.apiRouter.post("/api/auth/refresh", (0, adapter_1.makeExpressHandler)(route_6.POST));
exports.apiRouter.post("/api/auth/register", (0, adapter_1.makeExpressHandler)(route_7.POST));
exports.apiRouter.post("/api/auth/resend-otp", (0, adapter_1.makeExpressHandler)(route_8.POST));
exports.apiRouter.post("/api/auth/resend-verification", (0, adapter_1.makeExpressHandler)(route_9.POST));
exports.apiRouter.post("/api/auth/reset-password", (0, adapter_1.makeExpressHandler)(route_10.POST));
exports.apiRouter.post("/api/auth/revoke", (0, adapter_1.makeExpressHandler)(route_11.POST));
exports.apiRouter.post("/api/auth/send-otp", (0, adapter_1.makeExpressHandler)(route_12.POST));
exports.apiRouter.post("/api/auth/send-phone-otp", (0, adapter_1.makeExpressHandler)(route_13.POST));
exports.apiRouter.post("/api/auth/send-verification", (0, adapter_1.makeExpressHandler)(route_14.POST));
exports.apiRouter.post("/api/auth/verify-email", (0, adapter_1.makeExpressHandler)(route_15.POST));
exports.apiRouter.post("/api/auth/verify-otp", (0, adapter_1.makeExpressHandler)(route_16.POST));
// 2. Upload routes
exports.apiRouter.post("/api/upload/image", limitUploadSize, (0, adapter_1.makeExpressHandler)(route_17.POST));
