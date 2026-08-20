// Placeholder: Savings Data Model
// Strongly typed model for the savings dashboard data.
class SavingsDataModel {
  final String balance;
  final String apy;

  SavingsDataModel({required this.balance, required this.apy});

  factory SavingsDataModel.fromJson(Map<String, dynamic> json) {
    return SavingsDataModel(
      balance: json['balance'] ?? '0.0',
      apy: json['apy'] ?? '0.0',
    );
  }
}
