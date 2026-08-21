import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/services/secure_storage_service.dart';

class FakeFlutterSecureStorage extends FlutterSecureStorage {
  final Map<String, String> _storage = {};
  Exception? errorToThrow;

  @override
  Future<void> write({
    required String key,
    required String? value,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (errorToThrow != null) throw errorToThrow!;
    if (value != null) {
      _storage[key] = value;
    } else {
      _storage.remove(key);
    }
  }

  @override
  Future<String?> read({
    required String key,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (errorToThrow != null) throw errorToThrow!;
    return _storage[key];
  }

  @override
  Future<void> delete({
    required String key,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (errorToThrow != null) throw errorToThrow!;
    _storage.remove(key);
  }

  @override
  Future<bool> containsKey({
    required String key,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (errorToThrow != null) throw errorToThrow!;
    return _storage.containsKey(key);
  }
}

void main() {
  group('SecureStorageService', () {
    late FakeFlutterSecureStorage fakeStorage;
    late SecureStorageService service;

    setUp(() {
      fakeStorage = FakeFlutterSecureStorage();
      service = SecureStorageService(storage: fakeStorage);
    });

    test('saveSecretSeed stores seed using namespaced key', () async {
      const testSeed = 'SABCD123456789XYZSECRETSEED';
      await service.saveSecretSeed(testSeed);

      final stored = await fakeStorage.read(
        key: SecureStorageService.defaultSeedKey,
      );
      expect(stored, equals(testSeed));
    });

    test('getSecretSeed retrieves stored seed', () async {
      const testSeed = 'SABCD123456789XYZSECRETSEED';
      await service.saveSecretSeed(testSeed);

      final result = await service.getSecretSeed();
      expect(result, equals(testSeed));
    });

    test('getSecretSeed returns null when no seed is stored', () async {
      final result = await service.getSecretSeed();
      expect(result, isNull);
    });

    test('saveSecretSeed throws ArgumentError when seed is empty', () async {
      expect(
        () => service.saveSecretSeed('   '),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('deleteSecretSeed removes stored seed', () async {
      const testSeed = 'SABCD123456789XYZSECRETSEED';
      await service.saveSecretSeed(testSeed);
      expect(await service.hasSecretSeed(), isTrue);

      await service.deleteSecretSeed();
      expect(await service.hasSecretSeed(), isFalse);
      expect(await service.getSecretSeed(), isNull);
    });

    test('hasSecretSeed correctly checks storage', () async {
      expect(await service.hasSecretSeed(), isFalse);
      await service.saveSecretSeed('SABCD123456789XYZSECRETSEED');
      expect(await service.hasSecretSeed(), isTrue);
    });

    test('throws SecureStorageCorruptedException when retrieved seed is empty',
        () async {
      await fakeStorage.write(
        key: SecureStorageService.defaultSeedKey,
        value: '   ',
      );

      expect(
        () => service.getSecretSeed(),
        throwsA(isA<SecureStorageCorruptedException>()),
      );
    });

    test('maps locked error to SecureStorageLockedException', () async {
      fakeStorage.errorToThrow = PlatformException(
        code: 'Locked',
        message: 'Device keychain is locked',
      );

      expect(
        () => service.getSecretSeed(),
        throwsA(isA<SecureStorageLockedException>()),
      );
    });

    test('maps corrupted data error to SecureStorageCorruptedException',
        () async {
      fakeStorage.errorToThrow = PlatformException(
        code: 'DecryptionError',
        message: 'BadPaddingException cipher failed to decode',
      );

      expect(
        () => service.getSecretSeed(),
        throwsA(isA<SecureStorageCorruptedException>()),
      );
    });

    test('maps hardware unavailable error to SecureStorageUnavailableException',
        () async {
      fakeStorage.errorToThrow = PlatformException(
        code: 'KeystoreError',
        message: 'Hardware keystore unavailable',
      );

      expect(
        () => service.saveSecretSeed('SEED123'),
        throwsA(isA<SecureStorageUnavailableException>()),
      );
    });

    test('maps unrecognized errors to GenericSecureStorageException', () async {
      fakeStorage.errorToThrow = Exception('Unknown hardware fault');

      expect(
        () => service.getSecretSeed(),
        throwsA(isA<GenericSecureStorageException>()),
      );
    });
  });
}
