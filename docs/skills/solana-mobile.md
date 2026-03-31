# Solana Mobile Stack — Flutter Integration

> Build Flutter apps that leverage Solana Saga/Seeker hardware wallets, Seed Vault secure signing, and Mobile Wallet Adapter (MWA).

## Overview

The Solana Mobile Stack (SMS) provides three key pieces for mobile Flutter developers:

1. **Mobile Wallet Adapter (MWA)** — A protocol for dApps to request wallet signing from any compatible mobile wallet
2. **Seed Vault** — Hardware-level key storage on Saga/Seeker devices (separate secure processor)
3. **dApp Store** — Alternative app distribution for crypto apps (bypass App Store crypto restrictions)

The `solana_mobile_client` package wraps the Android SMS libraries for Flutter.

> **CRITICAL**: SMS is Android-only. There is no iOS equivalent (Apple doesn't allow third-party secure elements). Your app must gracefully degrade on iOS — show a "Connect Wallet" flow using WalletConnect or deep links instead of MWA.

## Quick Start

```yaml
dependencies:
  solana_mobile_client: ^0.3.0
  solana: ^0.31.0

# Android minimum SDK must be 23+
# In android/app/build.gradle:
# minSdkVersion 23
```

```dart
import 'package:solana_mobile_client/solana_mobile_client.dart';

// Check if MWA is available on this device
final isAvailable = await LocalAssociationScenario.isAvailable();

if (!isAvailable) {
  // Fall back to embedded wallet or WalletConnect
  return;
}

// Start a session with the wallet
final scenario = LocalAssociationScenario(port: 0);
await scenario.start();

// Authorize your dApp
final authResult = await scenario.authorize(
  identityUri: Uri.parse('https://yourdapp.com'),
  identityName: 'My dApp',
  cluster: 'devnet',
);

final walletAddress = authResult.publicKey; // User's wallet pubkey
final authToken = authResult.authToken;      // Reuse for future sessions
```

## Core Concepts

### Mobile Wallet Adapter (MWA) Flow

The MWA protocol works like this:

1. Your dApp opens a local socket connection to the wallet app
2. You request authorization (user approves in their wallet)
3. You send transactions for signing (user approves each one)
4. The wallet returns signed transactions
5. Your dApp submits them to the network

```
┌──────────┐    Local TCP    ┌──────────────┐
│ Your dApp │ ──────────────→│ Wallet App    │
│ (Flutter) │    :port       │ (Phantom etc.)│
│           │ ←──────────────│               │
│  Send tx  │  Signed tx     │  User approves│
└──────────┘                 └──────────────┘
```

> **WHY THIS MATTERS**: Unlike browser wallets (which inject a JS object), mobile wallets are separate apps. MWA uses a local TCP connection — no internet required for the dApp↔wallet communication. This is more secure than deep links.

### Signing Transactions

```dart
// Build your transaction using the solana package
final instruction = SystemInstruction.transfer(
  fundingAccount: Ed25519HDPublicKey(authResult.publicKey),
  recipientAccount: recipientAddress,
  lamports: 100000000, // 0.1 SOL
);

final message = Message(instructions: [instruction]);
final blockhash = await client.getRecentBlockhash();

// Serialize the transaction for MWA signing
final transaction = Transaction(
  message: message,
  recentBlockhash: blockhash.value.blockhash,
);

final serializedTx = transaction.serialize();

// Request the wallet to sign
final signResult = await scenario.signTransactions(
  transactions: [serializedTx],
);

// Send the signed transaction
final signature = await client.sendRawTransaction(signResult.signedPayloads.first);
```

### Seed Vault Integration

On Saga/Seeker devices, the Seed Vault provides hardware-level key storage:

```dart
// Check if Seed Vault is available
final hasSeedVault = await SeedVault.isAvailable();

if (hasSeedVault) {
  // The wallet app handles Seed Vault interaction
  // Your dApp doesn't talk to Seed Vault directly —
  // it goes through MWA, and the wallet uses Seed Vault internally
  
  // For custom Seed Vault integrations:
  final seeds = await SeedVault.getAuthorizedSeeds();
  // seeds contain the public keys for signing
}
```

> **GOTCHA**: Your dApp typically doesn't need direct Seed Vault access. The MWA wallet (like Solflare) already uses Seed Vault for key management. Direct Seed Vault access is for when you're building a WALLET app, not a dApp.

### Platform-Aware UX

```dart
import 'dart:io';

class WalletConnectionService {
  Future<WalletConnection> connect() async {
    if (Platform.isAndroid) {
      final isAvailable = await LocalAssociationScenario.isAvailable();
      if (isAvailable) {
        return _connectViaMWA();
      }
    }
    
    // iOS or Android without MWA-compatible wallet
    return _connectViaWalletConnect();
  }
  
  Future<WalletConnection> _connectViaMWA() async {
    final scenario = LocalAssociationScenario(port: 0);
    await scenario.start();
    final auth = await scenario.authorize(
      identityUri: Uri.parse('https://yourdapp.com'),
      identityName: 'My dApp',
      cluster: 'mainnet-beta',
    );
    return MWAConnection(scenario: scenario, auth: auth);
  }
  
  Future<WalletConnection> _connectViaWalletConnect() async {
    // WalletConnect V2 implementation
    // ...
  }
}
```

### Session Management

MWA sessions should be properly managed:

```dart
class MWASessionManager {
  LocalAssociationScenario? _scenario;
  String? _authToken;
  
  Future<void> startSession() async {
    _scenario = LocalAssociationScenario(port: 0);
    await _scenario!.start();
  }
  
  Future<void> authorize() async {
    final result = await _scenario!.authorize(
      identityUri: Uri.parse('https://yourdapp.com'),
      identityName: 'My dApp',
      cluster: 'devnet',
    );
    _authToken = result.authToken;
  }
  
  Future<void> reauthorize() async {
    // Use saved auth token for faster reconnection
    if (_authToken != null) {
      await _scenario!.reauthorize(authToken: _authToken!);
    }
  }
  
  Future<void> endSession() async {
    await _scenario?.close();
    _scenario = null;
  }
}
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| No iOS fallback | Assuming MWA works everywhere | Check platform, provide WalletConnect/deep link alternative |
| Not closing MWA sessions | Leaks TCP connections | Always `scenario.close()` in dispose/cleanup |
| Using wrong cluster in authorize | Devnet auth ≠ mainnet auth | Match the cluster to your RPC endpoint |
| Forgetting Android minSdk 23 | SMS requires API 23+ | Set in `android/app/build.gradle` |
| Sending unsigned transactions | MWA returns signed txs, not signatures | Use `sendRawTransaction` with the signed bytes |

## dApp Store Submission

For distributing through Solana's dApp Store:

1. Build your release APK/AAB
2. Register at [dApp Store](https://dappstore.app/)
3. Submit with a Solana wallet for publisher verification
4. Follows standard review process (less restrictive than Play Store for crypto apps)

## Related

- [Solana Package Deep Dive](./solana-package.md) — Building the transactions that MWA signs
- [Wallet UX Patterns](./wallet-ux.md) — Designing connection flows for all platforms

---

*Package: [solana_mobile_client on pub.dev](https://pub.dev/packages/solana_mobile_client)*
