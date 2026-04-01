# Mobile Integration Patterns

> How a production Flutter app wires up `light_sdk`, handles external wallet signing, tracks transaction progress, manages compressed state alongside regular SPL state, and recovers from the indexer lag that every ZK compression app has to deal with.

## Overview

Everything in the previous guides is abstract until you put it inside a Flutter app with real users. This page uses patterns from **Fleeker**, a production Flutter app that converts tweets into ZK-compressed collectibles on Solana.

Fleeker's compression features:
- Compress SPL tokens (USDC, SOL, any SPL mint) into Light tokens
- Transfer compressed tokens to Twitter @handles or wallet addresses
- Decompress tokens back to SPL
- Display both SPL and compressed token balances in one wallet view
- Show transaction history that includes compression events parsed from memos

The integration challenges are not about calling `compress()`. They are about:
- Signing with a Privy embedded wallet instead of a local keypair
- Showing progress for multi-step operations (fetch → prove → sign → send → confirm)
- Refreshing state after transactions when the indexer is 1-3 seconds behind
- Resolving recipients from Twitter handles to wallet addresses
- Handling the ATA creation that decompression sometimes requires

## Quick Start

```dart
import 'package:light_sdk/light_sdk.dart';
import 'package:solana/solana.dart';

class LightProtocolService {
  static late Rpc _rpc;

  static void initialize(String heliusApiKey) {
    _rpc = Rpc.create(
      'https://mainnet.helius-rpc.com?api-key=$heliusApiKey',
    );
  }

  /// Compress SPL tokens into Light tokens.
  static Future<String> compressToken({
    required String mint,
    required BigInt amount,
    required String sourceTokenAccount,
  }) async {
    final treeInfos = await _rpc.getStateTreeInfos();
    final treeInfo = selectStateTreeInfo(treeInfos);

    final ix = CompressedTokenProgram.compress(
      payer: walletPubkey,
      owner: walletPubkey,
      source: Ed25519HDPublicKey.fromBase58(sourceTokenAccount),
      mint: Ed25519HDPublicKey.fromBase58(mint),
      amount: amount,
      outputStateTreeInfo: treeInfo,
      tokenPoolInfo: await _getTokenPoolInfo(mint),
    );

    return _signAndSend([ix], computeUnits: 1000000);
  }
}
```

That is the shape. The rest of this page explains every decision in detail.

## Core Concepts

### The Signing Problem: Why Actions Don't Work in Production

The SDK's action functions (`compress()`, `transfer()`, `decompress()`) take an `Ed25519HDKeyPair` as the signer. This works for testing:

```dart
// Testing: keypair in memory, signs synchronously
final wallet = await Ed25519HDKeyPair.random();
await compress(rpc: rpc, payer: wallet, lamports: amount, toAddress: wallet.publicKey);
```

In a production Flutter app, the signer is not a local keypair. It is an **external wallet** — Privy, Phantom, Solflare, Saga Seed Vault — that signs asynchronously through a native bridge.

```dart
// Production: Privy embedded wallet, signs through native FFI
class PrivyExternalSigner {
  final EmbeddedSolanaWallet _embeddedWallet;

  Future<Uint8List> sign(Uint8List message) async {
    final messageBase64 = base64Encode(message);
    final result = await _embeddedWallet.provider.signMessage(messageBase64);
    return base64Decode(result.signature);
  }
}
```

This means you cannot use the convenience action functions. Instead, you use the mid-level API:

1. Build the instruction with `LightSystemProgram.compress()` or `CompressedTokenProgram.transfer()`
2. Assemble the transaction manually
3. Sign with your wallet provider
4. Send and confirm separately

This is the #1 architectural difference between SDK examples and production code. Every real Flutter app needs this pattern.

### The Service Layer Pattern

Fleeker's `LightProtocolService` is a static service class that wraps all compression operations. This pattern keeps compression logic in one place and separates it from UI/state management.

```dart
class LightProtocolService {
  static late Rpc _rpc;
  static late Ed25519HDPublicKey _walletPubkey;

  static void initialize({
    required String heliusApiKey,
    required String walletAddress,
  }) {
    _rpc = Rpc.create('https://mainnet.helius-rpc.com?api-key=$heliusApiKey');
    _walletPubkey = Ed25519HDPublicKey.fromBase58(walletAddress);
  }

  // All operations are static methods that use _rpc and _walletPubkey
}
```

The service does not hold wallet signing capabilities. It builds instructions and returns the bytes that need signing. The calling code handles signing through whatever wallet provider the app uses.

### Progress Tracking for Multi-Step Operations

A compressed token transfer has five distinct phases. In a mobile app, the user needs to see which phase they are in — especially because the proving step can take 2-5 seconds.

```dart
enum TransferStep {
  preparing,    // Fetching accounts, selecting inputs
  proving,      // Getting validity proof from prover
  signing,      // Waiting for wallet signature
  sending,      // Submitting transaction to Solana
  confirming,   // Waiting for confirmation
}

static Future<String> transferCompressedToken({
  required String mint,
  required BigInt amount,
  required String recipientAddress,
  void Function(TransferStep step)? onProgress,
}) async {
  onProgress?.call(TransferStep.preparing);

  // Fetch and select accounts
  final tokenAccounts = await _rpc.getCompressedTokenAccountsByOwner(
    _walletPubkey,
    mint: Ed25519HDPublicKey.fromBase58(mint),
  );
  final (selected, _) = selectMinCompressedTokenAccountsForTransfer(
    tokenAccounts.items,
    amount,
    (a) => a.parsed.amount,
  );

  onProgress?.call(TransferStep.proving);

  // Get validity proof
  final hashes = selected.map((a) => a.compressedAccount.hash).toList();
  final proof = await _rpc.getValidityProof(hashes: hashes);

  onProgress?.call(TransferStep.signing);

  // Build instruction
  final ix = CompressedTokenProgram.transfer(
    payer: _walletPubkey,
    inputCompressedTokenAccounts: selected,
    toAddress: Ed25519HDPublicKey.fromBase58(recipientAddress),
    amount: amount,
    recentInputStateRootIndices: proof.rootIndices,
    recentValidityProof: proof.compressedProof,
  );

  // Sign with external wallet
  final signedTx = await _buildAndSignWithExternalWallet([ix], computeUnits: 600000);

  onProgress?.call(TransferStep.sending);

  final signature = await _rpc.rpcClient.sendTransaction(signedTx);

  onProgress?.call(TransferStep.confirming);

  await _rpc.rpcClient.confirmTransaction(signature);
  return signature;
}
```

The UI hooks into these callbacks to show a loading sheet that progresses from "Preparing..." to "Getting proof..." to "Signing..." to "Sending..." to "Confirming...". Each phase is long enough that the user should see it.

> **WHY THIS MATTERS**: Without progress tracking, the user sees a spinner for 5-10 seconds with no feedback. That feels broken. With progress tracking, each phase takes 1-3 seconds and the user knows the operation is moving forward. This is a UX requirement, not a nice-to-have.

### Post-Transaction Refresh: Dealing with Indexer Lag

After compressing or transferring tokens, the indexer (Photon) needs time to process the transaction events and update its database. If you immediately query `getCompressedTokenAccountsByOwner()`, you might get stale data — the old accounts before the transaction.

Fleeker handles this with retry-based refresh:

```dart
Future<void> refreshAfterTransaction({int retries = 3}) async {
  for (var i = 0; i < retries; i++) {
    await Future.delayed(Duration(seconds: 2 + i)); // 2s, 3s, 4s

    final tokenAccounts = await _rpc.getCompressedTokenAccountsByOwner(
      _walletPubkey,
    );

    // Check if the state has actually changed
    if (_stateHasChanged(tokenAccounts)) {
      _updateDisplayedBalances(tokenAccounts);
      return;
    }
  }

  // If all retries exhausted, show last known state with a "refreshing" indicator
  _showRefreshingIndicator();
}
```

The escalating delays (2s, 3s, 4s) are based on empirical observation: Photon typically processes events within 2-4 seconds of transaction confirmation. Three retries with increasing delays catches 99%+ of cases.

> **GOTCHA**: Do not use `await Future.delayed(Duration(milliseconds: 500))` and retry immediately. The indexer genuinely needs 1-3 seconds. Hammering it with rapid retries wastes RPC calls and does not help.

### Wallet State Management: Unified Balances

A wallet in a compression-enabled app shows two kinds of assets:

```dart
class WalletState {
  final double solBalance;             // Regular SOL
  final double compressedSolBalance;   // Compressed SOL
  final List<TokenInfo> tokens;        // SPL token accounts
  final List<TokenInfo> lightTokens;   // Compressed token accounts
  final List<TransactionRecord> transactions;
}
```

The challenge is loading both types of data efficiently. Fleeker uses a three-phase progressive loading pattern:

**Phase 1 (instant)**: Fetch SOL balances from both sources in parallel.

```dart
final [solBalance, compressedBalance] = await Future.wait([
  rpc.rpcClient.getBalance(walletPubkey),
  rpc.getCompressedBalanceByOwner(walletPubkey),
]);
```

**Phase 2 (1-3 seconds)**: Fetch SPL tokens and compressed tokens, enrich with metadata.

```dart
final [splTokens, compressedTokens] = await Future.wait([
  HeliusRpcService.getTokenAccounts(walletAddress),
  rpc.getCompressedTokenAccountsByOwner(walletPubkey),
]);

// Enrich with metadata (name, symbol, logo) in batches of 10
for (final batch in splTokens.chunked(10)) {
  final metadatas = await Future.wait(
    batch.map((t) => HeliusRpcService.getTokenMetadata(t.mint)),
  );
  // Merge metadata into token info objects
}
```

**Phase 3 (2-5 seconds)**: Fetch transaction history.

```dart
final transactions = await HeliusRpcService.getTransactionHistory(
  walletAddress,
  limit: 50,
);
```

Each phase updates the UI as it completes. The user sees SOL balance immediately, tokens within seconds, and history shortly after. This progressive disclosure prevents the wallet from feeling slow.

### Sending Compressed Tokens to Twitter Handles

Fleeker's defining feature is sending Light tokens to Twitter @handles. When the recipient is not already a Fleeker user, the app creates a *pre-generated wallet* for them server-side.

The flow:

```dart
// 1. Resolve the Twitter handle to a wallet address
final wallet = await PrivyApiService.getOrCreateWalletForTwitterUser(
  twitterUsername: 'vitalikbuterin',
);

// wallet.address is now a real Solana address, either:
// - The existing user's embedded wallet (if they already use Fleeker)
// - A pre-generated wallet created by Privy's REST API (if they don't)

// 2. Transfer compressed tokens to that address
await LightProtocolService.transferCompressedToken(
  mint: usdcMint,
  amount: BigInt.from(5000000), // 5 USDC
  recipientAddress: wallet.address,
  senderHandle: '@myhandle',
  recipientHandle: '@vitalikbuterin',
  onProgress: (step) => updateUI(step),
);
```

When the non-Fleeker user signs up later and authenticates with the same Twitter account, Privy automatically links them to the pre-generated wallet, and they can access the compressed tokens immediately.

### Memo-Based Transaction Tracking

To display "Fleeked from @alice" in the transaction history, Fleeker embeds a memo in every transfer:

```dart
final memoInstruction = MemoInstruction(
  signers: [walletPubkey],
  memo: 'fleeker:from:@$senderHandle:to:@$recipientHandle',
);

final instructions = [
  computeBudgetIx,
  compressedTransferIx,
  memoInstruction,
];
```

When parsing transaction history, the app detects these memos:

```dart
TransactionRecord parseTransaction(ParsedTransaction tx) {
  final memo = tx.memoData;
  if (memo != null && memo.startsWith('fleeker:')) {
    final parts = memo.split(':');
    return TransactionRecord(
      senderHandle: parts[2],     // @alice
      recipientHandle: parts[4],  // @bob
      isFleek: true,
    );
  }
  // Fallback to standard parsing
}
```

The Memo Program (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) logs the memo in the transaction, making it queryable through the standard `getTransaction()` RPC call. This works because the memo is a regular Solana instruction in the same transaction as the compressed transfer.

### The ATA Problem: Decompressing Tokens

Decompressing tokens requires an SPL Associated Token Account (ATA) on the receiving end. If the ATA does not exist, the decompression fails.

Fleeker handles this in the service layer:

```dart
static Future<String> decompressTokenToAta({
  required String mint,
  required BigInt amount,
}) async {
  final mintPubkey = Ed25519HDPublicKey.fromBase58(mint);

  // Derive the ATA address
  final ata = await findAssociatedTokenAddress(
    owner: _walletPubkey,
    mint: mintPubkey,
  );

  // Check if ATA exists
  final ataInfo = await _rpc.rpcClient.getAccountInfo(ata);

  final instructions = <Instruction>[];

  // Create ATA if it doesn't exist
  if (ataInfo == null) {
    instructions.add(
      createAssociatedTokenAccountInstruction(
        funder: _walletPubkey,
        associatedToken: ata,
        owner: _walletPubkey,
        mint: mintPubkey,
      ),
    );
  }

  // Build decompress instruction
  final selected = await _selectTokenAccounts(mint, amount);
  final proof = await _rpc.getValidityProof(
    hashes: selected.map((a) => a.compressedAccount.hash).toList(),
  );

  instructions.add(
    CompressedTokenProgram.decompress(
      payer: _walletPubkey,
      inputCompressedTokenAccounts: selected,
      toAddress: ata,
      amount: amount,
      recentInputStateRootIndices: proof.rootIndices,
      recentValidityProof: proof.compressedProof,
      tokenPoolInfo: await _getTokenPoolInfo(mint),
    ),
  );

  return _signAndSend(instructions, computeUnits: 1000000);
}
```

The ATA creation and token decompression happen in the same transaction. If the ATA already exists, only the decompress instruction is included. This pattern avoids a separate "ensure ATA" transaction and saves the user one signature.

> **CRITICAL**: If you decompress tokens to a wallet address (not an ATA), the transaction will fail silently or the tokens will be lost. Always derive the ATA and pass that as the `toAddress`.

### Decimal Handling

SPL tokens have variable decimals (USDC = 6, SOL = 9, some tokens = 0). The conversion between UI amounts and on-chain amounts must be exact:

```dart
// UI → on-chain
BigInt uiToOnChain(double uiAmount, int decimals) {
  return BigInt.from((uiAmount * pow(10, decimals)).round());
}

// On-chain → UI
double onChainToUi(BigInt onChainAmount, int decimals) {
  return onChainAmount.toDouble() / pow(10, decimals);
}

// Example: 100.5 USDC (6 decimals)
final onChain = uiToOnChain(100.5, 6);  // BigInt.from(100500000)
final ui = onChainToUi(BigInt.from(100500000), 6);  // 100.5
```

Use `BigInt` for all on-chain amounts. Never use `double` for intermediate calculations — floating point precision errors will cause transaction failures when the amount does not match what the compressed account actually holds.

### Token Pool Availability

Before compressing a token, check that its pool exists:

```dart
static Future<bool> isTokenPoolAvailable(String mint) async {
  final poolPda = await CompressedTokenProgram.deriveTokenPoolPda(
    mint: Ed25519HDPublicKey.fromBase58(mint),
  );
  final accountInfo = await _rpc.rpcClient.getAccountInfo(poolPda);
  return accountInfo != null;
}
```

If the pool does not exist, show the user an appropriate message. On mainnet, USDC and major tokens have pools. Custom or new tokens may not.

## Patterns & Recipes

### Pattern: Batch Metadata Enrichment

When displaying compressed token balances, you need token metadata (name, symbol, logo). Fetching metadata one at a time is slow:

```dart
// Slow: sequential metadata fetches
for (final token in compressedTokens) {
  final metadata = await getTokenMetadata(token.mint); // 200ms each
}

// Fast: parallel batches of 10
for (final batch in compressedTokens.chunked(10)) {
  final metadatas = await Future.wait(
    batch.map((t) => getTokenMetadata(t.mint)),
  );
}
```

### Pattern: Highlight Recent Transactions

After a compress/decompress/transfer, highlight the affected token in the wallet UI:

```dart
// After successful compress
state = state.copyWith(
  highlightedMint: mint,
  highlightedTab: WalletTab.lightTokens,
);

// UI: show a glow/pulse animation on the highlighted token for 3 seconds
```

This provides immediate visual feedback while the indexer catches up. The user sees "your USDC moved to the Light Tokens tab" before the balance numbers update.

### Pattern: Multi-Recipient Transfers

Fleeker supports sending to multiple @handles at once. The amount is divided equally:

```dart
static Future<List<String>> transferToMultipleRecipients({
  required String mint,
  required BigInt totalAmount,
  required List<String> recipientAddresses,
}) async {
  final perRecipient = totalAmount ~/ BigInt.from(recipientAddresses.length);
  final signatures = <String>[];

  for (final address in recipientAddresses) {
    final sig = await transferCompressedToken(
      mint: mint,
      amount: perRecipient,
      recipientAddress: address,
    );
    signatures.add(sig);
  }

  return signatures;
}
```

These transfers happen sequentially because each one consumes compressed accounts that the next one might need to re-discover. Parallel transfers would race on account selection and cause proof failures.

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Using SDK action functions with Privy wallet | Action functions require `Ed25519HDKeyPair` | Build instructions with program builders, sign with Privy separately |
| Refreshing state immediately after transaction | Indexer needs 1-3 seconds to catch up | Use retry loop with escalating delays (2s, 3s, 4s) |
| Decompressing tokens to wallet address | Must go to ATA address | Derive ATA with `findAssociatedTokenAddress()`, create if needed |
| Showing stale balance after compress | Old SPL balance still cached | Clear token cache on successful compress, re-fetch both SPL and compressed |
| Using `double` for token amounts | Floating point precision loss | Use `BigInt` throughout, only convert to `double` for display |
| Sending parallel transfers to different recipients | They race on account selection | Send sequentially — each transfer changes account state |

## Related

- [RPC, Actions, and Transactions](rpc-actions-and-transactions.md) — The underlying SDK calls this pattern uses
- [SDK Architecture](sdk-architecture.md) — Why the SDK is split into layers that support this pattern
- [`solana` package guide](../solana-package.md) — Base Solana types used throughout
- [Wallet UX guide](../wallet-ux.md) — General Solana wallet patterns for Flutter
