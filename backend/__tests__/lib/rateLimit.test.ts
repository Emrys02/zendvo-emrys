import {
  checkActionOtpCooldown,
  recordActionOtpRequest,
  resetCooldownStore,
} from "../../src/lib/middleware/rateLimit";

describe("Action OTP Cooldown Rate Limiter", () => {
  const mockUserId = "user-123";
  const mockAction = "password_reset";

  beforeEach(() => {
    resetCooldownStore();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should allow initial request when no record exists", () => {
    const result = checkActionOtpCooldown(mockUserId, mockAction);
    expect(result.isRateLimited).toBe(false);
    expect(result.remainingMs).toBe(0);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it("should block request if within 60 seconds of recording", () => {
    recordActionOtpRequest(mockUserId, mockAction);

    const result = checkActionOtpCooldown(mockUserId, mockAction, 60000);
    expect(result.isRateLimited).toBe(true);
    expect(result.remainingMs).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBe(60);
  });

  it("should return correct remaining seconds when time advances partially", () => {
    recordActionOtpRequest(mockUserId, mockAction);

    // Advance 25 seconds
    jest.advanceTimersByTime(25000);

    const result = checkActionOtpCooldown(mockUserId, mockAction, 60000);
    expect(result.isRateLimited).toBe(true);
    expect(result.retryAfterSeconds).toBe(35);
  });

  it("should allow request after 60 seconds cooldown expires", () => {
    recordActionOtpRequest(mockUserId, mockAction);

    // Advance 61 seconds
    jest.advanceTimersByTime(61000);

    const result = checkActionOtpCooldown(mockUserId, mockAction, 60000);
    expect(result.isRateLimited).toBe(false);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it("should track cooldown separately per action for the same user", () => {
    recordActionOtpRequest(mockUserId, "action1");

    const result1 = checkActionOtpCooldown(mockUserId, "action1", 60000);
    const result2 = checkActionOtpCooldown(mockUserId, "action2", 60000);

    expect(result1.isRateLimited).toBe(true);
    expect(result2.isRateLimited).toBe(false);
  });

  it("should track cooldown separately per user ID for the same action", () => {
    recordActionOtpRequest("user-1", mockAction);

    const result1 = checkActionOtpCooldown("user-1", mockAction, 60000);
    const result2 = checkActionOtpCooldown("user-2", mockAction, 60000);

    expect(result1.isRateLimited).toBe(true);
    expect(result2.isRateLimited).toBe(false);
  });
});
