import '../models/savings_data_model.dart';

// Placeholder: Savings Repository
// Handles API interactions for deposits, withdrawals, and polling balance.
class SavingsRepository {
  Future<String> requestDepositXdr(String amount, String accountId) async {
    // TODO: Call backend deposit endpoint
    return 'unsigned_deposit_xdr_placeholder';
  }

  Future<SavingsDataModel> fetchSavingsDashboardData(String accountId) async {
    // TODO: Call backend balance/apy endpoint
    return SavingsDataModel(balance: '0.0', apy: '0.0');
  }
}
