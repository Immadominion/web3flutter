# SDK Architecture

> How `light_sdk` maps ZK compression concepts into Dart types, why the package has six modules instead of one, and what actually happens when you call an action function.

## Overview

`light_sdk` is not one big client class. It is a layered package with six module groups, each responsible for a different part of the compression workflow:

- **State** — Data types that represent compressed accounts, proofs, and trees
- **RPC** — The Photon API client for querying and proving
- **Programs** — Instruction builders for the Light System Program and Compressed Token Program
- **Actions** — High-level functions that orchestrate entire operations (compress, transfer, decompress)
- **Utils** — Address derivation, account selection, Borsh encoding, transaction helpers
- **Constants** — Program IDs, discriminators, fee values

The layering is intentional. Each layer only imports from the layers below it. Actions import Programs and RPC. Programs import State and Utils. State imports nothing from the SDK. This means you can use the instruction builders without the high-level actions, or the types without the RPC client.

## Quick Start

```dart
import 'package:light_sdk/light_sdk.dart';

// The barrel import gives you everything.
// But the actual code lives in these modules:
//   light_sdk/src/state/     → BN254, CompressedAccount, TreeInfo, ValidityProof
//   light_sdk/src/rpc/       → Rpc, compression API methods
//   light_sdk/src/programs/  → LightSystemProgram, CompressedTokenProgram
//   light_sdk/src/actions/   → compress(), transfer(), decompress()
//   light_sdk/src/utils/     → address derivation, account selection, Borsh
//   light_sdk/src/constants/ → program IDs, discriminators

// High-level: one call does everything
final sig = await compress(rpc: rpc, payer: wallet, lamports: amount, toAddress: wallet.publicKey);

// Mid-level: build instructions yourself
final ix = LightSystemProgram.compress(payer: pubkey, toAddress: pubkey, lamports: amount, outputStateTreeInfo: tree);

// Low-level: pack accounts and encode data manually
final packed = packCompressedAccounts(inputCompressedAccounts: [...], ...);
final data = InstructionDataInvoke(proof: ..., ...).encode();
```

Those three levels exist because different use cases need different amounts of control.

## Core Concepts

### The Module Graph

Here is what imports what, and why:

```
┌──────────────────────────────────────────────────────────────┐
│                        actions/                               │
│  compress.dart, transfer.dart, decompress.dart                │
│  Orchestrates: RPC queries → proof fetching → instruction     │
│  building → signing → sending                                 │
├──────────────────────────────────────────────────────────────┤
│                        programs/                              │
│  light_system_program.dart, compressed_token_program.dart     │
│  Builds Instruction objects with packed accounts and          │
│  Borsh-encoded data                                           │
├──────────────────────────────────────────────────────────────┤
│              rpc/                    │     utils/              │
│  Rpc, compression_api, rpc_types    │  address, borsh, pack,  │
│  HTTP calls to Photon + prover      │  account_selection,     │
│                                     │  transaction_utils      │
├──────────────────────────────────────────────────────────────┤
│                        state/                                 │
│  bn254.dart, compressed_account.dart, tree_info.dart,         │
│  validity_proof.dart, token_data.dart, merkle_context.dart    │
├──────────────────────────────────────────────────────────────┤
│                       constants/                              │
│  program_ids.dart, tree_config.dart                            │
└──────────────────────────────────────────────────────────────┘
```

Each layer only depends on the layers below. Actions never leak into State. RPC never imports Programs. This is not accidental — it mirrors the TypeScript SDK's architecture, which makes porting and maintenance straightforward.

### Why Six Modules Instead of One Client

The TypeScript `@lightprotocol/stateless.js` SDK puts everything on a `Rpc` class that extends `Connection`. You call `rpc.compress()`, `rpc.transfer()`, and the Rpc object handles everything.

The Dart SDK deliberately splits this differently. There are two reasons:

**1. Signing is different in Flutter.**

In TypeScript, you typically have a `Keypair` in memory and sign synchronously. In Flutter, the signer might be:
- A local `Ed25519HDKeyPair` (for testing)
- A Privy embedded wallet (async signing via native bridge)
- A Saga Seed Vault (hardware signing)
- A WalletConnect session (remote signing)

By separating instruction building (Programs) from transaction orchestration (Actions), the SDK lets you build instructions with any signer abstraction and handle signing yourself. The `compress()` action function takes an `Ed25519HDKeyPair` for convenience, but in production you build the instruction with `LightSystemProgram.compress()` and sign it with whatever wallet provider your app uses.

**2. Flutter apps need progress tracking.**

A compressed transfer is a multi-step operation: fetch accounts, select inputs, get proof, build instruction, sign, send, confirm. In a mobile app, each step should update the UI. If everything lives in one `rpc.transfer()` call, you cannot show progress.

By exposing the intermediate steps — `getCompressedAccountsByOwner()`, `selectMinCompressedSolAccountsForTransfer()`, `getValidityProof()`, `LightSystemProgram.transfer()` — the SDK lets you emit progress events between steps. Fleeker's `LightProtocolService` does exactly this:

```dart
onProgress?.call(TransferStep.preparing);     // After account selection
onProgress?.call(TransferStep.proving);       // Before proof fetch
final proof = await rpc.getValidityProof(hashes: hashes);
onProgress?.call(TransferStep.signing);       // Before wallet sign
final signed = await buildAndSignTransaction(...);
onProgress?.call(TransferStep.sending);       // Before RPC submit
final sig = await sendAndConfirmTransaction(...);
onProgress?.call(TransferStep.confirming);    // After confirmation
```

This is not possible if the SDK hides everything behind a single function call.

### The Programs Layer: Instruction Builders

`LightSystemProgram` and `CompressedTokenProgram` are pure instruction builders. They take parameters and return `Instruction` objects. They do not perform RPC calls, do not sign anything, and do not know about wallets.

Each instruction builder does three things inside:

**1. Compute output state**

Before building the instruction, the program calculates what the output compressed accounts should look like. For a transfer of 0.3 SOL from a 1 SOL input:

```dart
final outputs = LightSystemProgram.createTransferOutputState(
  inputCompressedAccounts: [accountWith1Sol],
  toAddress: recipientPubkey,
  lamports: BigInt.from(300000000), // 0.3 SOL
);
// outputs = [
//   CompressedAccountLegacy(owner: sender, lamports: 700000000),  // change
//   CompressedAccountLegacy(owner: recipient, lamports: 300000000), // transfer
// ]
```

The change account is created automatically. If the input amount exactly matches the transfer amount, no change account is needed, and the outputs list has one entry instead of two.

**2. Pack accounts**

Solana instructions reference accounts through a flat list of `AccountMeta` entries. But a compressed transfer references multiple tree and queue pubkeys. To keep the instruction data compact, the SDK replaces each pubkey with an *index pointer* into a separate "remaining accounts" list appended to the instruction.

This is what `packCompressedAccounts()` does:

```dart
final packed = packCompressedAccounts(
  inputCompressedAccounts: inputs,
  inputStateRootIndices: proof.rootIndices,
  outputCompressedAccounts: outputs,
);
// packed.packedInputCompressedAccounts → tree pubkeys replaced with u8 indices
// packed.remainingAccounts → [treePubkey, queuePubkey, ...] (the index targets)
```

The packed input account now has `merkleTreePubkeyIndex: 0` and `queuePubkeyIndex: 1` instead of full 32-byte pubkeys. This saves ~60 bytes per input account in the instruction data.

> **WHY THIS MATTERS**: Solana transactions are limited to 1,232 bytes. A compressed transfer with 3 input accounts and full pubkeys would easily exceed this. The index-pointer trick keeps instruction data small enough to fit. This is the same approach the TypeScript SDK uses, and it is non-negotiable for production transactions.

**3. Borsh-encode the instruction data**

The `InstructionDataInvoke` class serializes everything into a byte array using Borsh format:

```
[8-byte discriminator]
[Option<CompressedProof>]                    // 1 + (0 or 128) bytes
[Vec<PackedCompressedAccountWithMerkleContext>]  // 4 + n * ~80 bytes
[Vec<OutputCompressedAccountWithPackedContext>]   // 4 + n * ~40 bytes
[Option<u64>]                                // 1 + (0 or 8) bytes (relay fee)
[Vec<NewAddressParamsPacked>]                // 4 + n * ~40 bytes
[Option<u64>]                                // 1 + (0 or 8) bytes (compress/decompress amount)
[bool]                                       // 1 byte (is_compress flag)
```

The discriminator is the first 8 bytes. For the `invoke` instruction, it is `[26, 16, 169, 7, 21, 202, 242, 25]`. This tells the on-chain program which instruction handler to route to — same pattern as Anchor programs.

### The Actions Layer: Orchestration

The action functions (`compress()`, `transfer()`, `decompress()`) are convenience wrappers that chain together RPC calls, account selection, proof fetching, instruction building, signing, and sending. They are the simplest way to use the SDK.

Here is what `transfer()` does internally, step by step:

```dart
Future<String> transfer({...}) async {
  // 1. Fetch all compressed accounts for the owner, paginated
  var accumulatedLamports = BigInt.zero;
  final compressedAccounts = <CompressedAccount>[];
  String? cursor;
  
  while (accumulatedLamports < lamports) {
    final batch = await rpc.getCompressedAccountsByOwner(
      owner.publicKey,
      cursor: cursor,
      limit: 1000,
    );
    for (final account in batch.items) {
      if (account.lamports > BigInt.zero) {
        compressedAccounts.add(account);
        accumulatedLamports += account.lamports;
      }
    }
    cursor = batch.cursor;
    if (batch.items.length < 1000) break;
  }

  // 2. Select minimum accounts for transfer
  final (inputAccounts, _) = selectMinCompressedSolAccountsForTransfer(
    compressedAccounts, lamports,
  );

  // 3. Get validity proof for selected accounts
  final proof = await rpc.getValidityProof(
    hashes: inputAccounts.map((a) => a.hash).toList(),
  );

  // 4. Build instruction
  final instruction = LightSystemProgram.transfer(
    payer: payer.publicKey,
    inputCompressedAccounts: inputAccounts,
    toAddress: toAddress,
    lamports: lamports,
    recentInputStateRootIndices: proof.rootIndices,
    recentValidityProof: proof.compressedProof,
  );

  // 5. Build, sign, send, confirm
  final signedTx = await buildAndSignTransaction(
    rpc: rpc, signer: payer,
    instructions: [instruction],
    computeUnitLimit: 350000,
  );
  return sendAndConfirmTransaction(rpc: rpc, signedTx: signedTx);
}
```

The key insight is that **the action function does not do anything that you cannot do yourself**. It is a recipe, not a black box. If you need progress callbacks, custom compute budgets, multi-instruction transactions, or a different signer, use the underlying pieces directly.

### V1 vs V2 Tree Routing

The SDK silently handles a V1/V2 divergence that trips up people reading the source code.

For **V1 state trees**, output accounts reference the tree's public key directly. The instruction's remaining accounts include the tree account, and the packed output points to it.

For **V2 state trees**, output accounts reference the tree's *queue* public key instead. V2 batched Merkle trees use a different insertion mechanism where new leaves go through the queue first.

The `packCompressedAccounts()` function handles this:

```dart
final Ed25519HDPublicKey activeTreeOrQueue;
if (activeTreeInfo.treeType == TreeType.stateV2) {
  activeTreeOrQueue = activeTreeInfo.queue;  // V2: use queue
} else {
  activeTreeOrQueue = activeTreeInfo.tree;   // V1: use tree
}
```

You never need to think about this distinction unless you are building raw instructions by hand.

### The Constants: Program IDs and Discriminators

`LightProgramIds` holds the deployed program addresses:

```dart
LightProgramIds.lightSystemProgram        // SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7
LightProgramIds.accountCompressionProgram // compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq
LightProgramIds.compressedTokenProgram    // cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m
LightProgramIds.registryProgram           // Lighton6oQpVkeewmo2mcPTQQp7kYHr4fWpAgJyEmDX
LightProgramIds.noopProgram               // noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV
```

These are the same on mainnet and devnet. They are immutable deployed programs.

`LightDiscriminators` holds the 8-byte instruction discriminators:

```dart
LightDiscriminators.invoke         // [26, 16, 169, 7, 21, 202, 242, 25]
LightDiscriminators.invokeCpi      // [49, 212, 191, 129, 39, 194, 43, 196]
LightDiscriminators.transfer       // [163, 52, 200, 231, 140, 3, 69, 186]
LightDiscriminators.mintTo         // [241, 34, 48, 186, 37, 179, 123, 192]
LightDiscriminators.createTokenPool // [23, 169, 27, 122, 147, 169, 209, 152]
```

These are derived from the Anchor discriminator scheme: `SHA256("global:<instruction_name>")[0..8]`. The SDK pre-computes them as constants rather than hashing at runtime.

Several PDA addresses are also pre-computed rather than derived at runtime:

```dart
// SOL pool PDA — holds all compressed SOL
LightSystemProgram.solPoolPda  // CHK57ywWSDncAoRu1F8QgwYJeXuAJyyBYT4LixLXvMZ1

// Account compression authority — signs CPI calls
accountCompressionAuthority     // HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA

// Registered program PDA — governance reference
getRegisteredProgramPda()       // 35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh
```

Pre-computing these avoids async `findProgramAddress()` calls in hot paths. The values are deterministic — they will not change unless the programs are redeployed (which they will not be, since they are immutable).

### TypeScript SDK Comparison

The Dart SDK closely mirrors `@lightprotocol/stateless.js` but with Flutter-specific adaptations:

| Aspect | TypeScript SDK | Dart SDK |
|--------|---------------|----------|
| Entry point | `Rpc` class extends `Connection` | `Rpc.create()` factory, separate from `RpcClient` |
| Signing | `Keypair` passed to action functions | `Ed25519HDKeyPair` or custom signer interface |
| Account packing | `packCompressedAccounts()` | `packCompressedAccounts()` (same API) |
| Borsh encoding | `BorshAccountsCoder` from `@coral-xyz/anchor` | Custom `BorshWriter` (no Anchor dependency) |
| Keccak256 | `@noble/hashes/sha3` | `package:pointycastle` `KeccakDigest(256)` |
| BN254 | JavaScript `BigInt` with manual field checks | `BN254` class with field-size validation |
| Async | `Promise<T>` | `Future<T>` |
| Tree info caching | 1-hour TTL in Rpc class | 1-hour TTL in Rpc class (same strategy) |

The Borsh encoding was reimplemented from scratch rather than depending on an Anchor Dart package. This keeps the dependency tree small — `light_sdk` depends only on `solana`, `equatable`, and `pointycastle`.

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Using `compress()` action and signing with a Privy wallet | The action functions expect `Ed25519HDKeyPair`, not an external signer | Use `LightSystemProgram.compress()` to build the instruction, then sign with your wallet provider |
| Building instructions without compute budget | Compressed operations need 350k-1M compute units | Always add `ComputeBudgetInstruction.setComputeUnitLimit()` |
| Passing `outputStateTreeInfo` with input accounts | `packCompressedAccounts()` throws if both are provided | For transfers and decompress: omit `outputStateTreeInfo`, the tree info comes from input accounts |
| Importing internal modules directly | `light_sdk/src/...` paths are not part of the public API | Import `package:light_sdk/light_sdk.dart` only |

## Related

- [ZK Compression Mental Model](zk-compression-mental-model.md) — The protocol concepts this SDK implements
- [State, Trees, and Proofs](state-trees-and-proofs.md) — Deep dive into the data types
- [RPC, Actions, and Transactions](rpc-actions-and-transactions.md) — How the SDK talks to the network
- [Borsh serialization guide](../borsh.md) — The encoding format used for instruction data
