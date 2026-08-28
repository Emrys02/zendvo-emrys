import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/errors/exceptions.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/features/savings/data/savings_repository.dart';

class _FakeApiClient extends ApiClient {
  _FakeApiClient({this.response, this.error});

  final Map<String, dynamic>? response;
  final Object? error;

  String? capturedPath;
  Map<String, dynamic>? capturedBody;

  @override
  Future<Map<String, dynamic>> postWithRetry(
    String path,
    Map<String, dynamic> body, {
    int maxAttempts = 3,
    Map<String, String>? headers,
  }) async {
    capturedPath = path;
    capturedBody = body;
    if (error != null) throw error!;
    return response!;
  }
}

void main() {
  group('SavingsRepository.requestDepositXdr', () {
    test('posts to the deposit endpoint and returns the unsigned XDR', () async {
      final api = _FakeApiClient(
        response: <String, dynamic>{'unsignedXdr': 'ENCODEDXDR'},
      );
      final repo = SavingsRepository(apiClient: api);

      final xdr = await repo.requestDepositXdr('10', 'GABC');

      expect(xdr, 'ENCODEDXDR');
      expect(api.capturedPath, '/savings/deposit');
      expect(
        api.capturedBody,
        <String, dynamic>{'amount': '10', 'accountId': 'GABC'},
      );
    });

    test('throws when the response has no unsignedXdr', () async {
      final api = _FakeApiClient(response: <String, dynamic>{'ok': true});
      final repo = SavingsRepository(apiClient: api);

      expect(
        () => repo.requestDepositXdr('10', 'GABC'),
        throwsA(isA<ServerException>()),
      );
    });

    test('propagates backend validation errors', () async {
      final api = _FakeApiClient(error: const InsufficientFundsException());
      final repo = SavingsRepository(apiClient: api);

      expect(
        () => repo.requestDepositXdr('10', 'GABC'),
        throwsA(isA<InsufficientFundsException>()),
      );
    });
  });
}
