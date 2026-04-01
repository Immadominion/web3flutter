# Solana Seed Vault — Hardware Key Management for Saga/Seeker Devices

> Flutter plugin wrapping the Solana Mobile Seed Vault specification. Provides
> secure key storage and signing via the Android content-provider API on
> Saga and Seeker hardware. Android-only.

| Package | Version | Pub |
|---------|---------|-----|
| `solana_seed_vault` | 0.2.0+1 | [pub.dev](https://pub.dev/packages/solana_seed_vault) |

**Depends on:** `solana` (core types), `freezed_annotation`, `plugin_platform_interface`

---

## Overview

`solana_seed_vault` exposes the Solana Mobile Seed Vault content-provider API
to Flutter. It communicates over Pigeon-generated platform channels to the
on-device secure element. The API is **authorization-gated**: you must obtain an
`AuthToken` (an `int`) before any account, signing, or public-key operation.

The package is Android-only. Guard every call with an availability check and
handle the case where Seed Vault hardware is absent.

---

## Quick Start

```dart
import 'package:solana_seed_vault/solana_seed_vault.dart';

Future<void> seedVaultDemo() async {
  final sv = SeedVault.instance;

  // 1. Check hardware availability
  if (!await sv.isAvailable()) return;
  if (!await sv.checkPermission()) return;

  // 2. Authorize existing seed (user picks in system UI)
  final authToken = await sv.authorizeSeed(Purpose.signSolanaTransaction);

  // 3. Fetch parsed accounts
  final seed = await sv.getParsedAuthorizedSeed(authToken);
  final accounts = seed.accounts;

  // 4. Sign a transaction
  final request = SigningRequest(
    payload: compiledTxBytes,
    requestedSignatures: [accounts.first.derivationPath],
  );
  final responses = await sv.signTransactions(
    authToken: authToken,
    signingRequests: [request],
  );
  final signature = responses.first.signatures.first;
}
```

---

## Core Concepts

### SeedVault Singleton

All operations go through `SeedVault.instance`. It implements
`SeedVaultFlutterApi` to receive change notifications from the OS.

```dart
final sv = SeedVault.instance;

// Availability — always check before any operation
final available = await sv.isAvailable(allowSimulated: false);
final permitted = await sv.checkPermission();
```

### Authorization Lifecycle

Seeds must be **authorized** before use. The OS presents a system UI.

| Method | When to use |
|--------|-------------|
| `authorizeSeed(purpose)` | User picks an existing seed to authorize |
| `createSeed(purpose)` | Create a brand-new seed on device |
| `importSeed(purpose)` | Import a seed from mnemonic |
| `deauthorizeSeed(authToken)` | Revoke app access to a seed |

All three creation methods return an `AuthToken` (`int`). Store it — you
need it for every subsequent call.

```dart
final token = await sv.authorizeSeed(Purpose.signSolanaTransaction);
// token is a plain int — persist in app state
```

**Purpose enum** — currently only one variant:

```dart
enum Purpose { signSolanaTransaction }
```

### Querying Seeds and Accounts

Raw cursor methods return `CursorData` (`Map<Object?, Object?>`). Prefer the
typed extension helpers from `SeedVaultHelperExt`:

```dart
// Typed — recommended
final seeds = await sv.getParsedAuthorizedSeeds();
final seed = await sv.getParsedAuthorizedSeed(authToken);
final accounts = await sv.getParsedAccounts(authToken);
final account = await sv.getParsedAccount(
  authToken: authToken,
  accountId: id,
);

// Raw cursor — only if you need custom projections
final raw = await sv.getAuthorizedSeeds();
```

**Filtering accounts:**

```dart
final wallets = await sv.getParsedAccounts(
  authToken,
  filter: const AccountFilter.byIsUserWallet(true),
);

// Other filters:
// AccountFilter()                                — no filter
// AccountFilter.byId(42)                         — by ID
// AccountFilter.byName('Main')                   — by name
// AccountFilter.byDerivationPath(uri)            — by BIP path
// AccountFilter.byPublicKeyEncoded(base58)       — by public key
// AccountFilter.byIsValid(true)                  — by validity
```

### Account Management

```dart
// Rename an account
await sv.updateAccountName(
  authToken: authToken,
  accountId: account.id,
  name: 'Trading Wallet',
);

// Mark as user-facing wallet
await sv.updateAccountIsUserWallet(
  authToken: authToken,
  accountId: account.id,
  isUserWallet: true,
);

// Mark validity
await sv.updateAccountIsValid(
  authToken: authToken,
  accountId: account.id,
  isValid: true,
);
```

---

## BIP Derivation Paths

Seed Vault uses URI-formatted BIP paths. Two helper classes convert between
`Uri` and typed `BipLevel` lists.

### BIP-44 (Standard Solana)

```dart
// Build a BIP-44 derivation path URI
final uri = Bip44DerivationPath.toUri([
  BipLevel(index: 0, hardened: true),  // account
]);
// → bip44:///0'

// Parse back
final data = Bip44DerivationPath.fromUri(uri);
// data.account, data.change, data.addressIndex
```

### BIP-32 (Full Path)

```dart
final uri = Bip32DerivationPath.toUri([
  BipLevel(index: 44, hardened: true),
  BipLevel(index: 501, hardened: true),
  BipLevel(index: 0, hardened: true),
]);
// → bip32:///m/44'/501'/0'

final levels = Bip32DerivationPath.fromUri(uri);
```

### Resolving Paths

```dart
final resolved = await sv.resolveDerivationPath(
  derivationPath: bip44Uri,
  purpose: Purpose.signSolanaTransaction,
);
// Returns fully-qualified URI the Seed Vault will use
```

---

## Signing Operations

### Sign Transactions

```dart
final request = SigningRequest(
  payload: compiledTransactionBytes,           // Uint8List
  requestedSignatures: [account.derivationPath], // List<Uri>
);

final responses = await sv.signTransactions(
  authToken: authToken,
  signingRequests: [request],
);

// responses[i].signatures — List<Uint8List> matching requestedSignatures
// responses[i].resolvedDerivationPaths — List<Uri>
```

### Sign Messages (Arbitrary Data)

```dart
final responses = await sv.signMessages(
  authToken: authToken,
  signingRequests: [
    SigningRequest(
      payload: messageBytes,
      requestedSignatures: [account.derivationPath],
    ),
  ],
);
```

### Request Public Keys

```dart
final publicKeys = await sv.requestPublicKeys(
  authToken: authToken,
  derivationPaths: [
    Bip44DerivationPath.toUri([BipLevel(index: 0, hardened: true)]),
    Bip44DerivationPath.toUri([BipLevel(index: 1, hardened: true)]),
  ],
);

for (final pk in publicKeys) {
  print(pk.publicKeyEncoded);          // base58 string
  print(pk.resolvedDerivationPath);    // resolved Uri
  // pk.publicKey — raw Uint8List (nullable)
}
```

### Batch Signing — Respect Limits

The device enforces implementation limits. Query them before batching:

```dart
final limits = await sv.getParsedImplementationLimitsForPurpose(
  Purpose.signSolanaTransaction,
);

// limits.maxSigningRequests        — max SigningRequest items per call
// limits.maxRequestedSignatures    — max signatures per request
// limits.maxRequestedPublicKeys    — max public keys per call
// limits.maxBip32PathDepth         — max BIP path depth

// Minimum guaranteed by spec:
// maxSigningRequests ≥ 3
// maxRequestedSignatures ≥ 3
// maxRequestedPublicKeys ≥ 10
```

Always chunk your requests to stay within limits:

```dart
final batchSize = limits.maxSigningRequests;
for (var i = 0; i < requests.length; i += batchSize) {
  final chunk = requests.sublist(
    i,
    (i + batchSize).clamp(0, requests.length),
  );
  final responses = await sv.signTransactions(
    authToken: authToken,
    signingRequests: chunk,
  );
  // process responses...
}
```

---

## Change Notifications

Seed Vault pushes content-provider change events into a stream:

```dart
final subscription = sv.notificationStream.listen((notification) {
  // notification.uris — List<Uri> of changed content URIs
  // notification.flags — bitfield of change types
  refreshUI();
});

// Clean up
subscription.cancel();
```

Use this to refresh your account list when the user adds or removes seeds
from the Seed Vault system settings.

---

## Patterns & Recipes

### Full BLoC Integration

```dart
class SeedVaultBloc extends Cubit<SeedVaultState> {
  SeedVaultBloc() : super(const SeedVaultState.none());

  StreamSubscription? _sub;

  Future<void> init() async {
    final sv = SeedVault.instance;
    if (!await sv.isAvailable()) {
      emit(const SeedVaultState.unavailable());
      return;
    }
    if (!await sv.checkPermission()) {
      emit(const SeedVaultState.unauthorized());
      return;
    }

    _sub = sv.notificationStream.listen((_) => _refresh());
    await _refresh();
  }

  Future<void> _refresh() async {
    final sv = SeedVault.instance;
    final seeds = await sv.getParsedAuthorizedSeeds();
    final limits = await sv.getParsedImplementationLimitsForPurpose(
      Purpose.signSolanaTransaction,
    );
    final hasUnauthorized = await sv.hasUnauthorizedSeedsForPurpose(
      Purpose.signSolanaTransaction,
    );
    emit(SeedVaultState.loaded(
      seeds: seeds,
      limits: limits,
      hasUnauthorizedSeeds: hasUnauthorized,
    ));
  }

  Future<void> authorizeSeed() async {
    final token = await SeedVault.instance
        .authorizeSeed(Purpose.signSolanaTransaction);
    // Mark discovered accounts as user wallets
    final accounts = await SeedVault.instance.getParsedAccounts(token);
    for (final a in accounts) {
      await SeedVault.instance.updateAccountIsUserWallet(
        authToken: token,
        accountId: a.id,
        isUserWallet: true,
      );
    }
    await _refresh();
  }

  @override
  Future<void> close() {
    _sub?.cancel();
    return super.close();
  }
}
```

### Verify Signatures After Signing

```dart
import 'package:solana/solana.dart' show verifySignature;

Future<bool> verifySigningResponse(
  SigningResponse response,
  Uint8List payload,
  List<Account> accounts,
) async {
  for (var i = 0; i < response.signatures.length; i++) {
    final pubKeyBytes = accounts
        .firstWhere((a) =>
            a.derivationPath == response.resolvedDerivationPaths[i])
        .publicKeyRaw;
    final valid = await verifySignature(
      message: payload,
      signature: response.signatures[i],
      publicKey: Ed25519HDPublicKey(pubKeyBytes.toList()),
    );
    if (!valid) return false;
  }
  return true;
}
```

### Platform Guard for Cross-Platform Apps

```dart
import 'dart:io' show Platform;

Future<bool> isSeedVaultAvailable() async {
  if (!Platform.isAndroid) return false;
  return SeedVault.instance.isAvailable();
}
```

---

## Model Reference

| Type | Kind | Key Fields |
|------|------|------------|
| `AuthToken` | typedef `int` | — |
| `Purpose` | enum | `signSolanaTransaction` |
| `Seed` | freezed | `authToken`, `name`, `purpose`, `accounts` |
| `Account` | freezed | `id`, `name`, `derivationPath`, `publicKeyEncoded`, `publicKeyRaw`, `isUserWallet`, `isValid` |
| `BipLevel` | freezed | `index`, `hardened` |
| `Bip44Data` | freezed | `account`, `change?`, `addressIndex?` |
| `AccountFilter` | freezed union | 7 factories (none, byId, byName, byDerivationPath, byPublicKeyEncoded, byIsUserWallet, byIsValid) |
| `ImplementationLimits` | freezed | `maxBip32PathDepth`, `maxSigningRequests`, `maxRequestedSignatures`, `maxRequestedPublicKeys` |
| `SigningRequest` | freezed | `payload` (Uint8List), `requestedSignatures` (List\<Uri\>) |
| `SigningResponse` | freezed | `signatures` (List\<Uint8List\>), `resolvedDerivationPaths` (List\<Uri\>) |
| `PublicKeyResponse` | freezed | `publicKey?`, `publicKeyEncoded?`, `resolvedDerivationPath` |
| `SeedVaultNotification` | freezed | `uris` (List\<Uri\>), `flags` (int) |

---

## WalletContractV1 Constants

Key constants mirroring the Android content provider:

| Constant | Value / Purpose |
|----------|-----------------|
| `ACTION_AUTHORIZE_SEED_ACCESS` | Intent to authorize seed |
| `ACTION_SIGN_TRANSACTION` | Intent to sign transaction |
| `ACTION_SIGN_MESSAGE` | Intent to sign message |
| `ACTION_GET_PUBLIC_KEY` | Intent to request public key |
| `ACTION_CREATE_SEED` | Intent to create seed |
| `ACTION_IMPORT_SEED` | Intent to import seed |
| `resultInvalidAuthToken` | Error 1001 — token expired or revoked |
| `resultInvalidPayload` | Error 1002 — malformed transaction bytes |
| `resultAuthenticationFailed` | Error 1003 — biometric/PIN rejected |
| `resultNoAvailableSeeds` | Error 1004 — no seeds on device |
| `resultInvalidPurpose` | Error 1005 — wrong purpose enum |
| `resultInvalidDerivationPath` | Error 1006 — malformed BIP path |
| `resultImplementationLimitExceeded` | Error 1007 — batch too large |

---

## Common Mistakes

| # | Mistake | Fix |
|---|---------|-----|
| 1 | Calling Seed Vault methods without checking `isAvailable()` first — crashes on non-Saga/Seeker devices | Always guard with `if (!await sv.isAvailable()) return;` before any operation |
| 2 | Hardcoding derivation paths as strings instead of using `Bip44DerivationPath.toUri()` | Use the typed helper: `Bip44DerivationPath.toUri([BipLevel(index: 0, hardened: true)])` |
| 3 | Ignoring `checkPermission()` — user must grant content-provider access | Call `checkPermission()` after `isAvailable()` and handle denial |
| 4 | Exceeding `maxSigningRequests` or `maxRequestedSignatures` — causes error 1007 | Query `getParsedImplementationLimitsForPurpose()` and chunk batches |
| 5 | Using raw cursor methods (`getAuthorizedSeeds`) instead of typed extensions (`getParsedAuthorizedSeeds`) | Use `SeedVaultHelperExt` methods — they return typed `Seed` / `Account` objects |
| 6 | Not listening to `notificationStream` — UI goes stale when user manages seeds in system settings | Subscribe and call refresh on every notification |
| 7 | Forgetting to call `updateAccountIsUserWallet(true)` after authorization — accounts not flagged as app wallets | After `authorizeSeed`, iterate accounts and mark `isUserWallet: true` |
| 8 | Building for iOS — Seed Vault is Android-only | Guard with `Platform.isAndroid` check before accessing `SeedVault.instance` |

---

## Related

- [solana-core.md](solana-core.md) — core types used for transaction building
- [solana-mobile-client.md](solana-mobile-client.md) — dApp-side MWA (alternative signing path)
- [solana-mobile-wallet.md](solana-mobile-wallet.md) — wallet-side MWA
- [transaction-building.md](transaction-building.md) — building transactions to pass to `signTransactions`
