import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/services/secure_storage_service.dart';
import 'package:mobile/core/services/transaction_signing_service.dart';
import 'package:stellar_flutter_sdk/stellar_flutter_sdk.dart';

class _FakeSecureStorage extends SecureStorageService {
  _FakeSecureStorage(this._seed);

  final String? _seed;

  @override
  Future<String?> getSecretSeed() async => _seed;
}

void main() {
  test('signs unsigned XDR with seed from secure storage', () async {
    final keyPair = KeyPair.random();
    final account = Account(keyPair.accountId, BigInt.one);

    final unsigned = TransactionBuilder(account)
        .addOperation(
          PaymentOperationBuilder(
            keyPair.accountId,
            Asset.NATIVE,
            '1',
          ).build(),
        )
        .build();

    final unsignedXdr = unsigned.toEnvelopeXdrBase64();

    final service = TransactionSigningService(
      secureStorage: _FakeSecureStorage(keyPair.secretSeed),
      network: Network.TESTNET,
    );

    final signedXdr = await service.signXdrLocally(unsignedXdr);

    expect(signedXdr, isNotEmpty);
    expect(signedXdr, isNot(equals(unsignedXdr)));

    final parsed = AbstractTransaction.fromEnvelopeXdrString(signedXdr);
    expect(parsed.signatures, isNotEmpty);
  });

  test('throws when secret seed is missing', () async {
    final service = TransactionSigningService(
      secureStorage: _FakeSecureStorage(null),
    );

    expect(
      () => service.signXdrLocally('AAAA...'),
      throwsA(isA<StateError>()),
    );
  });

  test('throws on malformed XDR', () async {
    final keyPair = KeyPair.random();
    final service = TransactionSigningService(
      secureStorage: _FakeSecureStorage(keyPair.secretSeed),
    );

    expect(
      () => service.signXdrLocally('not-valid-xdr'),
      throwsA(isA<FormatException>()),
    );
  });
}