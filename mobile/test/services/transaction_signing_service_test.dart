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

class _CountingSecureStorage extends SecureStorageService {
  _CountingSecureStorage({required this.onRead});

  final void Function() onRead;

  @override
  Future<String?> getSecretSeed() async {
    onRead();
    return 'should-not-be-read';
  }
}

String _buildUnsignedPaymentXdr(KeyPair keyPair) {
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
  return unsigned.toEnvelopeXdrBase64();
}

void main() {
  test('signs unsigned XDR for TESTNET with seed from secure storage',
      () async {
    final keyPair = KeyPair.random();
    final unsignedXdr = _buildUnsignedPaymentXdr(keyPair);

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

  test('signs unsigned XDR for PUBLIC network', () async {
    final keyPair = KeyPair.random();
    final unsignedXdr = _buildUnsignedPaymentXdr(keyPair);

    final service = TransactionSigningService(
      secureStorage: _FakeSecureStorage(keyPair.secretSeed),
      network: Network.PUBLIC,
    );

    final signedXdr = await service.signXdrLocally(unsignedXdr);
    final parsed = AbstractTransaction.fromEnvelopeXdrString(signedXdr);
    expect(parsed.signatures, isNotEmpty);
  });

  test('TESTNET and PUBLIC signatures differ for the same XDR', () async {
    final keyPair = KeyPair.random();
    final unsignedXdr = _buildUnsignedPaymentXdr(keyPair);
    final storage = _FakeSecureStorage(keyPair.secretSeed);

    final testnetSigned = await TransactionSigningService(
      secureStorage: storage,
      network: Network.TESTNET,
    ).signXdrLocally(unsignedXdr);

    final publicSigned = await TransactionSigningService(
      secureStorage: storage,
      network: Network.PUBLIC,
    ).signXdrLocally(unsignedXdr);

    expect(testnetSigned, isNot(equals(publicSigned)));
  });

  test('throws when secret seed is missing', () async {
    final keyPair = KeyPair.random();
    final unsignedXdr = _buildUnsignedPaymentXdr(keyPair);
    final service = TransactionSigningService(
      secureStorage: _FakeSecureStorage(null),
      network: Network.TESTNET,
    );

    expect(
      () => service.signXdrLocally(unsignedXdr),
      throwsA(isA<StateError>()),
    );
  });

  test('does not read secret seed when XDR is malformed', () async {
    var seedReads = 0;
    final storage = _CountingSecureStorage(
      onRead: () => seedReads++,
    );
    final service = TransactionSigningService(
      secureStorage: storage,
      network: Network.TESTNET,
    );

    await expectLater(
      () => service.signXdrLocally('not-valid-xdr'),
      throwsA(isA<FormatException>()),
    );
    expect(seedReads, 0);
  });

  test('throws on malformed XDR', () async {
    final keyPair = KeyPair.random();
    final service = TransactionSigningService(
      secureStorage: _FakeSecureStorage(keyPair.secretSeed),
      network: Network.TESTNET,
    );

    expect(
      () => service.signXdrLocally('not-valid-xdr'),
      throwsA(isA<FormatException>()),
    );
  });
}
