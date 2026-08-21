import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../errors/exceptions.dart';

typedef TokenProvider = Future<String?> Function();

class ApiClient {
  ApiClient({required this.baseUrl, this.tokenProvider});

  final String baseUrl;
  final TokenProvider? tokenProvider;

  Future<Map<String, dynamic>> postWithRetry(
    String path,
    Map<String, dynamic> body, {
    int maxAttempts = 3,
  }) async {
    var attempt = 0;
    while (true) {
      attempt++;
      try {
        return await _post(path, body);
      } on NetworkException {
        if (attempt >= maxAttempts) rethrow;
        await _backoff(attempt);
      } on ServerException {
        if (attempt >= maxAttempts) rethrow;
        await _backoff(attempt);
      }
    }
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    final token = await tokenProvider?.call();
    final uri = Uri.parse(baseUrl + path);
    final client = HttpClient();
    client.connectionTimeout = const Duration(seconds: 15);

    HttpClientRequest? request;
    try {
      request = await client.postUrl(uri);
      request.headers.set(HttpHeaders.contentTypeHeader, 'application/json');
      if (token != null && token.isNotEmpty) {
        request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      }
      request.write(jsonEncode(body));

      final response = await request.close();
      final payload = await response.transform(utf8.decoder).join();
      final status = response.statusCode;

      if (status >= 200 && status < 300) {
        if (payload.isEmpty) return <String, dynamic>{};
        final decoded = jsonDecode(payload);
        if (decoded is Map<String, dynamic>) return decoded;
        throw const ServerException('Unexpected deposit response format.');
      }

      _mapError(status, payload);
    } on SocketException {
      throw const NetworkException();
    } on TimeoutException {
      throw const NetworkException();
    } on IOException {
      throw const NetworkException();
    } finally {
      client.close(force: true);
    }
  }

  Never _mapError(int status, String payload) {
    String? code;
    try {
      final data = jsonDecode(payload);
      if (data is Map<String, dynamic>) code = data['code'] as String?;
    } on FormatException {
      code = null;
    }

    if (status == 429) throw const RateLimitException();
    if ((status == 423 || status == 403) && code == 'vault_paused') {
      throw const VaultPausedException();
    }
    if ((status == 400 || status == 402) && code == 'insufficient_funds') {
      throw const InsufficientFundsException();
    }
    if (status >= 500) throw const ServerException();
    if (status >= 400) throw const ValidationException();

    throw const ServerException();
  }

  Future<void> _backoff(int attempt) =>
      Future.delayed(Duration(milliseconds: 300 * attempt * attempt));
}
