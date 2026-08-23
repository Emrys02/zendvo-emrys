# PR: Robust XDR Network Submission Service

## Summary
Implemented a robust XDR network submission service and API endpoint for submitting signed transactions to the Stellar network with retry logic, error handling, and proper database logging.

## Changes Made

### 1. `backend/src/lib/stellar/submission_service.ts` (NEW)
- **`SubmissionService`** class with configurable retry logic
- **`submitXdrToNetwork()`** - Public method submitting XDR to Horizon with exponential backoff (1s, 2s, 4s, 8s, 16s capped at 30s, max 5 attempts)
- **`submitAttempt()`** - Validates XDR format (base64), submits to Horizon, handles various error conditions
- **`SubmissionResult`** interface - Returns `{ success, hash, error, status, attempts }`
- **`SubmitXdrResponse`** interface - Shape of Horizon's JSON response
- Features: base64 validation, Horizon error parsing, retryable error detection (502/503/504), network timeout handling

### 2. `backend/src/api/transactions/submit.ts` (MODIFIED - replaced placeholder)
- **`POST /api/transactions/submit`** endpoint
- Authenticates request via `getAuthPayload`
- Validates signed XDR input
- Submits via `SubmissionService.submitXdrToNetwork()`
- Logs successful submissions to `transactions` table
- Returns structured JSON responses using `createProblemDetails` error pattern

### 3. `backend/src/routes.ts` (MODIFIED)
- Added import: `POST as transactionSubmitPost` from `./api/transactions/submit`
- Registered route: `apiRouter.post("/api/transactions/submit", makeExpressHandler(transactionSubmitPost))`

## API endpoint
```
POST /api/transactions/submit
Body: { "signedXdr": "base64_xdr_string" }
Auth: Required (user JWT)
Success: 200 { success: true, hash, status, attempts }
Error: 400/401/500 with Problem Details format
```

## Testing
- All 34 existing test suites pass (281 tests)
- No breaking changes to existing functionality
- Follows existing codebase patterns (auth, error handling, API utils)

## Dependencies
- Uses existing `@stellar/stellar-sdk` (already in dependencies)
- Uses existing `drizzle-orm` for database logging
- Uses existing `createProblemDetails` from `lib/api-utils`