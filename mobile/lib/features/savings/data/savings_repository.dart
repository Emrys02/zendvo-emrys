import '../../../core/errors/exceptions.dart';
import '../../../core/network/api_client.dart';
import '../../../core/services/transaction_signing_service.dart';
import '../models/savings_data_model.dart';

class SavingsRepository {
  SavingsRepository({
    required ApiClient apiClient,
    required TransactionSigningService signingService,
  })  : _apiClient = apiClient,
       _signingService = signingService;

  final ApiClient _apiClient;
  final TransactionSigningService _signingService;

  Future<String> requestDepositXdr(String amount, String accountId) async {
    final response = await _apiClient.postWithRetry(
      '/savings/deposit',
      <String, dynamic>{'amount': amount, 'accountId': accountId},
    );

    final unsignedXdr = response['unsignedXdr'];
    if (unsignedXdr is! String) {
      throw const ServerException(
        'Deposit response did not include an unsigned XDR.',
      );
    }

    return unsignedXdr;
  }

  Future<String> signDepositXdr(String unsignedXdr, String secretSeed) =>
      _signingService.signXdrLocally(unsignedXdr, secretSeed);

  Future<SavingsDataModel> fetchSavingsDashboardData(String accountId) async {
    // TODO: Call backend balance/apy endpoint
    return SavingsDataModel(balance: '0.0', apy: '0.0');
  }
}
