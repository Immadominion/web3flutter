# Solana Mobile — MWA, Seed Vault, and the Android Reality

> Three packages, one platform: `solana_mobile_client` (dApp side), `solana_mobile_wallet` (wallet side), and `solana_seed_vault` (hardware signing). All Android-only. All built on Flutter's Pigeon for platform channel communication.

## Overview

Solana Mobile's stack targets a specific architecture: a **dApp** communicates with a **wallet** over a local association (same-device TCP), and the wallet optionally delegates signing to a **hardware Seed Vault** (on Saga/Seeker devices). No internet needed for the dApp↔wallet link.

Three packages implement the three roles:

| Package | Role | What It Does |
|---------|------|-------------|
| `solana_mobile_client` v0.1.1+1 | dApp | Connects to wallet, requests signatures |
| `solana_mobile_wallet` v0.2.0+1 | Wallet | Receives signing requests, returns signatures |
| `solana_seed_vault` v0.2.0+1 | Hardware | Accesses Saga's secure element for key management |

All three are **Android-only** Flutter plugins. Apple blocks the inter-app communication and secure element access patterns these packages rely on.

---

## Quick Start — dApp Side (`solana_mobile_client`)

```dart
import 'package:solana_mobile_client/solana_mobile_client.dart';

// Check if a wallet is available
final available = await LocalAssociationScenario.isAvailable();
if (!available) {
  // Fall back to WalletConnect, deep links, or embedded wallet
  return;
}

// Create and start an association
final scenario = await LocalAssociationScenario.create();
final client = await scenario.start();

try {
  // Authorize — user sees a consent dialog in their wallet app
  final auth = await client.authorize(
    identityUri: Uri.parse('https://myapp.com'),
    iconUri: Uri.parse('https://myapp.com/icon.png'),
    identityName: 'My dApp',
    cluster: 'devnet',
  );

  if (auth == null) return; // user declined

  final publicKey = auth.publicKey;   // Uint8List — the user's public key
  final authToken = auth.authToken;   // String — reuse for reauthorize()

  // Sign a transaction
  final result = await client.signTransactions(
    transactions: [serializedTx], // List<Uint8List>
  );
  final signedTx = result.signedPayloads.first;

  // Or sign AND send in one step
  final sendResult = await client.signAndSendTransactions(
    transactions: [serializedTx],
    minContextSlot: currentSlot,
  );
  final signature = sendResult.signatures.first;
} finally {
  await scenario.close(); // always close the association
}
```

### The Association Lifecycle

```
create() → start() → [authorize → sign → ...] → close()
   │          │                                      │
   │          └── Returns MobileWalletAdapterClient   │
   │              (all signing methods live here)      │
   └── Allocates a local socket ID                    └── Cleans up socket
```

`start()` opens a local TCP socket connection to the wallet app. The returned `MobileWalletAdapterClient` is your interface for all operations. `close()` tears down the socket — always call it, even on error.

`startActivityForResult(uriPrefix)` launches the wallet app's activity if you know the wallet's URI prefix (from `auth.walletUriBase`).

### MobileWalletAdapterClient — Full API

| Method | Parameters | Returns | Notes |
|--------|-----------|---------|-------|
| `getCapabilities` | none | `GetCapabilitiesResult?` | What the wallet supports |
| `authorize` | identityUri, iconUri, identityName, cluster | `AuthorizationResult?` | First-time connection |
| `reauthorize` | identityUri, iconUri, identityName, **authToken** | `AuthorizationResult?` | Reuse existing token — skip consent dialog |
| `deauthorize` | **authToken** | `void` | Revoke access |
| `signTransactions` | **transactions** (List\<Uint8List\>) | `SignPayloadsResult` | Returns signed bytes |
| `signMessages` | **messages** + **addresses** | `SignMessagesResult` | Arbitrary message signing |
| `signAndSendTransactions` | **transactions**, minContextSlot? | `SignAndSendTransactionsResult` | Wallet submits to RPC |

> **WHY THIS MATTERS**: `signAndSendTransactions` lets the wallet submit the transaction, not your dApp. The wallet can use its own RPC endpoint (often faster, with priority fee management). This is the preferred method when available — check `getCapabilities().supportsSignAndSendTransactions` first.

### GetCapabilitiesResult

```dart
final caps = await client.getCapabilities();
caps?.supportsCloneAuthorization;        // bool — can clone auth to another app
caps?.supportsSignAndSendTransactions;   // bool — wallet can submit directly
caps?.maxTransactionsPerSigningRequest;  // int — batch limit
caps?.maxMessagesPerSigningRequest;      // int — batch limit
```

### Error Handling

All methods catch `PlatformException` from the Pigeon bridge. Nullable methods (`authorize`, `reauthorize`, `getCapabilities`) return `null` on failure. Sign methods return empty result objects (empty `signedPayloads` / `signatures` lists). There are no custom exception types — check for `null` and empty lists.

---

## Building a Wallet (`solana_mobile_wallet`)

If you're building a wallet app (not just a dApp), this package handles the receiving end of MWA.

### Configuration

```dart
final walletConfig = MobileWalletAdapterConfig(
  supportsSignAndSendTransactions: true,
  maxTransactionsPerSigningRequest: 10,
  maxMessagesPerSigningRequest: 10,
  supportedTransactionVersions: ['legacy', 0], // legacy + v0
  noConnectionWarningTimeout: Duration(seconds: 3),
);

final authConfig = AuthIssuerConfig(
  name: 'My Wallet',
  maxOutstandingTokensPerIdentity: 50,
  authorizationValidity: Duration(hours: 1),
  reauthorizationValidity: Duration(days: 30),
  reauthorizationNopDuration: Duration(minutes: 10), // skip re-auth if recent
);
```

### ScenarioCallbacks — The Core Interface

Your wallet implements `ScenarioCallbacks` to handle incoming dApp requests:

```dart
class MyWalletCallbacks extends ScenarioCallbacks {
  // === Lifecycle ===
  @override
  void onScenarioReady(Scenario scenario) {
    // Association established — show "connected" UI
    scenario.start();
  }

  @override
  void onScenarioServingClients() { /* dApp is connected */ }

  @override
  void onScenarioServingComplete() { /* dApp disconnected */ }

  @override
  void onScenarioComplete() { /* session fully done */ }

  @override
  void onScenarioError() { /* connection failed */ }

  @override
  void onScenarioTeardownComplete() { /* cleanup done */ }

  @override
  void onLowPowerAndNoConnection() { /* battery saving hint */ }

  // === Request Handlers ===
  @override
  Future<AuthorizeResult?> onAuthorizeRequest(AuthorizeRequest request) async {
    // Show consent dialog to user
    // request.identityName, request.identityUri, request.iconUri
    final approved = await showConsentDialog(request);
    if (!approved) return null; // declines

    return AuthorizeResult(
      publicKey: walletPublicKeyBytes,
      accountLabel: 'Main Account',
      walletUriBase: Uri.parse('https://mywallet.com'),
      scope: authScopeBytes,
    );
  }

  @override
  Future<bool> onReauthorizeRequest(ReauthorizeRequest request) async {
    // Validate the existing auth scope
    return isValidScope(request.authorizationScope);
  }

  @override
  Future<SignedPayloadResult?> onSignTransactionsRequest(
    SignTransactionsRequest request,
  ) async {
    final transactions = request.payloads; // List<Uint8List>
    // Sign each transaction with the wallet's private key
    final signed = await signAll(transactions);
    return SignedPayloadResult(signedPayloads: signed);
    // Or: SignedPayloadResult.requestDeclined()
    // Or: SignedPayloadResult.invalidPayloads(valid: [true, false, true])
  }

  @override
  Future<SignedPayloadResult?> onSignMessagesRequest(
    SignMessagesRequest request,
  ) async {
    // Similar to signTransactions but for arbitrary messages
  }

  @override
  Future<SignaturesResult?> onSignAndSendTransactionsRequest(
    SignAndSendTransactionsRequest request,
  ) async {
    // Sign + submit via wallet's RPC connection
    // request.transactions, request.minContextSlot
    final signatures = await signAndSubmit(request.transactions);
    return SignaturesResult(signatures: signatures);
    // Or: SignaturesResult.notSubmitted(signatures: partialSigs)
  }

  @override
  Future<void> onDeauthorizeEvent(DeauthorizeEvent event) async {
    // Revoke stored auth tokens for this dApp
    await revokeAuth(event.identityUri);
  }
}
```

### Result Union Types

`SignedPayloadResult` and `SignaturesResult` are freezed unions — they encode both success and specific failure modes:

```dart
// Success
SignedPayloadResult(signedPayloads: [...])

// Failures
SignedPayloadResult.requestDeclined()             // user said no
SignedPayloadResult.invalidPayloads(valid: [...]) // bool per payload
SignedPayloadResult.tooManyPayloads()             // exceeded batch limit
SignedPayloadResult.authorizationNotValid()        // expired auth token

// SignaturesResult has one extra:
SignaturesResult.notSubmitted(signatures: [...])   // signed but RPC submit failed
```

### Pigeon Architecture

The wallet plugin uses bidirectional Pigeon:

- `@HostApi() ApiHost` — Dart calls Android: `start(id)`, `close(id)`, `createScenario(id, config, authConfig)`
- `@FlutterApi() ApiFlutter` — Android calls Dart: scenario lifecycle callbacks + request handlers

When a dApp connects, Android fires `onScenarioReady` → your Dart callback creates the `Scenario`, calls `start()`, and begins serving. All request handlers are `Future`-returning — you can show UI, prompt the user, and async respond. Return `null` from any handler to decline.

---

## Seed Vault — Hardware Key Management (`solana_seed_vault`)

The Seed Vault is a dedicated secure processor on Saga/Seeker devices. Private keys live inside the hardware — your app never sees them.

### The Singleton

```dart
final vault = SeedVault.instance;

// Check availability
final available = await vault.isAvailable(allowSimulated: false);
final hasPermission = await vault.checkPermission();
```

`allowSimulated: true` enables testing with the Seed Vault simulator on non-Saga devices.

### Seed Lifecycle

```dart
// Authorize access to an existing seed (user picks from their seeds)
final authToken = await vault.authorizeSeed(Purpose.signSolanaTransaction);

// Create a new seed (generates inside the hardware)
final newSeedToken = await vault.createSeed(Purpose.signSolanaTransaction);

// Import a seed (user enters their mnemonic into the trusted UI)
final importedToken = await vault.importSeed(Purpose.signSolanaTransaction);

// Revoke access
await vault.deauthorizeSeed(authToken);
```

`AuthToken` is a `typedef` for `int`. `Purpose` is an enum with one value: `signSolanaTransaction`. The `authToken` is scoped per-seed, per-purpose — store it to avoid re-authorizing on every app launch.

### Keys and Derivation Paths

```dart
// Request public keys at specific derivation paths
final keys = await vault.requestPublicKeys(
  authToken: authToken,
  derivationPaths: [
    Bip32DerivationPath.toUri([
      BipLevel(index: 44, hardened: true),
      BipLevel(index: 501, hardened: true),
      BipLevel(index: 0, hardened: true),
    ]),
    // URI: bip32:///m/44'/501'/0'
  ],
);

for (final key in keys) {
  print(key.publicKeyEncoded);        // base58 public key
  print(key.resolvedDerivationPath);  // the exact path used
}
```

BIP derivation paths use URIs:

- `Bip32DerivationPath.toUri(levels)` → `bip32:///m/44'/501'/0'`
- `Bip44DerivationPath.toUri(levels)` → `bip44:///0'/0'/0'` (coin type is implied)

### Signing

```dart
// Sign transactions (hardware secure element signs, user approves on trusted UI)
final responses = await vault.signTransactions(
  authToken: authToken,
  signingRequests: [
    SigningRequest(
      payload: transactionBytes,
      requestedSignatures: [derivationPathUri], // which key(s) to sign with
    ),
  ],
);

for (final response in responses) {
  final signatures = response.signatures;              // List<Uint8List>
  final paths = response.resolvedDerivationPaths;      // List<Uri>
}

// Sign arbitrary messages (same API shape)
final msgResponses = await vault.signMessages(
  authToken: authToken,
  signingRequests: [
    SigningRequest(
      payload: messageBytes,
      requestedSignatures: [derivationPathUri],
    ),
  ],
);
```

### Account Management

```dart
// List all accounts for a seed
final accounts = await vault.getParsedAccounts(authToken);
for (final account in accounts) {
  print(account.id);                 // int
  print(account.name);               // String
  print(account.derivationPath);     // Uri
  print(account.publicKeyEncoded);   // base58
  print(account.isUserWallet);       // bool
  print(account.isValid);            // bool
}

// Update account metadata
await vault.updateAccountName(
  authToken: authToken,
  accountId: account.id,
  name: 'Savings',
);
await vault.updateAccountIsUserWallet(
  authToken: authToken,
  accountId: account.id,
  isUserWallet: true,
);
```

### Implementation Limits

```dart
final limits = await vault.getParsedImplementationLimitsForPurpose(
  Purpose.signSolanaTransaction,
);
limits.maxBip32PathDepth;       // 20 (max derivation depth)
limits.maxSigningRequests;      // varies by device (min: 3)
limits.maxRequestedSignatures;  // varies (min: 3)
limits.maxRequestedPublicKeys;  // varies (min: 10)
```

### Change Notifications

```dart
vault.notificationStream.listen((notification) {
  // notification.uris — which content URIs changed
  // notification.flags — ContentResolver change flags
  // React: re-fetch accounts, seeds, etc.
});
```

---

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| No iOS fallback | MWA is Android-only | Abstract the signing layer — use WalletConnect or deep links on iOS |
| Not closing the scenario | `finally` block missing | Always `scenario.close()` in a `finally` block |
| Multiple sign requests → UX bounce | Each `signTransactions` call switches to wallet app | Batch operations into a single transaction |
| Auth token expired | `authorizationValidity` exceeded | Call `reauthorize()` with the stored `authToken` |
| Seed Vault `isAvailable` returns false | Not a Saga/Seeker device, or simulator not allowed | Set `allowSimulated: true` for testing, but use real hardware in production |
| `PlatformException` with no useful info | Pigeon bridge strips error details | Check wallet app logs (logcat) for the actual error |
| Wrong derivation path for Seed Vault | Using BIP44 URI when BIP32 is expected | Use `Bip32DerivationPath.toUri()` for Seed Vault operations |

---

## API Quick Reference

### solana_mobile_client

| Type | Purpose |
|------|---------|
| `LocalAssociationScenario` | Create/start/close the local TCP link to a wallet |
| `MobileWalletAdapterClient` | 7 methods: authorize, reauthorize, deauthorize, sign*, getCapabilities |
| `AuthorizationResult` | authToken + publicKey + optional label/walletUri |
| `GetCapabilitiesResult` | Wallet feature flags and batch limits |
| `SignPayloadsResult` | Signed transaction/message bytes |
| `SignAndSendTransactionsResult` | Transaction signatures (wallet submitted) |

### solana_mobile_wallet

| Type | Purpose |
|------|---------|
| `ScenarioCallbacks` | Abstract class — 7 lifecycle + 6 request callbacks |
| `MobileWalletAdapterConfig` | Advertise wallet capabilities to dApps |
| `AuthIssuerConfig` | Token TTLs and limits |
| `SignedPayloadResult` | Union: success / declined / invalid / tooMany / authNotValid |
| `SignaturesResult` | Union: success / declined / invalid / tooMany / authNotValid / notSubmitted |

### solana_seed_vault

| Type | Purpose |
|------|---------|
| `SeedVault.instance` | Singleton — 20+ methods for seeds, accounts, keys, signing |
| `AuthToken` (int) | Scoped access token for a seed |
| `SigningRequest` | Payload + derivation paths to sign with |
| `PublicKeyResponse` | Public key bytes + resolved derivation path |
| `Bip32DerivationPath` | BIP-32 path ↔ URI conversion |
| `Account` | Typed model: id, name, path, pubkey, flags |

---

## Related

- [The solana Package](solana-package) — Core SDK that these packages sign transactions for
- [Wallet UX Patterns](wallet-ux) — Designing wallet integration flows
- [Token Operations](token-ops) — SPL tokens need signing too
