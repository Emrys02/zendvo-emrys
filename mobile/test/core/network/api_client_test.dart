import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/network/api_exceptions.dart';

/// Starts a local HTTP server that responds according to [handler].
/// Returns the server and a URL pointing at it.
Future<(HttpServer, Uri)> startServer(Future<void> Function(HttpRequest) handler) async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  final uri = Uri.parse('http://127.0.0.1:${server.port}/submit');
  server.listen((request) async {
    try {
      await handler(request);
    } catch (e, st) {
      // Close any still-open response, then propagate the error so the
      // test fails immediately rather than hanging as a retry timeout.
      try {
        await request.response.close();
      } catch (_) {}
      Error.throwWithStackTrace(e, st);
    }
  });
  return (server, uri);
}

Future<void> jsonResponse(HttpRequest request, int statusCode, Map<String, dynamic> body) async {
  await request.drain<void>();
  request.response
    ..statusCode = statusCode
    ..headers.contentType = ContentType.json
    ..write(jsonEncode(body));
  await request.response.close();
}

void main() {
  group('ApiClient.postWithRetry', () {
    test('returns decoded JSON on a successful response', () async {
      final (server, uri) = await startServer((request) async {
        return jsonResponse(request, 200, {'hash': 'abc123'});
      });
      addTearDown(() => server.close(force: true));

      final client = ApiClient(baseDelay: const Duration(milliseconds: 1));
      final result = await client.postWithRetry(uri.toString(), {'xdr': 'signed'});

      expect(result, {'hash': 'abc123'});
      client.close();
    });

    test('retries transient 503 responses with backoff and succeeds', () async {
      var attempts = 0;
      final (server, uri) = await startServer((request) async {
        attempts++;
        if (attempts < 3) {
          return jsonResponse(request, 503, {'message': 'node overloaded'});
        }
        return jsonResponse(request, 200, {'hash': 'abc123'});
      });
      addTearDown(() => server.close(force: true));

      final client = ApiClient(baseDelay: const Duration(milliseconds: 2));
      final result = await client.postWithRetry(uri.toString(), {'xdr': 'signed'});

      expect(attempts, 3);
      expect(result, {'hash': 'abc123'});
      client.close();
    });

    test('throws NetworkCongestedException after retries are exhausted', () async {
      var attempts = 0;
      final (server, uri) = await startServer((request) async {
        attempts++;
        return jsonResponse(request, 503, {'message': 'node overloaded'});
      });
      addTearDown(() => server.close(force: true));

      final client = ApiClient(maxRetries: 3, baseDelay: const Duration(milliseconds: 1));

      await expectLater(
        client.postWithRetry(uri.toString(), {'xdr': 'signed'}),
        throwsA(isA<NetworkCongestedException>()),
      );
      expect(attempts, 3);
      client.close();
    });

    test('maps HTTP 400 to TransactionFailedException without retrying', () async {
      var attempts = 0;
      final (server, uri) = await startServer((request) async {
        attempts++;
        return jsonResponse(request, 400, {'message': 'bad signature'});
      });
      addTearDown(() => server.close(force: true));

      final client = ApiClient(maxRetries: 3, baseDelay: const Duration(milliseconds: 1));

      await expectLater(
        client.postWithRetry(uri.toString(), {'xdr': 'signed'}),
        throwsA(
          isA<TransactionFailedException>()
              .having((e) => e.statusCode, 'statusCode', 400)
              .having((e) => e.message, 'message', 'bad signature'),
        ),
      );
      // Permanent failures must not be retried.
      expect(attempts, 1);
      client.close();
    });

    test('adds a Bearer token from the auth provider', () async {
      final (server, uri) = await startServer((request) async {
        expect(request.headers.value(HttpHeaders.authorizationHeader), 'Bearer test-token');
        return jsonResponse(request, 200, {'ok': true});
      });
      addTearDown(() => server.close(force: true));

      final client = ApiClient(
        authTokenProvider: () async => 'test-token',
        baseDelay: const Duration(milliseconds: 1),
      );
      await client.postWithRetry(uri.toString(), const {});
      client.close();
    });

    test('maps HTTP 409 to ConflictException without retrying', () async {
      var attempts = 0;
      final (server, uri) = await startServer((request) async {
        attempts++;
        return jsonResponse(request, 409, {'message': 'address already registered'});
      });
      addTearDown(() => server.close(force: true));

      final client = ApiClient(maxRetries: 3, baseDelay: const Duration(milliseconds: 1));
      await expectLater(
        client.postWithRetry(uri.toString(), const {}),
        throwsA(isA<ConflictException>()
            .having((e) => e.statusCode, 'statusCode', 409)
            .having((e) => e.message, 'message', 'address already registered')),
      );
      expect(attempts, 1);
      client.close();
    });

    test('maps other 4xx codes to ApiRequestException without retrying', () async {
      var attempts = 0;
      final (server, uri) = await startServer((request) async {
        attempts++;
        return jsonResponse(request, 422, {'message': 'validation failed'});
      });
      addTearDown(() => server.close(force: true));

      final client = ApiClient(maxRetries: 3, baseDelay: const Duration(milliseconds: 1));

      await expectLater(
        client.postWithRetry(uri.toString(), {'xdr': 'signed'}),
        throwsA(isA<ApiRequestException>().having((e) => e.statusCode, 'statusCode', 422)),
      );
      expect(attempts, 1);
      client.close();
    });

    test('retries on connection failure and eventually throws NetworkCongestedException', () async {
      // Bind a server, note the port, then close it so connections are refused.
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final port = server.port;
      await server.close(force: true);

      final client = ApiClient(maxRetries: 3, baseDelay: const Duration(milliseconds: 1));

      await expectLater(
        client.postWithRetry('http://127.0.0.1:$port/submit', {'xdr': 'signed'}),
        throwsA(isA<NetworkCongestedException>()),
      );
      client.close();
    });
  });
}
