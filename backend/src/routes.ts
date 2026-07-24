import { Router } from "express";
import { makeExpressHandler } from "./adapter";

// Auth
import { POST as authPost } from "./api/auth/route";
// Dashboard
import { GET as dashboardStatsGet } from "./api/dashboard/stats/route";
import { POST as giftsMetadataPost } from "./api/gifts/metadata/route";
import { POST as forgotPasswordPost } from "./api/auth/forgot-password/route";
import { POST as loginPost } from "./api/auth/login/route";
import { POST as logoutPost } from "./api/auth/logout/route";
import { GET as meGet } from "./api/auth/me/route";
import { POST as refreshPost } from "./api/auth/refresh/route";
import { POST as registerPost } from "./api/auth/register/route";
import { POST as resendOtpPost } from "./api/auth/resend-otp/route";
import { POST as resendVerificationPost } from "./api/auth/resend-verification/route";
import { POST as resetPasswordPost } from "./api/auth/reset-password/route";
import { POST as revokePost } from "./api/auth/revoke/route";
import { POST as sendOtpPost } from "./api/auth/send-otp/route";
import { POST as sendPhoneOtpPost } from "./api/auth/send-phone-otp/route";
import { POST as sendVerificationPost } from "./api/auth/send-verification/route";
import { POST as verifyEmailPost } from "./api/auth/verify-email/route";
import { POST as verifyOtpPost } from "./api/auth/verify-otp/route";

export const apiRouter = Router();

// 1. Authentication routes
apiRouter.post("/api/auth", makeExpressHandler(authPost));
apiRouter.post("/api/auth/forgot-password", makeExpressHandler(forgotPasswordPost));
apiRouter.post("/api/auth/login", makeExpressHandler(loginPost));
apiRouter.post("/api/auth/logout", makeExpressHandler(logoutPost));
apiRouter.get("/api/auth/me", makeExpressHandler(meGet));
apiRouter.post("/api/auth/refresh", makeExpressHandler(refreshPost));
apiRouter.post("/api/auth/register", makeExpressHandler(registerPost));
apiRouter.post("/api/auth/resend-otp", makeExpressHandler(resendOtpPost));
apiRouter.post("/api/auth/resend-verification", makeExpressHandler(resendVerificationPost));
apiRouter.post("/api/auth/reset-password", makeExpressHandler(resetPasswordPost));
apiRouter.post("/api/auth/revoke", makeExpressHandler(revokePost));
apiRouter.post("/api/auth/send-otp", makeExpressHandler(sendOtpPost));
apiRouter.post("/api/auth/send-phone-otp", makeExpressHandler(sendPhoneOtpPost));
apiRouter.post("/api/auth/send-verification", makeExpressHandler(sendVerificationPost));
apiRouter.post("/api/auth/verify-email", makeExpressHandler(verifyEmailPost));
apiRouter.post("/api/auth/verify-otp", makeExpressHandler(verifyOtpPost));

// 2. Dashboard routes
apiRouter.get("/api/dashboard/stats", makeExpressHandler(dashboardStatsGet));

// 3. Gifts routes
apiRouter.post("/api/gifts/metadata", makeExpressHandler(giftsMetadataPost));
