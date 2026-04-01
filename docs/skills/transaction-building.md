# Transaction Building — Construct, Sign, Simulate & Send in Dart/Flutter

> Complete guide to building Solana transactions in Dart. Covers `Message`
> compilation (legacy + V0), signing, simulation, sending, error handling —
> with special focus on diagnosing "failed to simulate transaction" errors.

| Package | Version | Pub |
|---------|---------|-----|
| `solana` | 0.31.2+ | [pub.dev](https://pub.dev/packages/solana) |
| `coral_xyz` | latest | [pub.dev](https://pub.dev/packages/coral_xyz) |

---

## Overview

Every Solana transaction follows the same lifecycle:

1. **Build** instructions → compose into a `Message`
2. **Fetch** a recent blockhash
3. **Compile** the message (legacy or V0)
4. **Sign** with all required keypairs
5. **Simulate** (optional but recommended)
6. **Send** and confirm

The `solana` package provides low-level control at every step. `coral_xyz`
provides a fluent builder that handles the full lifecycle automatically.

---

## Quick Start

```dart
import 'package:solana/solana.dart';

Future<String> sendSol({
  required SolanaClient client,
  required Ed25519HDKeyPair sender,
  required Ed25519HDPublicKey recipient,
  required int lamports,
}) async {
  final instruction = SystemInstruction.transfer(
    fundingAccount: sender.publicKey,
    recipientAccount: recipient,
    lamports: lamports,
  );

  return client.sendAndConfirmTransaction(
    message: Message.only(instruction),
    signers: [sender],
    onSigned: ignoreOnSigned,
    commitment: Commitment.confirmed,
  );
}
```

---

## Core Types

### Message

The unsigned transaction body containing instructions:

```dart
// Multiple instructions
final message = Message(instructions: [ix1, ix2, ix3]);

// Single instruction shortcut
final message = Message.only(instruction);

// Decompile from wire format
final message = Message.decompile(compiledMessage);
```

### Compile: Legacy vs V0

```dart
// Legacy transaction
final compiled = message.compile(
  recentBlockhash: blockhash,
  feePayer: signer.publicKey,
);

// V0 (versioned) transaction — supports address lookup tables
final compiled = message.compileV0(
  recentBlockhash: blockhash,
  feePayer: signer.publicKey,
  addressLookupTableAccounts: [lookupTable],
);
```

### SignedTx

```dart
final signedTx = SignedTx(
  compiledMessage: compiled,
  signatures: signatures,
);

signedTx.encode();     // Base64 string for RPC
signedTx.id;           // First signature as base58 (txid)
signedTx.blockhash;    // Blockhash from compiled message
signedTx.version;      // 'legacy' or 0
```

### Decode Incoming Transactions

```dart
final tx = SignedTx.decode(base64String);
final tx = SignedTx.fromBytes(uint8List);
```

---

## Signing

### Helper Functions

```dart
import 'package:solana/solana.dart';

// Legacy signing
final signedTx = await signTransaction(
  latestBlockhash,  // LatestBlockhash from RPC
  message,          // Message
  [signer1, signer2],
);

// V0 signing
final signedTx = await signV0Transaction(
  recentBlockhash,
  message,
  [signer1],
  addressLookupTableAccounts: [lookupTable],
);
```

Both validate that `signers.length == requiredSignatureCount` and throw
`FormatException` on mismatch.

### Signer Order

**The first signer must be the fee payer.** Signatures must match the
order of signer accounts in the compiled message:

```dart
// Fee payer first, additional signers after
final signedTx = await signTransaction(bh, message, [feePayer, otherSigner]);
```

---

## Sending Transactions

### High-Level: sendAndConfirmTransaction

The recommended approach — handles blockhash, signing, sending, and
confirmation in one call:

```dart
final txId = await client.sendAndConfirmTransaction(
  message: message,
  signers: [wallet],
  onSigned: ignoreOnSigned,        // or (signedTx) { /* inspect */ }
  commitment: Commitment.confirmed,
);
```

Internally: `getLatestBlockhash` → compile → sign → `sendTransaction` →
`waitForSignatureStatus` via WebSocket `signatureSubscribe`.

### Mid-Level: signAndSendTransaction

Sign and send without waiting for confirmation:

```dart
final txId = await rpcClient.signAndSendTransaction(
  message,
  [signer],
  commitment: Commitment.confirmed,
);
```

### Low-Level: Manual Control

```dart
// 1. Get blockhash
final bh = await rpcClient.getLatestBlockhash(
  commitment: Commitment.confirmed,
).then((r) => r.value);

// 2. Compile + sign
final compiled = message.compile(
  recentBlockhash: bh.blockhash,
  feePayer: signer.publicKey,
);
final signatures = await Future.wait(
  [signer].map((s) => s.sign(compiled.toByteArray())),
);
final signedTx = SignedTx(
  compiledMessage: compiled,
  signatures: signatures,
);

// 3. Simulate first (optional but recommended)
final sim = await rpcClient.simulateTransaction(
  signedTx.encode(),
  commitment: Commitment.confirmed,
);
if (sim.value.err != null) {
  print('Simulation failed: ${sim.value.err}');
  print('Logs: ${sim.value.logs}');
  return;
}

// 4. Send
final txId = await rpcClient.sendTransaction(
  signedTx.encode(),
  preflightCommitment: Commitment.confirmed,
);
```

---

## Simulation

### simulateTransaction

```dart
final result = await rpcClient.simulateTransaction(
  signedTx.encode(),
  sigVerify: false,                 // Skip signature verification
  commitment: Commitment.confirmed,
  replaceRecentBlockhash: true,     // Use node's blockhash (for unsigned tx)
);

result.value.err;             // TransactionError? — null = success
result.value.logs;            // List<String> — program logs
result.value.unitsConsumed;   // int — compute units used
result.value.returnData;      // Return data from programs
```

**`sigVerify` and `replaceRecentBlockhash` are mutually exclusive** — you
cannot use both.

### coral_xyz Simulation

```dart
final result = await program.methods
    .myInstruction([arg1, arg2])
    .accounts({...})
    .simulate();

// result.logs, result.unitsConsumed, etc.
```

---

## Priority Fees (Compute Budget)

Always prepend compute budget instructions for reliable landing:

```dart
final message = Message(instructions: [
  // Priority fee instructions FIRST
  ComputeBudgetInstruction.setComputeUnitLimit(units: 200000),
  ComputeBudgetInstruction.setComputeUnitPrice(microLamports: 1000),

  // Your actual instructions
  myInstruction,
]);
```

### Compute Budget Instructions

| Instruction | Purpose |
|-------------|---------|
| `setComputeUnitLimit(units:)` | Max CU for this transaction (default 200k per ix) |
| `setComputeUnitPrice(microLamports:)` | Priority fee per CU — higher = lands faster |
| `requestHeapFrame(bytes:)` | Increase heap from 32KB (max 256KB) |
| `setLoadedAccountsDataSizeLimit(bytes:)` | Cap loaded account data |

### Priority Fee Guidelines

| Scenario | microLamports |
|----------|---------------|
| Low congestion | 1–100 |
| Normal | 1,000–10,000 |
| High demand / time-sensitive | 50,000–500,000 |
| MEV-prone swaps | 100,000–1,000,000 |

---

## "Failed to Simulate Transaction" — Diagnosis Guide

This is the most common error. It surfaces as `JsonRpcException` with
code `-32002`. The actual cause is in the `TransactionError`:

### TransactionError Values

| Error | Cause | Fix |
|-------|-------|-----|
| `programAccountNotFound` | Program not deployed on target cluster | Verify program ID exists on the RPC cluster (devnet vs mainnet) |
| `blockhashNotFound` | Blockhash expired (>~60 seconds old) | Fetch a fresh blockhash immediately before signing |
| `insufficientFundsForFee` | Fee payer has insufficient SOL | Ensure fee payer has enough SOL (0.000005+ per signature) |
| `instructionError` | Program rejected the instruction | Check logs — PDA mismatch, wrong seeds, constraint violation |
| `signatureFailure` | Wrong or missing signatures | Verify all required signers are in the signers list |
| `missingSignatureForFee` | Fee payer didn't sign | Fee payer must be first in signers list |
| `accountNotFound` | Referenced account doesn't exist | Create the account first (e.g., ATA for token transfers) |
| `alreadyProcessed` | Duplicate transaction | This tx already landed — check with `getSignatureStatuses` |

### Debugging Pattern

```dart
try {
  await client.sendAndConfirmTransaction(
    message: message,
    signers: signers,
    onSigned: ignoreOnSigned,
  );
} on JsonRpcException catch (e) {
  print('RPC error code: ${e.code}');
  print('Message: ${e.message}');
  print('Transaction error: ${e.transactionError}');
  print('Data (contains logs): ${e.data}');
  rethrow;
}
```

### Common Simulation Failure Scenarios

**1. Stale blockhash:**

```dart
// BAD — blockhash fetched too early
final bh = await rpcClient.getLatestBlockhash().then((r) => r.value);
await Future.delayed(Duration(minutes: 2));  // Blockhash expired!
final tx = await signTransaction(bh, message, [signer]);

// GOOD — fetch blockhash right before signing
final bh = await rpcClient.getLatestBlockhash().then((r) => r.value);
final tx = await signTransaction(bh, message, [signer]);
await rpcClient.sendTransaction(tx.encode());
```

**2. Wrong cluster:**

```dart
// Program deployed on devnet, client pointing to mainnet
final rpc = RpcClient('https://api.mainnet-beta.solana.com');
// → programAccountNotFound
```

**3. Missing account creation:**

```dart
// BAD — transferring to ATA that doesn't exist
await client.transferSplToken(mint: m, destination: recipient, ...);
// → NoAssociatedTokenAccountException (caught before RPC)
// or instructionError if building manually

// GOOD — create ATA first
if (!await client.hasAssociatedTokenAccount(owner: recipient, mint: m)) {
  await client.createAssociatedTokenAccount(mint: m, funder: sender, owner: recipient);
}
```

**4. Wrong signer count:**

```dart
// BAD — message requires 2 signatures but only 1 provided
final tx = await signTransaction(bh, message, [signer1]);
// → FormatException: your message requires 2 signatures but you provided 1
```

---

## Commitment Levels

```dart
enum Commitment { processed, confirmed, finalized }
```

| Level | Speed | Safety | Use when |
|-------|-------|--------|----------|
| `processed` | ~400ms | May be dropped | Never for sends (not supported by `sendAndConfirmTransaction`) |
| `confirmed` | ~5s | Supermajority voted | Default for interactive UX |
| `finalized` | ~30s | Rooted (irreversible) | Financial operations, large transfers |

**`sendTransaction` default `preflightCommitment` is `finalized`** — this
means simulation runs against finalized state. If your accounts were just
created with `confirmed` commitment, simulation may fail because the
finalized state doesn't see them yet. Fix:

```dart
await rpcClient.sendTransaction(
  tx.encode(),
  preflightCommitment: Commitment.confirmed, // Match your account creation commitment
);
```

---

## coral_xyz Transaction Methods

The `TypeSafeMethodBuilder` offers 5 terminal operations:

```dart
final builder = program.methods
    .myInstruction([arg1, arg2])
    .accounts({'account1': pubkey1, 'account2': pubkey2})
    .signers([signer]);

// 1. Get just the instruction
final ix = await builder.instruction();

// 2. Get unsigned transaction
final tx = await builder.transaction();

// 3. Sign + send + confirm (most common)
final signature = await builder.rpc();

// 4. Simulate without sending
final simResult = await builder.simulate();

// 5. Simulate + decode return data
final returnValue = await builder.view();
```

### coral_xyz Error Types

```dart
// Provider-level error
class ProviderException implements Exception { String message; }

// Transaction failed but landed (has signature + logs)
class ProviderTransactionException extends ProviderException {
  String signature;
  List<String> logs;
}

// Anchor program error (parsed from logs)
class AnchorError implements Exception {
  int errorCode;
  String program;
  List<String> logs;
}

// Generic program error
class ProgramError implements Exception {
  int code;
  String msg;
}
```

---

## Patterns & Recipes

### Retry with Fresh Blockhash

```dart
Future<String> sendWithRetry({
  required SolanaClient client,
  required Message message,
  required List<Ed25519HDKeyPair> signers,
  int maxAttempts = 3,
}) async {
  for (var i = 0; i < maxAttempts; i++) {
    try {
      return await client.sendAndConfirmTransaction(
        message: message,
        signers: signers,
        onSigned: ignoreOnSigned,
        commitment: Commitment.confirmed,
      );
    } on JsonRpcException catch (e) {
      if (e.transactionError == TransactionError.blockhashNotFound &&
          i < maxAttempts - 1) {
        continue; // Retry with fresh blockhash (sendAndConfirmTransaction fetches new one)
      }
      rethrow;
    }
  }
  throw Exception('Max retry attempts exceeded');
}
```

### Multi-Instruction Transaction

```dart
final message = Message(instructions: [
  // Priority fees
  ComputeBudgetInstruction.setComputeUnitPrice(microLamports: 5000),

  // Create ATA
  AssociatedTokenAccountInstruction.createAccount(
    funder: wallet.publicKey,
    address: ataPubKey,
    owner: recipient,
    mint: mintPubKey,
  ),

  // Transfer tokens
  TokenInstruction.transfer(
    source: senderAta,
    destination: ataPubKey,
    owner: wallet.publicKey,
    amount: 1000000,
  ),

  // Optional memo
  MemoInstruction(signers: [wallet.publicKey], memo: 'Payment'),
]);

await client.sendAndConfirmTransaction(
  message: message,
  signers: [wallet],
  onSigned: ignoreOnSigned,
);
```

### V0 Transaction with Lookup Table

```dart
final lookupTable = AddressLookupTableAccount(
  key: lookupTablePubKey,
  addresses: [addr1, addr2, addr3],
);

final signedTx = await signV0Transaction(
  recentBlockhash,
  message,
  [signer],
  addressLookupTableAccounts: [lookupTable],
);
```

---

## Common Mistakes

| # | Mistake | Fix |
|---|---------|-----|
| 1 | Caching the blockhash and reusing it across transactions | Fetch a fresh blockhash for each transaction — they expire in ~60s |
| 2 | `preflightCommitment: finalized` when accounts were created with `confirmed` | Match preflight commitment to the commitment used for account creation |
| 3 | Fee payer not first in signers list | The first signer is always the fee payer — reorder your signers list |
| 4 | Ignoring `JsonRpcException.data` — missing the actual logs | Always log `e.data` — it contains program logs explaining the failure |
| 5 | Using `skipPreflight: true` to hide simulation errors | Fix the root cause — `skipPreflight` just delays the failure to landing |
| 6 | Not adding priority fees — transactions drop during congestion | Always include `ComputeBudgetInstruction.setComputeUnitPrice` |
| 7 | Building a message with instructions for the wrong cluster | Verify program IDs exist on the target cluster (devnet/mainnet) |
| 8 | Using `sigVerify: true` with `replaceRecentBlockhash: true` | These are mutually exclusive — pick one |
| 9 | Not handling `NoAssociatedTokenAccountException` before sending | Check and create ATAs before building token transfer instructions |
| 10 | Sending duplicate transactions — gets `alreadyProcessed` | Check `getSignatureStatuses` before retrying a transaction |

---

## Related

- [solana-core.md](solana-core.md) — RPC client, keypairs, program IDs
- [coral-xyz.md](coral-xyz.md) — Anchor TypeSafeMethodBuilder (.rpc/.transaction/.simulate)
- [spl-token.md](spl-token.md) — token instructions for multi-instruction transactions
- [jupiter-aggregator.md](jupiter-aggregator.md) — swap transactions that need priority fees
