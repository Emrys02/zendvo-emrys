type CooldownStore = {
  [key: string]: number; // key: `${userId}:${action}`, value: timestamp of last OTP request
};

let store: CooldownStore = {};

export interface CooldownCheckResult {
  isRateLimited: boolean;
  remainingMs: number;
  retryAfterSeconds: number;
}

/**
 * Checks if the user is in a cooldown period for a specific action.
 *
 * @param userId Authenticated user ID
 * @param action Action name (defaults to "default")
 * @param cooldownMs Cooldown window in milliseconds (defaults to 60000ms / 60 seconds)
 * @returns CooldownCheckResult
 */
export function checkActionOtpCooldown(
  userId: string,
  action: string = "default",
  cooldownMs: number = 60000,
): CooldownCheckResult {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const lastTime = store[key];

  if (lastTime && now - lastTime < cooldownMs) {
    const remainingMs = cooldownMs - (now - lastTime);
    const retryAfterSeconds = Math.ceil(remainingMs / 1000);
    return {
      isRateLimited: true,
      remainingMs,
      retryAfterSeconds,
    };
  }

  return {
    isRateLimited: false,
    remainingMs: 0,
    retryAfterSeconds: 0,
  };
}

/**
 * Records an OTP request for a given user ID and action.
 */
export function recordActionOtpRequest(
  userId: string,
  action: string = "default",
): void {
  const key = `${userId}:${action}`;
  store[key] = Date.now();
}

/**
 * Clears the in-memory cooldown store (useful for tests).
 */
export function resetCooldownStore(): void {
  store = {};
}
