import 'package:stellar_flutter_sdk/stellar_flutter_sdk.dart';

import 'secure_storage_service.dart';

/// Locally signs an unsigned Stellar transaction XDR using the user's
/// secret seed from secure storage. Keeps the architecture non-custodial:
/// the private key never leaves the device.
class TransactionSigningService {
  TransactionSigningService({
    SecureStorageService? secureStorage,
    Network? network,
  })  : _secureStorage = secureStorage ?? SecureStorageService(),
        _network = network ?? Network.TESTNET;

  final SecureStorageService _secureStorage;
  final Network _network;

  /// Decodes [unsignedXdr], signs with the stored secret seed, and returns
  /// a signed Base64 XDR envelope ready for network submission.
  Future<String> signXdrLocally(String unsignedXdr) async {
    if (unsignedXdr.trim().isEmpty) {
      throw ArgumentError('unsignedXdr must not be empty');
    }

    String? secretSeed;
    try {
      secretSeed = await _secureStorage.getSecretSeed();
      if (secretSeed == null || secretSeed.isEmpty) {
        throw StateError(
          'No secret seed found in secure storage. '
          'Generate or restore a wallet before signing.',
        );
      }

      final AbstractTransaction transaction;
      try {
        transaction =
            AbstractTransaction.fromEnvelopeXdrString(unsignedXdr);
      } catch (e) {
        throw FormatException(
          'Malformed or invalid Base64 XDR transaction envelope: $e',
        );
      }

      final keyPair = KeyPair.fromSecretSeed(secretSeed);
      transaction.sign(keyPair, _network);

      return transaction.toEnvelopeXdrBase64();
    } finally {
      // Drop local reference ASAP; do not log or return the seed.
      secretSeed = null;
    }
  }
}
