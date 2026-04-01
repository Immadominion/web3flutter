# solana_mobile_wallet — Building a Wallet with MWA Support

> Flutter Android plugin for building the wallet side of Solana's Mobile Wallet Adapter (MWA) protocol. Receive authorization, signing, and send requests from dApps, present them to the user, and return results.

## Overview

The `solana_mobile_wallet` package (v0.2.0+1) implements the wallet side of Solana's MWA spec. If you're building a Flutter wallet app that other dApps should be able to connect to for signing, this is the package.

You implement `ScenarioCallbacks` — a set of lifecycle hooks and request handlers. When a dApp connects via `solana_mobile_client`, your callbacks fire with the request data. You present a UI to the user (approve/decline), then return the result.

Key types:

- `ScenarioCallbacks` — abstract class with 7 lifecycle + 6 request callbacks
- `MobileWalletAdapterConfig` — your wallet's capabilities
- `AuthIssuerConfig` — auth token policies
- `SignedPayloadResult` / `SignaturesResult` — freezed unions with success + error variants

This is Android-only (Pigeon-based platform channels to the MWA Java SDK).

**Package link:** [GitHub](https://github.com/espresso-cash/espresso-cash-public/tree/master/packages/solana_mobile_wallet)

## Quick Start

```yaml
dependencies:
  solana_mobile_wallet: ^0.2.0
  solana: ^0.31.0
```

```dart
import 'package:solana_mobile_wallet/solana_mobile_wallet.dart';

// Configure your wallet's capabilities
Api.instance.setup(
  walletConfig: const MobileWalletAdapterConfig(
    supportsSignAndSendTransactions: true,
    maxTransactionsPerSigningRequest: 10,
    maxMessagesPerSigningRequest: 10,
    supportedTransactionVersions: ['legacy'],
  ),
  issuerConfig: const AuthIssuerConfig(
    name: 'My Wallet',
    maxOutstandingTokensPerIdentity: 50,
    authorizationValidity: Duration(hours: 1),
    reauthorizationValidity: Duration(days: 30),
  ),
  callbacks: myCallbacksImpl,
);
```

## Core Concepts

### ScenarioCallbacks — The Interface You Implement

```dart
abstract class ScenarioCallbacks {
  // === Lifecycle (informational, no return value) ===
  void onScenarioReady(Scenario scenario);
  void onScenarioServingClients();
  void onScenarioServingComplete();
  void onScenarioComplete();
  void onScenarioError();
  void onScenarioTeardownComplete();
  void onLowPowerAndNoConnection();

  // === Request Handlers (return result to dApp) ===
  Future<AuthorizeResult?> onAuthorizeRequest(AuthorizeRequest request);
  Future<bool> onReauthorizeRequest(ReauthorizeRequest request);
  Future<SignedPayloadResult?> onSignTransactionsRequest(SignTransactionsRequest request);
  Future<SignedPayloadResult?> onSignMessagesRequest(SignMessagesRequest request);
  Future<SignaturesResult?> onSignAndSendTransactionsRequest(SignAndSendTransactionsRequest request);
  Future<void> onDeauthorizeEvent(DeauthorizeEvent event);
}
```

> **WHY THIS MATTERS**: Every request handler is `async`. The pattern is: receive request → show UI → wait for user action → return result. Use a `Completer<T?>` to bridge the gap between the callback and the user's UI tap.

### Configuration

**`MobileWalletAdapterConfig`** — what your wallet supports:

```dart
const MobileWalletAdapterConfig(
  supportsSignAndSendTransactions: true,      // can sign AND submit
  maxTransactionsPerSigningRequest: 10,        // per batch
  maxMessagesPerSigningRequest: 10,            // per batch
  supportedTransactionVersions: ['legacy'],    // 'legacy', 'v0'
  noConnectionWarningTimeout: Duration(seconds: 3), // low-power warning
)
```

**`AuthIssuerConfig`** — auth token policies:

```dart
const AuthIssuerConfig(
  name: 'My Wallet',
  maxOutstandingTokensPerIdentity: 50,         // max active tokens per dApp
  authorizationValidity: Duration(hours: 1),   // how long auth lasts
  reauthorizationValidity: Duration(days: 30), // how long reauth extends
  reauthorizationNopDuration: Duration(minutes: 10), // skip re-prompt within this
)
```

### Request Types

**`AuthorizeRequest`** — dApp wants to connect:

```dart
class AuthorizeRequest {
  final String? identityName;  // "My dApp"
  final Uri? identityUri;      // https://myapp.com
  final Uri? iconUri;          // https://myapp.com/icon.png
}
```

**`ReauthorizeRequest`** — dApp wants to refresh:

```dart
class ReauthorizeRequest {
  final String? identityName;
  final Uri? identityUri;
  final Uri? iconRelativeUri;
  final String cluster;          // 'devnet', 'mainnet-beta'
  final Uint8List authorizationScope;
}
```

**`SignTransactionsRequest`** / **`SignMessagesRequest`** — both extend `SignPayloadsRequest`:

```dart
class SignTransactionsRequest {
  final String? identityName;
  final Uri? identityUri;
  final String cluster;
  final Uint8List authorizationScope;
  final List<Uint8List> payloads;  // transaction or message bytes
}
```

**`SignAndSendTransactionsRequest`**:

```dart
class SignAndSendTransactionsRequest {
  final List<Uint8List> transactions;
  final int? minContextSlot;
  // + identity fields
}
```

### Result Types (Freezed Unions)

**`SignedPayloadResult`** — for sign-only requests:

```dart
// User approves — return signed payloads
SignedPayloadResult(signedPayloads: [signedBytes1, signedBytes2])

// User declines
SignedPayloadResult.requestDeclined()

// Some payloads are invalid (e.g., can't deserialize as transaction)
SignedPayloadResult.invalidPayloads(valid: [true, false, true])

// Too many payloads in request
SignedPayloadResult.tooManyPayloads()

// Auth token expired
SignedPayloadResult.authorizationNotValid()
```

**`SignaturesResult`** — for sign-and-send requests:

```dart
// Success — transactions submitted, return signatures
SignaturesResult(signatures: [sig1, sig2])

// Signed but NOT submitted (wallet chose not to send)
SignaturesResult.notSubmitted(signatures: [sig1, sig2])

// Same error variants as SignedPayloadResult:
SignaturesResult.requestDeclined()
SignaturesResult.invalidPayloads(valid: [true, false])
SignaturesResult.tooManyPayloads()
SignaturesResult.authorizationNotValid()
```

> **GOTCHA**: The `notSubmitted` variant is unique to `SignaturesResult`. Return this when you signed the transactions but decided not to submit them (e.g., simulation failed). The dApp can then submit them itself.

### Scenario Lifecycle

```
dApp opens connection
        ↓
onScenarioReady(scenario)  ← scenario object with id + publicKey
        ↓
scenario.start()           ← start serving
        ↓
onScenarioServingClients() ← dApp connected
        ↓
   request/response cycle  ← authorize, sign, send
        ↓
onScenarioServingComplete()
        ↓
scenario.close()
        ↓
onScenarioTeardownComplete()
```

## Patterns & Recipes

### BLoC Implementation

The canonical pattern uses a Cubit with Completers:

```dart
import 'dart:async';
import 'dart:typed_data';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:solana_mobile_wallet/solana_mobile_wallet.dart';

// State union
sealed class WalletMwaState {}
class MwaIdle extends WalletMwaState {}
class MwaSessionTerminated extends WalletMwaState {}
class MwaAuthorizeRequest extends WalletMwaState {
  final AuthorizeRequest request;
  MwaAuthorizeRequest(this.request);
}
class MwaSignRequest extends WalletMwaState {
  final SignPayloadsRequest request;
  MwaSignRequest(this.request);
}
class MwaSignAndSendRequest extends WalletMwaState {
  final SignAndSendTransactionsRequest request;
  MwaSignAndSendRequest(this.request);
}

class WalletMwaBloc extends Cubit<WalletMwaState> implements ScenarioCallbacks {
  WalletMwaBloc() : super(MwaIdle());

  Scenario? _scenario;
  Completer<AuthorizeResult?>? _authorizeCompleter;
  Completer<SignedPayloadResult?>? _signCompleter;
  Completer<SignaturesResult?>? _signaturesCompleter;

  void initialize() {
    Api.instance.setup(
      walletConfig: const MobileWalletAdapterConfig(
        supportsSignAndSendTransactions: true,
        maxTransactionsPerSigningRequest: 10,
        maxMessagesPerSigningRequest: 10,
        supportedTransactionVersions: ['legacy'],
      ),
      issuerConfig: const AuthIssuerConfig(name: 'My Wallet'),
      callbacks: this,
    );
  }

  // === Lifecycle ===
  @override
  void onScenarioReady(Scenario scenario) {
    _scenario = scenario;
    scenario.start();
  }

  @override void onScenarioServingClients() {}
  @override void onScenarioServingComplete() {}

  @override
  void onScenarioComplete() {
    emit(MwaSessionTerminated());
  }

  @override void onScenarioError() => emit(MwaSessionTerminated());
  @override void onScenarioTeardownComplete() => emit(MwaIdle());
  @override void onLowPowerAndNoConnection() {}

  // === Request Handlers ===
  @override
  Future<AuthorizeResult?> onAuthorizeRequest(AuthorizeRequest request) async {
    _authorizeCompleter = Completer<AuthorizeResult?>();
    emit(MwaAuthorizeRequest(request));
    return _authorizeCompleter!.future; // waits for UI action
  }

  @override
  Future<bool> onReauthorizeRequest(ReauthorizeRequest request) async {
    return true; // auto-approve reauth (or show UI)
  }

  @override
  Future<SignedPayloadResult?> onSignTransactionsRequest(
    SignTransactionsRequest request,
  ) async {
    _signCompleter = Completer<SignedPayloadResult?>();
    emit(MwaSignRequest(request));
    return _signCompleter!.future;
  }

  @override
  Future<SignedPayloadResult?> onSignMessagesRequest(
    SignMessagesRequest request,
  ) async {
    _signCompleter = Completer<SignedPayloadResult?>();
    emit(MwaSignRequest(request));
    return _signCompleter!.future;
  }

  @override
  Future<SignaturesResult?> onSignAndSendTransactionsRequest(
    SignAndSendTransactionsRequest request,
  ) async {
    _signaturesCompleter = Completer<SignaturesResult?>();
    emit(MwaSignAndSendRequest(request));
    return _signaturesCompleter!.future;
  }

  @override
  Future<void> onDeauthorizeEvent(DeauthorizeEvent event) async {
    // Clean up stored auth for this dApp
  }

  // === UI Actions ===
  void approveAuthorize(Uint8List publicKey) {
    _authorizeCompleter?.complete(AuthorizeResult(publicKey: publicKey));
  }

  void declineAuthorize() {
    _authorizeCompleter?.complete(null);
  }

  void approveSign(List<Uint8List> signedPayloads) {
    _signCompleter?.complete(
      SignedPayloadResult(signedPayloads: signedPayloads),
    );
  }

  void declineSign() {
    _signCompleter?.complete(SignedPayloadResult.requestDeclined());
  }

  void approveSignAndSend(List<Uint8List> signatures) {
    _signaturesCompleter?.complete(
      SignaturesResult(signatures: signatures),
    );
  }

  void declineSignAndSend() {
    _signaturesCompleter?.complete(SignaturesResult.requestDeclined());
  }
}
```

### Handling `onNewIntent`

When a dApp sends a new MWA intent while your wallet is already running:

```dart
// The Api automatically handles onNewIntent internally.
// When a new intent arrives (not the initial one), it:
// 1. Gets stored config + callbacks from setup()
// 2. Calls createScenario on the platform side
// 3. Registers the new Scenario
// 4. Calls your onScenarioReady() callback
//
// No additional code needed — just make sure setup() was called.
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Not calling `scenario.start()` in `onScenarioReady` | Scenario doesn't serve until started | Always call `scenario.start()` when ready |
| Completing the Completer twice | Two UI buttons for same request | Use `_completer?.isCompleted ?? true` guard |
| Forgetting to call `setup()` | App launches but ignores MWA intents | Call `Api.instance.setup()` early in app lifecycle |
| Returning `null` from `onAuthorizeRequest` | Means decline — but no error info for dApp | Return `null` for decline, or throw for errors |
| Not handling all `SignedPayloadResult` variants | dApp needs to know WHY signing failed | Use `.when()` or `.map()` on the freezed union |
| Blocking the request handler | Long computation before returning | Show UI immediately, do signing async, complete when done |

## Related

- [solana-mobile-client.md](solana-mobile-client.md) — The dApp side (what connects to you)
- [solana-seed-vault.md](solana-seed-vault.md) — Hardware signing for wallet apps on Saga/Seeker
- [solana-core.md](solana-core.md) — Transaction deserialization and signing
