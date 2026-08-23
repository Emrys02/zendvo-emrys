import { StrKey } from "@stellar/stellar-sdk";

export interface SubmitXdrResponse {
  hash: string;
  fee: number;
  operationCount: number;
  resultXdr?: string;
  resultMetaXdr?: string;
  txXdr?: string;
}

export interface SubmissionResult {
  success: boolean;
  hash?: string;
  error?: string;
  status?: string;
  attempts: number;
}

export class SubmissionService {
  private static MAX_RETRIES = 5;
  private static BASE_DELAY_MS = 1000;
  private static MAX_DELAY_MS = 30000;

  static async submitXdrToNetwork(
    signedXdr: string,
    maxRetries?: number
  ): Promise<SubmissionResult> {
    const retries = maxRetries ?? SubmissionService.MAX_RETRIES;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await SubmissionService.submitAttempt(signedXdr);
        if (result.success) {
          return {
            success: true,
            hash: result.hash,
            status: "success",
            attempts: attempt,
          };
        }
        lastError = new Error(result.error || "Unknown submission error");
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown submission error");
      }

      // If this is the last attempt, break without waiting
      if (attempt >= retries) {
        break;
      }

      // Calculate exponential backoff delay
      const delay = Math.min(
        SubmissionService.BASE_DELAY_MS * 2 ** (attempt - 1),
        SubmissionService.MAX_DELAY_MS
      );

      await SubmissionService.sleep(delay);
    }

    return {
      success: false,
      error: lastError?.message || "Max retries exceeded",
      status: "failed",
      attempts: retries,
    };
  }

  private static async submitAttempt(signedXdr: string): Promise<{ success: boolean; hash?: string; error?: string }> {
    // Validate that the XDR is a valid base64 string
    if (!signedXdr || typeof signedXdr !== "string") {
      return { success: false, error: "Invalid XDR: must be a non-empty string" };
    }

    // Validate XDR format (base64 check)
    try {
      // Attempt to decode the XDR to validate it
      const decoder = btoa;
      // Basic validation - XDR should be base64-encoded
      if (!signedXdr.match(/^[A-Za-z0-9+/]+=*$/)) {
        return { success: false, error: "Invalid XDR format: not valid base64" };
      }
    } catch {
      return { success: false, error: "Invalid XDR format: base64 decoding failed" };
    }

    try {
      // Submit the XDR to Horizon
      const horizonUrl = process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";

      const response = await fetch(`${horizonUrl}/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/xdr",
        },
        body: signedXdr,
        timeout: 30000,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage = `Horizon responded with ${response.status}`;

        try {
          const errorJson = JSON.parse(errorBody);
          if (errorJson.extras && errorJson.extras.result_codes) {
            errorMessage = `Transaction failed: ${errorJson.extras.result_codes}`;
          } else if (errorJson.type) {
            errorMessage = `Horizon error: ${errorJson.type} - ${errorJson.explanation || errorMessage}`;
          }
        } catch {
          errorMessage = `Horizon error: ${response.status} - ${errorBody}`;
        }

        // Check if it's a known retryable error
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          return { success: false, error: `Network error (${response.status}): ${errorMessage}` };
        }

        return { success: false, error: errorMessage };
      }

      const data = (await response.json()) as SubmitXdrResponse;

      if (!data.hash) {
        return { success: false, error: "Submission succeeded but no hash returned from Horizon" };
      }

      return {
        success: true,
        hash: data.hash,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown submission error");

      // Network errors or timeouts - retryable
      if (
        err.message.includes("timeout") ||
        err.message.includes("network") ||
        err.message instanceof TypeError
      ) {
        throw err; // Will be caught by the retry loop
      }

      return { success: false, error: err.message };
    }
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}