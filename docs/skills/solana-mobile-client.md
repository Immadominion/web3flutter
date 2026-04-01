# solana_mobile_client — Mobile Wallet Adapter for dApps

> Flutter Android plugin for connecting dApps to Solana wallets via the Mobile Wallet Adapter (MWA) protocol. Handles session lifecycle, authorization, transaction signing, and message signing.

## Overview

The `solana_mobile_client` package implements the dApp side of Solana's Mobile Wallet Adapter spec. When your Flutter app needs a wallet to sign transactions on Android, this package opens a local TCP connection to a wallet app (Phantom, Solflare, Espresso Cash, etc.), requests authorization, and sends payloads for signing.

Two exported classes do everything:

- `LocalAssociationScenario` — manages the session lifecycle (create, start, close)
- `MobileWalletAdapterClient` — the actual RPC methods (authorize, sign, send)

This is Android-only. Apple blocks the inter-app communication patterns MWA relies on. For iOS, use an embedded wallet or deep-link-based connection.

**Package link:** [GitHub](https://github.com/espresso-cash/espresso-cash-public/tree/master/packages/solana_mobile_client)

## Quick Start

```yaml
dependencies:
  solana_mobile_client: ^0.1.1
  solana: ^0.31.0
```

```dart
import 'dart:typed_data';
import 'package:solana_mobile_client/solana_mobile_client.dart';

// Check availability
final available = await LocalAssociationScenario.isAvailable();
if (!available) return; // no wallet installed

// Create session, open wallet, authorize
final session = await LocalAssociationScenario.create();
session.startActivityForResult(null).ignore(); // opens wallet chooser
final client = await session.start();

try {
  final auth = await client.authorize(
    identityUri: Uri.parse('https://myapp.com'),
    iconUri: Uri.parse('https://myapp.com/icon.png'),
    identityName: 'My dApp',
    cluster: 'devnet',
  );
  if (auth == null) return; // user declined

  final publicKey = auth.publicKey;   // Uint8List (32 bytes)
  final authToken = auth.authToken;   // String — save for reauthorize
} finally {
  await session.close(); // ALWAYS close
}
```

## Core Concepts

### Session Lifecycle

Every MWA interaction follows this exact pattern:

```dart
// 1. Create the scenario
final session = await LocalAssociationScenario.create();

// 2. Launch the wallet app (fire-and-forget)
session.startActivityForResult(null).ignore();

// 3. Wait for connection
final client = await session.start();

// 4. Do your operations (authorize, sign, etc.)
// ...

// 5. ALWAYS close
await session.close();
```

> **CRITICAL**: Always close the session in a `finally` block. Leaked sessions leave the wallet app in a stuck state. The user has to force-quit the wallet if you don't close properly.

```dart
final session = await LocalAssociationScenario.create();
session.startActivityForResult(null).ignore();
final client = await session.start();
try {
  // operations here
} finally {
  await session.close();
}
```

### Authorization

First interaction in any session. User sees a consent dialog in their wallet app:

```dart
final auth = await client.authorize(
  identityUri: Uri.parse('https://myapp.com'), // your app's URL
  iconUri: Uri.parse('https://myapp.com/icon.png'), // displayed in wallet
  identityName: 'My dApp',  // displayed in wallet
  cluster: 'devnet',        // 'devnet', 'testnet', 'mainnet-beta'
);

if (auth == null) {
  // User declined or wallet errored
  return;
}

// Store these for later sessions
final authToken = auth.authToken;        // String
final publicKey = auth.publicKey;        // Uint8List (32 bytes)
final accountLabel = auth.accountLabel;  // String? — wallet-chosen name
final walletUriBase = auth.walletUriBase; // Uri? — for startActivityForResult
```

### Reauthorization

For subsequent sessions, skip the consent dialog by reusing the auth token:

```dart
final auth = await client.reauthorize(
  identityUri: Uri.parse('https://myapp.com'),
  iconUri: Uri.parse('https://myapp.com/icon.png'),
  identityName: 'My dApp',
  authToken: savedAuthToken, // from previous authorize
);
```

> **GOTCHA**: Reauthorize fails if the cluster changed since the original authorize. If you switch between devnet/mainnet, clear the stored auth token and do a fresh `authorize()`. Production pattern: check if stored cluster matches desired cluster before reauthorizing.

### Signing Transactions

Two signing modes with different semantics:

**`signAndSendTransactions`** — wallet signs AND submits to network:

```dart
// Build your transaction (using solana package)
final message = Message(instructions: [transferIx, memoIx]);
final bh = await rpc.getLatestBlockhash();
final compiled = message.compile(
  recentBlockhash: bh.value.blockhash,
  feePayer: Ed25519HDPublicKey(auth.publicKey),
);

// Create SignedTx with empty signature placeholder
final signedTx = SignedTx(
  signatures: [Signature(List.filled(64, 0), publicKey: Ed25519HDPublicKey(auth.publicKey))],
  compiledMessage: compiled,
);
final txBytes = signedTx.toByteArray();

// Wallet signs and submits
final result = await client.signAndSendTransactions(
  transactions: [Uint8List.fromList(txBytes)],
  minContextSlot: null,
);

// result.signatures is List<Uint8List> — each is a 64-byte signature (base58-encode for tx ID)
```

**`signTransactions`** — wallet signs only, YOU submit:

```dart
final result = await client.signTransactions(
  transactions: [Uint8List.fromList(txBytes)],
);
// result.signedPayloads is List<Uint8List> — fully signed transaction bytes
// You decode and send: rpc.sendTransaction(base64Encode(result.signedPayloads[0]))
```

> **WHY THIS MATTERS**: Use `signAndSendTransactions` for simple flows — the wallet handles submission and may add priority fees. Use `signTransactions` when your backend needs to co-sign (multi-sig pattern) or when you need to submit from your own RPC endpoint with custom retry logic.

### Signing Messages (Off-Chain)

```dart
final result = await client.signMessages(
  messages: [Uint8List.fromList(utf8.encode('Sign in to My dApp'))],
  addresses: [auth.publicKey], // which key should sign
);

for (final signed in result.signedMessages) {
  print('Message: ${signed.message}');
  print('Signatures: ${signed.signatures}'); // List<Uint8List>
}
```

### Checking Wallet Capabilities

```dart
final caps = await client.getCapabilities();
if (caps != null) {
  print('Clone auth: ${caps.supportsCloneAuthorization}');
  print('Sign+send: ${caps.supportsSignAndSendTransactions}');
  print('Max txs/request: ${caps.maxTransactionsPerSigningRequest}');
  print('Max msgs/request: ${caps.maxMessagesPerSigningRequest}');
}
```

### Deauthorization

Clean up when user disconnects:

```dart
await client.deauthorize(authToken: savedAuthToken);
// Clear saved token and public key from secure storage
```

## Patterns & Recipes

### Production Session Management

From the sol_new app — persist auth, handle cluster changes, reauth before signing:

```dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class MobileWalletService {
  final FlutterSecureStorage _storage;

  Future<AuthorizationResult?> connectWallet(String rpcUrl) async {
    final session = await LocalAssociationScenario.create();
    session.startActivityForResult(null).ignore();
    final client = await session.start();

    try {
      final cluster = _clusterFromUrl(rpcUrl);

      // Try reauth first
      final savedToken = await _storage.read(key: 'mwa_auth_token');
      final savedCluster = await _storage.read(key: 'mwa_cluster');

      if (savedToken != null && savedCluster == cluster) {
        final reauth = await client.reauthorize(
          identityUri: Uri.parse('https://myapp.com'),
          identityName: 'My App',
          authToken: savedToken,
        );
        if (reauth != null) {
          await _persistAuth(reauth, cluster);
          return reauth;
        }
      }

      // Fresh authorize
      final auth = await client.authorize(
        identityUri: Uri.parse('https://myapp.com'),
        identityName: 'My App',
        cluster: cluster,
      );
      if (auth != null) {
        await _persistAuth(auth, cluster);
      }
      return auth;
    } finally {
      await session.close();
    }
  }

  Future<void> _persistAuth(AuthorizationResult auth, String cluster) async {
    await _storage.write(key: 'mwa_auth_token', value: auth.authToken);
    await _storage.write(
      key: 'mwa_public_key',
      value: base58encode(auth.publicKey),
    );
    await _storage.write(key: 'mwa_cluster', value: cluster);
  }

  String _clusterFromUrl(String url) {
    if (url.contains('devnet')) return 'devnet';
    if (url.contains('testnet')) return 'testnet';
    return 'mainnet-beta';
  }
}
```

### Sign and Send with Local Co-Signers

When your transaction has additional signers (e.g., a new account keypair):

```dart
Future<String> signAndSendWithLocalSigners({
  required MobileWalletAdapterClient client,
  required Uint8List walletPubkey,
  required RpcClient rpc,
  required Message message,
  required List<Ed25519HDKeyPair> localSigners,
}) async {
  final bh = await rpc.getLatestBlockhash();
  final feePayer = Ed25519HDPublicKey(walletPubkey);
  final compiled = message.compile(
    recentBlockhash: bh.value.blockhash,
    feePayer: feePayer,
  );

  // Pre-sign with local signers
  final compiledBytes = compiled.toByteArray();
  final signatures = <Signature>[
    Signature(List.filled(64, 0), publicKey: feePayer), // placeholder for wallet
  ];
  for (final signer in localSigners) {
    signatures.add(await signer.sign(compiledBytes));
  }

  final tx = SignedTx(signatures: signatures, compiledMessage: compiled);
  final txBytes = Uint8List.fromList(tx.toByteArray());

  final result = await client.signAndSendTransactions(
    transactions: [txBytes],
  );

  return base58encode(result.signatures.first);
}
```

### Platform-Aware Wallet Flow

```dart
import 'dart:io';

Future<String?> connectWallet() async {
  if (Platform.isAndroid) {
    final available = await LocalAssociationScenario.isAvailable();
    if (available) {
      return await _connectViaMWA();
    }
  }
  // iOS or no MWA wallet available
  return await _connectViaBuiltInWallet();
}
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Not closing session in `finally` | Happy path works, error path leaks | Always `session.close()` in `finally` |
| Checking `isAvailable()` on iOS | MWA is Android-only | Gate with `Platform.isAndroid` first |
| Reauthorizing with wrong cluster | Switched devnet↔mainnet but kept old token | Clear saved auth when cluster changes |
| Passing unsigned tx bytes directly | Wallet expects a partially-constructed `SignedTx` format | Build `SignedTx` with placeholder signatures, serialize with `toByteArray()` |
| Ignoring `minContextSlot` | Transaction may land before the slot the blockhash was fetched in | Pass the slot from `getLatestBlockhash()` context |
| Not handling `null` from `authorize()` | User can decline at any time | Always null-check auth results |
| Using `signTransactions` but expecting wallet to submit | The two methods have different semantics | `signTransactions` = sign only. `signAndSendTransactions` = sign + submit |
| Building with wrong fee payer | Using local keypair as fee payer instead of wallet | Fee payer must be the wallet's public key from `auth.publicKey` |

## Related

- [solana-core.md](solana-core.md) — Transaction building with `Message`, `Instruction`, `SignedTx`
- [solana-mobile-wallet.md](solana-mobile-wallet.md) — Building the wallet side of MWA
- [solana-seed-vault.md](solana-seed-vault.md) — Hardware signing on Saga/Seeker
- [transaction-building.md](transaction-building.md) — Avoiding "failed to simulate transaction" errors
- [flutter-web3-security.md](flutter-web3-security.md) — Secure auth token storage
