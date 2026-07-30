export enum AuditEventType {
  OTP_GENERATED = "OTP_GENERATED",
  OTP_VERIFIED_SUCCESS = "OTP_VERIFIED_SUCCESS",
  OTP_VERIFIED_FAILED = "OTP_VERIFIED_FAILED",
  ACCOUNT_LOCKED_5_ATTEMPTS = "ACCOUNT_LOCKED_5_ATTEMPTS",
  ACCOUNT_LOCKED_10_ATTEMPTS = "ACCOUNT_LOCKED_10_ATTEMPTS",
  ACCOUNT_UNLOCKED = "ACCOUNT_UNLOCKED",
  ACCOUNT_DELETION_REQUESTED = "ACCOUNT_DELETION_REQUESTED",
  ACCOUNT_DELETION_ACTION_TOKEN_GENERATED = "ACCOUNT_DELETION_ACTION_TOKEN_GENERATED",
  ACCOUNT_DELETION_COMPLETED = "ACCOUNT_DELETION_COMPLETED",
  ACCOUNT_DELETION_FAILED = "ACCOUNT_DELETION_FAILED",
  GIFT_CANCELLED_FOR_DELETION = "GIFT_CANCELLED_FOR_DELETION",
}

interface AuditLogEntry {
  timestamp: Date;
  eventType: AuditEventType;
  userId?: string;
  metadata?: Record<string, unknown>;
  message: string;
}


export function logAuditEvent(entry: AuditLogEntry): void {
  const logEntry = {
    ...entry,
    timestamp: entry.timestamp.toISOString(),
  };

  
  console.log("[SECURITY_AUDIT]", JSON.stringify(logEntry));
}


export function logOTPEvent(
  eventType: AuditEventType,
  userId: string,
  metadata?: Record<string, unknown>,
): void {
  logAuditEvent({
    timestamp: new Date(),
    eventType,
    userId,
    metadata,
    message: `OTP event: ${eventType} for user ${userId}`,
  });
}

