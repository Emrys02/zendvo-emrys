import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Base exception class for all secure storage failures.
abstract class SecureStorageException implements Exception {
  final String message;
  final dynamic cause;

  const SecureStorageException(this.message, [this.cause]);

  @override
  String toString() =>
      '$runtimeType: $message${cause != null ? ' (Cause: $cause)' : ''}';
}

/// Exception thrown when the hardware keystore or keychain is unavailable.
class SecureStorageUnavailableException extends SecureStorageException {
  const SecureStorageUnavailableException(super.message, [super.cause]);
}

/// Exception thrown when secure storage is locked or authentication failed.
class SecureStorageLockedException extends SecureStorageException {
  const SecureStorageLockedException(super.message, [super.cause]);
}

/// Exception thrown when stored seed data is corrupted or unreadable.
class SecureStorageCorruptedException extends SecureStorageException {
  const SecureStorageCorruptedException(super.message, [super.cause]);
}

/// Exception thrown for generic secure storage failures.
class GenericSecureStorageException extends SecureStorageException {
  const GenericSecureStorageException(super.message, [super.cause]);
}

/// Dedicated service for writing and reading the master secret seed
/// using hardware-backed keystore/keychain storage.
class SecureStorageService {
  /// Default namespaced key for the secret seed to prevent collision with other app data.
  static const String defaultSeedKey = 'savings_wallet_seed_v1';

  final FlutterSecureStorage _storage;
  final String _seedKey;

  static const AndroidOptions _defaultAndroidOptions = AndroidOptions(
    encryptedSharedPreferences: true,
  );

  static const IOSOptions _defaultIOSOptions = IOSOptions(
    accessibility: KeychainAccessibility.first_unlock,
  );

  /// Constructs a [SecureStorageService].
  ///
  /// Optionally injects a custom [FlutterSecureStorage] instance for testing.
  SecureStorageService({
    FlutterSecureStorage? storage,
    String seedKey = defaultSeedKey,
  })  : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: _defaultAndroidOptions,
              iOptions: _defaultIOSOptions,
            ),
        _seedKey = seedKey;

  /// Securely encrypts and persists the [seed] in hardware-backed storage.
  ///
  /// Throws [ArgumentError] if [seed] is empty.
  /// Throws [SecureStorageException] or one of its subclasses on storage failures.
  Future<void> saveSecretSeed(String seed) async {
    if (seed.trim().isEmpty) {
      throw ArgumentError('Secret seed cannot be empty.');
    }

    try {
      await _storage.write(key: _seedKey, value: seed);
    } catch (e) {
      throw _mapException(e, 'writing secret seed');
    }
  }

  /// Retrieves the secret seed into memory from hardware-backed storage.
  ///
  /// Returns `null` if no seed has been saved yet.
  /// Throws [SecureStorageCorruptedException] if the retrieved seed is empty or invalid.
  /// Throws [SecureStorageException] or one of its subclasses on storage failures.
  Future<String?> getSecretSeed() async {
    try {
      final seed = await _storage.read(key: _seedKey);
      if (seed == null) {
        return null;
      }
      if (seed.trim().isEmpty) {
        throw const SecureStorageCorruptedException(
          'Retrieved secret seed is empty or corrupted.',
        );
      }
      return seed;
    } catch (e) {
      throw _mapException(e, 'reading secret seed');
    }
  }

  /// Deletes the secret seed from secure storage.
  ///
  /// Throws [SecureStorageException] or one of its subclasses on storage failures.
  Future<void> deleteSecretSeed() async {
    try {
      await _storage.delete(key: _seedKey);
    } catch (e) {
      throw _mapException(e, 'deleting secret seed');
    }
  }

  /// Checks whether a secret seed is currently stored.
  ///
  /// Returns `true` if stored, `false` otherwise.
  /// Throws [SecureStorageException] or one of its subclasses on storage failures.
  Future<bool> hasSecretSeed() async {
    try {
      return await _storage.containsKey(key: _seedKey);
    } catch (e) {
      throw _mapException(e, 'checking secret seed existence');
    }
  }

  /// Maps unknown/platform exceptions to specific [SecureStorageException] types.
  SecureStorageException _mapException(dynamic error, String operation) {
    if (error is SecureStorageException) {
      return error;
    }

    final errorString = error.toString().toLowerCase();

    if (errorString.contains('locked') ||
        errorString.contains('user not authenticated') ||
        errorString.contains('errsecinteractionnotallowed') ||
        errorString.contains('authfailed') ||
        errorString.contains('passcode')) {
      return SecureStorageLockedException(
        'Secure storage is locked or authentication failed while $operation.',
        error,
      );
    }

    if (errorString.contains('corrupt') ||
        errorString.contains('badpadding') ||
        errorString.contains('format') ||
        errorString.contains('decode') ||
        errorString.contains('cipher') ||
        errorString.contains('invalid key')) {
      return SecureStorageCorruptedException(
        'Secure storage data is corrupted or failed to decrypt while $operation.',
        error,
      );
    }

    if (errorString.contains('unavailable') ||
        errorString.contains('not supported') ||
        errorString.contains('keystore failed') ||
        errorString.contains('disabled')) {
      return SecureStorageUnavailableException(
        'Secure storage is unavailable on this device while $operation.',
        error,
      );
    }

    return GenericSecureStorageException(
      'Failed to perform secure storage action while $operation.',
      error,
    );
  }
}
