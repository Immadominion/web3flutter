# Wallet Integration — Signing Abstractions and UX Patterns

> How to design a signing layer that works across embedded wallets, MWA, Seed Vault, and WalletConnect — without your UI knowing the difference.

## Overview

Every Solana Flutter app needs to sign transactions. The signing source varies wildly: an `Ed25519HDKeyPair` held in memory, MWA to Phantom on Android, the Seed Vault on Saga, or WalletConnect on iOS. Your UI should never care which one is active.

This guide covers three layers:

1. **The abstraction** — how to structure a signing interface that all backends implement
2. **The backends** — how each signing method works (embedded, MWA, Seed Vault)
3. **The UX** — what users need to see and when

---

## Core Concepts

### The Signing Abstraction

The `solana` package defines the signing interface as `Ed25519HDKeyPair`. But MWA and Seed Vault don't expose private keys — they return signed bytes. Your signing layer needs to abstract over both patterns:

```dart
/// Your app's signing abstraction
abstract class WalletSigner {
  Ed25519HDPublicKey get publicKey;
  Future<SignedTx> sign(Message message, String recentBlockhash);
}

/// Embedded wallet — direct access to the keypair
class KeypairSigner implements WalletSigner {
  final Ed25519HDKeyPair _keypair;
  KeypairSigner(this._keypair);

  @override
  Ed25519HDPublicKey get publicKey => _keypair.publicKey;

  @override
  Future<SignedTx> sign(Message message, String recentBlockhash) =>
      _keypair.signMessage(message: message, recentBlockhash: recentBlockhash);
}

/// MWA wallet — signs via another app on the device
class MwaSigner implements WalletSigner {
  final Ed25519HDPublicKey _publicKey;
  final String _authToken;
  MwaSigner(this._publicKey, this._authToken);

  @override
  Ed25519HDPublicKey get publicKey => _publicKey;

  @override
  Future<SignedTx> sign(Message message, String recentBlockhash) async {
    final compiled = message.compile(
      recentBlockhash: recentBlockhash,
      feePayer: _publicKey,
    );
    final txBytes = compiled.toByteArray().toList();

    final scenario = await LocalAssociationScenario.create();
    final client = await scenario.start();
    try {
      await client.reauthorize(authToken: _authToken);
      final result = await client.signTransactions(
        transactions: [Uint8List.fromList(txBytes)],
      );
      return SignedTx(
        signatures: result.signedPayloads.first,
        messageBytes: compiled.toByteArray(),
      );
    } finally {
      await scenario.close();
    }
  }
}
```

> **WHY THIS MATTERS**: Without this abstraction, wallet-switching logic leaks into every screen that sends a transaction. With it, your `SendTokenScreen` calls `signer.sign(message, blockhash)` and doesn't know (or care) whether the key lives in memory, in another app, or in hardware.

### Three Wallet Patterns

**1. Embedded Wallet** — create an `Ed25519HDKeyPair` on first launch. User doesn't know they have a wallet. Seed phrase backup prompted later.

- Best for: payments, games, social apps
- Risk: user never backs up → loses access on device change

**2. External Wallet** — connect to Phantom/Solflare via MWA (Android) or deep links (iOS).

- Best for: DeFi, marketplaces — users with existing wallets
- Risk: app-switching fatigue, wallet not installed, connection failures

**3. Hybrid** — embedded by default, external wallet optional. Casual users stay embedded, power users connect Phantom.

### Platform-Specific Flow

```
                  ┌─ Android ─┐
                  │            │
 User taps  ─────┤  Saga? ────┼── Yes → Seed Vault signing
 "Sign"           │            │
                  │  No ───────┼── MWA available? ─── Yes → MWA to Phantom
                  │            │                └──── No  → Embedded keypair
                  └────────────┘
                  ┌── iOS ────┐
                  │            │
                  │ WalletConnect or deep links ──── External wallet
                  │ OR embedded keypair ──────────── No app-switching
                  └────────────┘
```

---

## Patterns & Recipes

### Auto-Retry with Fresh Blockhash

Blockhashes expire after ~60 seconds. If the user takes too long to approve in the wallet app, the transaction dies. Handle this transparently:

```dart
Future<String> sendWithRetry({
  required WalletSigner signer,
  required SolanaClient client,
  required Message message,
  int maxAttempts = 3,
}) async {
  for (var i = 0; i < maxAttempts; i++) {
    final blockhash = await client.rpcClient.getLatestBlockhash();
    final signed = await signer.sign(message, blockhash.value.blockhash);
    try {
      return await client.rpcClient.sendTransaction(signed.encode());
    } on JsonRpcException catch (e) {
      if (e.code == -32002 && i < maxAttempts - 1) continue; // BlockhashNotFound
      rethrow;
    }
  }
  throw Exception('Transaction failed after $maxAttempts attempts');
}
```

### Optimistic UI with Rollback

Solana confirms fast (~400ms), but blockhash fetch + simulation + RPC latency add up. Use optimistic updates:

```dart
// 1. Update UI immediately after signing
setState(() => balance -= amount); // optimistic

// 2. Send and wait for confirmation
try {
  final sig = await client.sendAndConfirmTransaction(
    message: message,
    signers: [keypair],
    commitment: Commitment.confirmed,
  );
  // 3a. Confirmed — UI is already correct
} catch (e) {
  // 3b. Failed — roll back
  setState(() => balance += amount);
  showError('Transaction failed. Your balance has been restored.');
}
```

### MWA Session Batching

Every MWA `start()` → `close()` cycle switches the user to the wallet app. If your flow needs multiple operations, batch them:

```dart
// BAD — two app switches
await signAndSend(createAtaInstruction);
await signAndSend(transferInstruction);

// GOOD — one app switch
final message = Message(instructions: [
  createAtaInstruction,
  transferInstruction,
]);
await signAndSend(message);
```

> **GOTCHA**: If you're using `signAndSendTransactions`, the wallet submits for you — you don't control the RPC endpoint or retry logic. For complex flows where you need control over submission, use `signTransactions` and submit yourself.

### Seed Vault Detection

```dart
Future<WalletSigner> resolveWalletSigner() async {
  // Try Seed Vault first (hardware security > software)
  if (Platform.isAndroid) {
    final vaultAvailable = await SeedVault.instance.isAvailable();
    if (vaultAvailable) {
      final authToken = await SeedVault.instance.authorizeSeed(
        Purpose.signSolanaTransaction,
      );
      final keys = await SeedVault.instance.requestPublicKeys(
        authToken: authToken,
        derivationPaths: [solanaMainPath],
      );
      return SeedVaultSigner(authToken, keys.first.publicKey!);
    }

    // Try MWA
    final mwaAvailable = await LocalAssociationScenario.isAvailable();
    if (mwaAvailable) {
      return MwaSigner(/* from prior authorization */);
    }
  }

  // Fallback: embedded keypair
  return KeypairSigner(await Ed25519HDKeyPair.fromMnemonic(mnemonic));
}
```

---

## Transaction Approval UX

### What to Show

| Element | Example | Why |
|---------|---------|-----|
| Action summary | "Swap 1 SOL → 142.5 USDC" | Users approve actions, not hashes |
| Network fee | "Fee: ~0.000005 SOL ($0.001)" | No surprise costs |
| Priority fee | "Priority: 0.0001 SOL (for faster confirm)" | Explain the extra cost |
| Warnings | "First interaction with this program" | Flag unfamiliar programs |
| Progress states | Sent → Confirmed → Finalized | Don't just show a spinner |

### Error Messages

| Internal Error | User Message |
|---------------|-------------|
| `InsufficientFunds` | "Not enough SOL. You need 0.01 more for fees." |
| `BlockhashNotFound` | "Transaction expired. Retrying..." (auto-retry) |
| `SignatureVerificationFailed` | "Transaction failed. Please try again." |
| Network timeout | "Can't reach the network. Check your connection." |
| MWA `null` authorization | "Wallet connection declined. Try again?" |
| Seed Vault auth failed | "Hardware authentication failed." |

Never show raw JSON-RPC error codes to users. Log them for debugging, translate for the UI.

---

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Signing logic in UI widgets | No abstraction layer | Create `WalletSigner` interface, inject the right implementation |
| No iOS fallback | Tested only on Android with MWA | Always check `Platform.isAndroid` before MWA/Seed Vault calls |
| Blocking UI during signing | Synchronous approach to async signing | Use `FutureBuilder` or state management, show progress |
| User loses funds on device switch | Embedded wallet with no backup prompt | Prompt backup within first 3 transactions, block large deposits until backed up |
| MWA session left open | Missing `finally` block | Always `scenario.close()` in `finally` |
| Stale balance after transaction | Not refreshing after confirmation | Re-fetch balance after `sendAndConfirmTransaction` completes |

---

## Related

- [Solana Mobile](solana-mobile) — MWA and Seed Vault package details
- [The solana Package](solana-package) — `Ed25519HDKeyPair`, `SolanaClient`, transaction building
- [Token Operations](token-ops) — What most wallet interactions actually do
