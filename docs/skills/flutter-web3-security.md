# Flutter Web3 Security — Best Practices for Mobile Wallet & DApp Security

> Security patterns for Flutter apps that handle private keys, seed phrases,
> encrypted storage, biometric gates, environment secrets, and Solana
> transactions. Based on real production code from espresso-cash and sol_new.

| Package | Purpose | Pub |
|---------|---------|-----|
| `flutter_secure_storage` | Keychain / EncryptedSharedPreferences | [pub.dev](https://pub.dev/packages/flutter_secure_storage) |
| `encrypt` | AES-256-CBC encryption | [pub.dev](https://pub.dev/packages/encrypt) |
| `crypto` | SHA-256 key derivation | [pub.dev](https://pub.dev/packages/crypto) |
| `local_auth` | Biometric auth (Face ID / fingerprint) | [pub.dev](https://pub.dev/packages/local_auth) |
| `flutter_dotenv` | Environment variable loading | [pub.dev](https://pub.dev/packages/flutter_dotenv) |
| `bip39` | Mnemonic generation & validation | [pub.dev](https://pub.dev/packages/bip39) |

---

## Overview

Web3 mobile apps handle assets with real monetary value. A single plaintext
private key leak means total, irreversible loss of funds. Every layer —
storage, encryption, environment config, biometric gating, network
transport, and transaction signing — must be hardened.

---

## Quick Start — Secure Storage Service

```dart
import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:crypto/crypto.dart';
import 'package:encrypt/encrypt.dart' as encrypt;

class SecureStorageService {
  final FlutterSecureStorage _storage;
  final String namespace;

  SecureStorageService({required this.namespace})
      : _storage = const FlutterSecureStorage(
          aOptions: AndroidOptions(encryptedSharedPreferences: true),
          iOptions: IOSOptions(
            accessibility: KeychainAccessibility.first_unlock,
          ),
        );

  Future<void> saveValue(String key, String value) async {
    await _storage.write(key: '${namespace}_$key', value: value);
  }

  Future<String?> getValue(String key) async {
    return await _storage.read(key: '${namespace}_$key');
  }

  /// Encrypt-then-store using AES-256-CBC with a device-derived key.
  Future<void> saveEncrypted(String key, String value) async {
    final derivedKey = await _getDeviceSpecificKey();
    final encrypted = _encryptAES(value, derivedKey);
    await saveValue(key, encrypted);
  }

  Future<String?> getEncrypted(String key) async {
    final encrypted = await getValue(key);
    if (encrypted == null) return null;
    final derivedKey = await _getDeviceSpecificKey();
    try {
      return _decryptAES(encrypted, derivedKey);
    } catch (_) {
      return null; // Tampered or wrong key
    }
  }

  Future<String> _getDeviceSpecificKey() async {
    var deviceId = await getValue('device_id');
    if (deviceId == null) {
      // Generate once, persist for this namespace
      final random = List<int>.generate(32, (_) => DateTime.now().microsecond);
      deviceId = random.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
      await saveValue('device_id', deviceId);
    }
    final hash = sha256.convert(utf8.encode(deviceId + namespace));
    return hash.toString();
  }

  static String _encryptAES(String plainText, String key) {
    final keyBytes = sha256.convert(utf8.encode(key)).bytes;
    final iv = encrypt.IV.fromLength(16);
    final encrypter = encrypt.Encrypter(
      encrypt.AES(
        encrypt.Key.fromBase64(base64Encode(keyBytes)),
        mode: encrypt.AESMode.cbc,
      ),
    );
    return encrypter.encrypt(plainText, iv: iv).base64;
  }

  static String _decryptAES(String cipherText, String key) {
    final keyBytes = sha256.convert(utf8.encode(key)).bytes;
    final iv = encrypt.IV.fromLength(16);
    final encrypter = encrypt.Encrypter(
      encrypt.AES(
        encrypt.Key.fromBase64(base64Encode(keyBytes)),
        mode: encrypt.AESMode.cbc,
      ),
    );
    return encrypter.decrypt64(cipherText, iv: iv);
  }
}
```

---

## Core Concepts

### 1. Private Key & Seed Phrase Handling

**Rule: Never store plaintext private keys or mnemonics.**

```dart
import 'package:bip39/bip39.dart' as bip39;
import 'package:ed25519_hd_key/ed25519_hd_key.dart';

// Generate mnemonic
final mnemonic = bip39.generateMnemonic(); // 12-word BIP-39
final words = mnemonic.split(' ');

// Derive Solana keypair (BIP-44 path m/44'/501'/0'/0')
final seed = bip39.mnemonicToSeed(mnemonic);
final derived = await ED25519_HD_KEY.derivePath("m/44'/501'/0'/0'", seed);

// ✅ Encrypt before persisting
final storage = SecureStorageService(namespace: 'wallet');
await storage.saveEncrypted('seed_phrase', mnemonic);
await storage.saveEncrypted('private_key', base64Encode(derived.key));

// ✅ Exclude private key from JSON serialisation
Map<String, dynamic> toJson() => {
  'publicKey': publicKey,
  'walletId': walletId,
  // privateKey intentionally omitted
};
```

### 2. Environment Variables — Never Hardcode Secrets

Use `flutter_dotenv` and **never check `.env` files into version control**.

```yaml
# pubspec.yaml
dependencies:
  flutter_dotenv: ^6.0.0

flutter:
  assets:
    - .env
```

```bash
# .env  (add to .gitignore!)
SOLANA_RPC_URL=https://your-project.helius-rpc.com/?api-key=SECRET
SOLANA_WS_URL=wss://your-project.helius-rpc.com/?api-key=SECRET
PLATFORM_FEE_WALLET=YourFeeWallet...
```

```dart
import 'package:flutter_dotenv/flutter_dotenv.dart';

class AppConfig {
  static String get solanaRpcUrl =>
      dotenv.env['SOLANA_RPC_URL'] ?? 'https://api.devnet.solana.com';

  static String get solanaWsUrl =>
      dotenv.env['SOLANA_WS_URL'] ?? 'wss://api.devnet.solana.com';

  static String get platformFeeWallet =>
      dotenv.env['PLATFORM_FEE_WALLET'] ?? '';
}
```

For CI/CD or extra hardening, use `--dart-define`:

```bash
flutter run --dart-define=SOLANA_RPC_URL=https://my-rpc.example.com
```

```dart
// Access compile-time defines (cannot be reverse-engineered from APK assets)
const rpcUrl = String.fromEnvironment('SOLANA_RPC_URL');
```

### 3. Biometric Authentication

Gate sensitive operations (export mnemonic, sign high-value tx) behind
biometrics using the `local_auth` package.

```dart
import 'package:local_auth/local_auth.dart';
import 'package:local_auth/error_codes.dart' as auth_error;

class BiometricAuthService {
  final LocalAuthentication _localAuth;

  BiometricAuthService() : _localAuth = LocalAuthentication();

  Future<bool> authenticate({
    String reason = 'Authenticate to continue',
    bool biometricOnly = false,
  }) async {
    try {
      if (!await _localAuth.isDeviceSupported()) return false;
      if (!await _localAuth.canCheckBiometrics) return false;

      return await _localAuth.authenticate(
        localizedReason: reason,
        options: AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: biometricOnly,
        ),
      );
    } on PlatformException catch (e) {
      if (e.code == auth_error.notAvailable ||
          e.code == auth_error.notEnrolled) {
        return false;
      }
      rethrow;
    }
  }
}
```

**Usage pattern** — protect seed phrase export:

```dart
Future<List<String>?> exportSeedPhrase(String walletId) async {
  // ✅ Biometric gate BEFORE decryption
  final authenticated = await biometricService.authenticate(
    reason: 'Authenticate to view recovery phrase',
    biometricOnly: true,
  );
  if (!authenticated) return null;

  final encrypted = await storage.getEncrypted('seed_$walletId');
  return encrypted?.split(' ');
}
```

### 4. Network Security

Always validate RPC endpoints and enforce HTTPS.

```dart
Future<bool> validateEndpoint(String endpoint) async {
  final uri = Uri.parse(endpoint);

  // ✅ Reject non-HTTPS
  if (uri.scheme != 'https') return false;

  // ✅ Check against trusted list
  const trusted = [
    'api.mainnet-beta.solana.com',
    'api.devnet.solana.com',
    'solana-mainnet.g.alchemy.com',
  ];

  if (!trusted.contains(uri.host)) {
    // Allow custom endpoints only if user explicitly added them
    return await _isUserTrustedEndpoint(uri.host);
  }

  // ✅ Verify connectivity + SSL
  try {
    final response = await httpClient.get(
      Uri.parse('$endpoint/health'),
    ).timeout(const Duration(seconds: 10));
    return response.statusCode == 200;
  } on HandshakeException {
    return false; // SSL cert invalid
  }
}
```

### 5. Secure Transaction Flow

```dart
Future<TransactionResult> signAndSend({
  required String walletId,
  required List<Instruction> instructions,
}) async {
  // 1. Verify wallet exists
  final wallet = await walletService.getWalletById(walletId);
  if (wallet == null) {
    return TransactionResult.failure(error: 'Wallet not found');
  }

  // 2. Build + simulate BEFORE signing
  final message = Message(instructions: instructions);
  final compiled = message.compile(
    recentBlockhash: await client.rpcClient.getLatestBlockhash(),
    feePayer: Ed25519HDPublicKey.fromBase58(wallet.publicKey),
  );

  // 3. Simulate first
  final sim = await client.rpcClient.simulateTransaction(
    compiled.encode(),
    commitment: Commitment.confirmed,
  );
  if (sim.err != null) {
    return TransactionResult.failure(
      error: 'Simulation failed: ${sim.err}',
    );
  }

  // 4. Sign only after successful simulation
  final signature = await client.rpcClient.sendTransaction(
    compiled.encode(),
    preflightCommitment: Commitment.confirmed,
  );

  // 5. Store tx metadata encrypted (audit trail)
  await secureStorage.saveEncrypted('tx_$signature', jsonEncode({
    'walletId': walletId,
    'timestamp': DateTime.now().toIso8601String(),
    'instructionCount': instructions.length,
  }));

  return TransactionResult.success(signature: signature);
}
```

---

## Patterns & Recipes

### PIN Hashing — Never Store PINs in Plaintext

```dart
import 'package:crypto/crypto.dart';

Future<String> hashPin(String pin) async {
  // Use SHA-256 — or better, bcrypt/argon2 for brute-force resistance
  final bytes = utf8.encode(pin);
  return sha256.convert(bytes).toString();
}

// Store
await secureStorage.write(key: 'wallet_pin', value: await hashPin(pin));

// Validate
final stored = await secureStorage.read(key: 'wallet_pin');
final matches = stored == await hashPin(inputPin);
```

### App Lock with BLoC (espresso-cash pattern)

```dart
@injectable
class AppLockBloc extends Bloc<AppLockEvent, AppLockState> {
  AppLockBloc({required FlutterSecureStorage secureStorage})
      : _secureStorage = secureStorage,
        super(const AppLockState.none()) {
    on<AppLockEvent>(_eventHandler, transformer: sequential());
  }

  final FlutterSecureStorage _secureStorage;
  static const _key = 'app_lock_pin';

  Future<void> _onUnlock(AppLockEventUnlock event, Emitter emit) async {
    final pin = await _secureStorage.read(key: _key);
    if (pin == event.pin) {
      emit(const AppLockState.enabled(disableFailed: false));
    } else {
      emit(const AppLockState.locked(isRetrying: true));
    }
  }
}
```

### Logout — Wipe All Sensitive Data

```dart
Future<void> logout() async {
  // ✅ Delete everything in one call
  await const FlutterSecureStorage().deleteAll();

  // ✅ Drop scoped DI registrations
  await sl.dropScope(authScope);
}
```

### Namespace Isolation for Multi-Wallet

```dart
// Each wallet gets its own SecureStorageService namespace
final walletAStorage = SecureStorageService(namespace: 'wallet_a');
final walletBStorage = SecureStorageService(namespace: 'wallet_b');

// Clear one wallet without affecting others
await walletAStorage.clearNamespace();
```

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Storing private key in `SharedPreferences` | Use `FlutterSecureStorage` with `encryptedSharedPreferences: true` |
| Hardcoding RPC URL with API key in source | Use `.env` + `flutter_dotenv` or `--dart-define`, add `.env` to `.gitignore` |
| Including `privateKey` in `toJson()` | Exclude from serialisation; decrypt only when signing |
| Not encrypting values inside secure storage | Use AES-256-CBC `saveEncrypted` on top of keychain storage — double layer |
| Skipping simulation before send | Always `simulateTransaction` first to catch errors without spending SOL |
| Allowing HTTP (non-TLS) RPC endpoints | Reject `uri.scheme != 'https'` before connecting |
| Storing PIN as plaintext | Hash with SHA-256 (minimum); prefer Argon2 for brute-force resistance |
| No biometric gate on seed phrase export | Require `LocalAuthentication.authenticate()` before decrypting mnemonic |
| Logging private keys or mnemonics | Never pass sensitive data to `print()`, `debugPrint()`, or crash reporters |
| Using same encryption key across namespaces | Derive key from `sha256(deviceId + namespace)` for per-wallet isolation |

---

## Security Checklist

Before shipping a web3 Flutter app:

- [ ] Private keys and seed phrases encrypted at rest (AES + keychain)
- [ ] `.env` in `.gitignore`; no secrets in version control
- [ ] Biometric or PIN gate on all sensitive operations
- [ ] HTTPS enforced for all RPC/API connections
- [ ] Transaction simulation before every send
- [ ] `privateKey` excluded from all JSON/logging output
- [ ] Logout wipes `FlutterSecureStorage` completely
- [ ] Android: `encryptedSharedPreferences: true` set
- [ ] iOS: `KeychainAccessibility.first_unlock` or stricter
- [ ] Environment-specific RPC URLs (no mainnet keys in debug builds)

---

## Related

- [transaction-building](transaction-building) — simulation & error diagnosis
- [solana-core](solana-core) — RPC client, keypairs, PDAs
- [solana-mobile-client](solana-mobile-client) — MWA session security
- [solana-seed-vault](solana-seed-vault) — hardware-backed key storage
- [flutter_secure_storage docs](https://pub.dev/packages/flutter_secure_storage)
- [local_auth docs](https://pub.dev/packages/local_auth)
- [encrypt package](https://pub.dev/packages/encrypt)
- [OWASP Mobile Top 10](https://owasp.org/www-project-mobile-top-10/)
