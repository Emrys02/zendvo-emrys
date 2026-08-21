import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/errors/exceptions.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/services/transaction_signing_service.dart';
import 'package:mobile/features/savings/data/savings_repository.dart';

class _FakeApiClient extends ApiClient {
  _FakeApiClient({this.response, this.error})
      : super(baseUrl: 'https://example.test');

  final Map<String, dynamic>? response;
  final Object? error;

  @override
  Future<Map<String, dynamic>> postWithRetry(
    String path,
    Map<String, dynamic> body, {
    int maxAttempts = 3,
  }) async {
    if (error != null) throw error!;
    return response!;
  }
}

class _FakeSigningService extends TransactionSigningService {
  @override
  Future<String> signXdrLocally(String unsignedXdr, String secretSeed) async =>
      'signed:$unsignedXdr';
}

void main() {
  group('SavingsRepository.requestDepositXdr', () {
    test('returns the unsigned XDR from the backend response', () async {
      final api = _FakeApiClient(<String, dynamic>{'unsignedXdr': 'ENCODEDXDR'});
      final repo = SavingsRepository(
        apiClient: api,
        signingService: _FakeSigningService(),
      );

      final xdr = await repo.requestDepositXdr('10', 'GABC');

      expect(xdr, 'ENCODEDXDR');
    });

    test('throws when the response has no unsignedXdr', () async {
      final api = _FakeApiClient(<String, dynamic>{'ok': true});
      final repo = SavingsRepository(
        apiClient: api,
        signingService: _FakeSigningService(),
      );

      expect(
        () => repo.requestDepositXdr('10', 'GABC'),
        throwsA(isA<ServerException>()),
      );
    });

    test('propagates backend validation errors', () async {
      final api = _FakeApiClient(null, error: const InsufficientFundsException());
      final repo = SavingsRepository(
        apiClient: api,
        signingService: _FakeSigningService(),
      );

      expect(
        () => repo.requestDepositXdr('10', 'GABC'),
        throwsA(isA<InsufficientFundsException>()),
      );
    });

    test('signDepositXdr delegates to the signing service', () async {
      final repo = SavingsRepository(
        apiClient: _FakeApiClient(<String, dynamic>{'unsignedXdr': 'X'}),
        signingService: _FakeSigningService(),
      );

      final signed = await repo.signDepositXdr('X', 'S');

      expect(signed, 'signed:X');
    });
  });
}
