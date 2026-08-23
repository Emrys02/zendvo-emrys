class SavingsException implements Exception {
  const SavingsException(this.message);

  final String message;

  @override
  String toString() => message;
}

class NetworkException extends SavingsException {
  const NetworkException([
    super.message = 'Network error while contacting the savings backend.',
  ]);
}

class AuthenticationException extends SavingsException {
  const AuthenticationException([
    super.message = 'Authentication token is required for deposit requests.',
  ]);
}

class ServerException extends SavingsException {
  const ServerException([
    super.message = 'The savings backend returned an unexpected error.',
  ]);
}

class ValidationException extends SavingsException {
  const ValidationException([
    super.message = 'The deposit request was rejected by the backend.',
  ]);
}

class InsufficientFundsException extends SavingsException {
  const InsufficientFundsException([
    super.message = 'Insufficient funds for the requested deposit.',
  ]);
}

class VaultPausedException extends SavingsException {
  const VaultPausedException([
    super.message = 'The yield vault is currently paused.',
  ]);
}

class RateLimitException extends SavingsException {
  const RateLimitException([
    super.message = 'Too many requests. Please retry later.',
  ]);
}
