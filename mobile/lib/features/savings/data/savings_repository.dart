import 'package:flutter/foundation.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../models/savings_data_model.dart';

/// Lifecycle of a savings transaction submission, used by UI controllers to
/// render the correct state and to revert cleanly after a permanent failure
/// instead of looping in a "pending" state.
enum SavingsSubmissionStatus {
  /// No submission is in flight.
  idle,

  /// The signed XDR is being submitted to the network.
  submitting,

  /// The submission succeeded and a transaction hash was returned.
  succeeded,

  /// The submission failed permanently; the user can retry.
  failed,
}

/// Handles API interactions for deposits, withdrawals, and polling balance.
///
/// All final XDR submission calls go through [ApiClient.postWithRetry], which
/// retries transient network failures with exponential backoff and maps
/// permanent failures to domain exceptions ([TransactionFailedException],
/// [NetworkCongestedException]) that UI controllers can surface to the user.
class SavingsRepository {
  SavingsRepository({
    ApiClient? apiClient,
    String? baseUrl,
  })  : _apiClient = apiClient ?? ApiClient(),
        _baseUrl = baseUrl ?? defaultBaseUrl;

  /// Backend base URL; override with `--dart-define=API_BASE_URL=...`.
  static const String defaultBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  final ApiClient _apiClient;
  final String _baseUrl;

  /// Observable submission state. Listen to this to drive button/loading
  /// state and to reset out of a pending state on failure.
  final ValueNotifier<SavingsSubmissionStatus> submissionStatus =
      ValueNotifier<SavingsSubmissionStatus>(SavingsSubmissionStatus.idle);

  Future<String> requestDepositXdr(String amount, String accountId) async {
    // TODO: Call backend deposit endpoint via _apiClient.postWithRetry.
    return 'unsigned_deposit_xdr_placeholder';
  }

  /// Submits a signed XDR envelope to the backend relay with automatic
  /// retries for transient network failures.
  ///
  /// On success returns the on-chain transaction hash and flips the
  /// submission state to [SavingsSubmissionStatus.succeeded]. On permanent
  /// failure the state reverts to [SavingsSubmissionStatus.failed] and the
  /// mapped domain exception is rethrown so the caller can inform the user;
  /// call [resetSubmissionState] before attempting the action again.
  Future<String> submitSignedXdr(String signedXdr) async {
    submissionStatus.value = SavingsSubmissionStatus.submitting;
    try {
      final response = await _apiClient.postWithRetry(
        '$_baseUrl/api/transactions/submit',
        {'xdr': signedXdr},
      );
      final hash = response['hash'] as String?;
      if (hash == null || hash.isEmpty) {
        throw const TransactionFailedException(
          'The network accepted the transaction but did not return a hash.',
        );
      }
      submissionStatus.value = SavingsSubmissionStatus.succeeded;
      return hash;
    } on ApiException {
      submissionStatus.value = SavingsSubmissionStatus.failed;
      rethrow;
    } catch (error) {
      submissionStatus.value = SavingsSubmissionStatus.failed;
      throw TransactionFailedException(
        'Failed to submit the transaction. Please try again.',
        cause: error,
      );
    }
  }

  /// Reverts the submission state to idle so the user can attempt the action
  /// again without being stuck in a looping "pending" state.
  void resetSubmissionState() {
    submissionStatus.value = SavingsSubmissionStatus.idle;
  }

  Future<SavingsDataModel> fetchSavingsDashboardData(String accountId) async {
    // TODO: Call backend balance/apy endpoint via _apiClient.postWithRetry.
    return SavingsDataModel(balance: '0.0', apy: '0.0');
  }
}
