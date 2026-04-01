# light_sdk — ZK Compression for Dart and Flutter

> A Dart SDK that lets Flutter apps store Solana state at 1/1000th the cost by using zero-knowledge proofs to compress accounts into Merkle trees instead of paying for on-chain storage.

## Overview

Solana charges rent for every account stored on-chain. A single token account costs ~0.002 SOL. If your app manages 100,000 users, that is 200 SOL in rent — just for empty wallets. For a consumer mobile app, that cost model kills before you ship.

Light Protocol fixes this with **ZK compression**: instead of storing each account's full data on-chain, you hash the data and store the hash as a leaf in a Merkle tree. The actual data lives off-chain (in the Solana ledger's calldata and in an indexer). When you want to prove an account exists and modify it, you provide a zero-knowledge proof that the data matches a leaf in the tree.

`light_sdk` is the Dart client for this system. It talks to three things:

1. **The Solana RPC** — for standard on-chain operations (balances, signatures)
2. **The Photon indexer** — a compression-aware API that tracks compressed account state
3. **The prover** — a server that generates ZK proofs for state transitions

From your Flutter app's perspective, you call `compress()` to move SOL or tokens into the compressed world, `transfer()` to send compressed assets, and `decompress()` to pull them back into regular Solana accounts. The SDK handles proof generation, account selection, instruction building, and Borsh serialization underneath.

The package targets the `solana` Dart package's type system. If you are already using `Ed25519HDPublicKey`, `RpcClient`, and `Instruction` from `package:solana`, `light_sdk` plugs in without introducing a parallel set of types.

## Quick Start

```dart
import 'package:light_sdk/light_sdk.dart';
import 'package:solana/solana.dart';

Future<void> main() async {
  // Connect to Helius (the only RPC provider with ZK Compression support)
  final rpc = Rpc.create('https://devnet.helius-rpc.com?api-key=YOUR_KEY');
  final wallet = await Ed25519HDKeyPair.random();

  // Compress 0.5 SOL into a compressed account
  final sig = await compress(
    rpc: rpc,
    payer: wallet,
    lamports: BigInt.from(500000000),
    toAddress: wallet.publicKey,
  );

  // Check compressed balance
  final balance = await rpc.getCompressedBalanceByOwner(wallet.publicKey);
  print('Compressed: $balance lamports');

  // Transfer compressed SOL to someone else
  final recipient = Ed25519HDPublicKey.fromBase58('...');
  await transfer(
    rpc: rpc,
    payer: wallet,
    owner: wallet,
    lamports: BigInt.from(100000000),
    toAddress: recipient,
  );
}
```

That is the surface. The rest of this guide set explains what is happening underneath — from the cryptography to the Merkle trees to the instruction encoding.

## Why This Guide Exists

The `light_sdk` README tells you *how to call the functions*. The Light Protocol docs tell you *what the protocol does*. This guide set fills the gap between those two:

- What happens inside the SDK when you call `transfer()`
- Why compressed accounts use BN254 field elements instead of regular hashes
- How the "remaining accounts" trick packs tree references into Solana's instruction format
- Why the SDK picks accounts for you and what happens when it picks wrong
- How a Flutter app wires up Privy signing, compressed tokens, and the Photon API into a production feature

If you want to:

- Understand why a compressed transfer needs a validity proof but a compress does not
- Debug why your transaction fails with "invalid proof" or "account not found"
- Build a Flutter app that uses compressed tokens as a core feature
- Contribute to the SDK or port it to another language

...this is the guide.

## The Landscape: What Talks To What

A Flutter app using `light_sdk` ends up talking to five different systems. Understanding which system does what saves hours of debugging.

| System | What it does | Who runs it |
|--------|-------------|-------------|
| **Solana RPC** | Standard chain operations: send transactions, get balances | Any Solana RPC provider |
| **Photon Indexer** | Tracks compressed account state, answers queries like "get all compressed accounts for this owner" | Helius (canonical), self-hostable |
| **Prover** | Generates ZK validity proofs for state transitions | Helius (bundled with Photon) |
| **Light System Program** | On-chain program that verifies proofs and updates Merkle trees | Deployed on Solana (immutable) |
| **Compressed Token Program** | On-chain program for SPL-compatible compressed token operations | Deployed on Solana (immutable) |

The Photon indexer and prover are currently bundled behind Helius's RPC endpoint. When you call `rpc.getValidityProof()`, the SDK hits Helius's compression API, which internally queries Photon and the prover, then returns the proof. You do not need to run these yourself unless you are operating infrastructure.

> **WHY THIS MATTERS**: If your compressed account query returns stale data, the issue is the indexer catching up — not the chain. If your proof is rejected on-chain, the issue is usually that the account state changed between when you fetched it and when the transaction landed. These are different failure modes from different systems.

## Read This Guide Set In Order

The pages are ordered by dependency. Each page assumes you have read the previous ones.

1. **[ZK Compression Mental Model](zk-compression-mental-model.md)** — What compressed accounts are, how Merkle trees organize them, why ZK proofs are involved, and what the indexer does. This is the protocol context you need before touching the SDK.

2. **[SDK Architecture](sdk-architecture.md)** — How `light_sdk` maps those protocol concepts into Dart types. The module layout, the type hierarchy, and how instruction building works.

3. **[State, Trees, and Proofs](state-trees-and-proofs.md)** — Deep dive into `BN254`, `CompressedAccount`, `TreeInfo`, `ValidityProof`, and the address derivation system. The math and the data structures.

4. **[RPC, Actions, and Transactions](rpc-actions-and-transactions.md)** — How the SDK talks to Photon, how high-level actions orchestrate multi-step flows, and how instructions get packed and serialized.

5. **[Mobile Integration Patterns](mobile-integration.md)** — Production patterns from Fleeker, a Flutter app that uses `light_sdk` for compressed token transfers. Privy wallet signing, transaction progress tracking, account refresh strategies, and the complete compress → transfer → decompress flow in a real app.

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Using any RPC provider besides Helius | ZK Compression APIs are Helius-specific extensions | Use Helius RPC endpoint with API key |
| Not waiting for indexer after compress | Photon needs 1-3 seconds to index new compressed accounts | Retry balance queries with exponential backoff |
| Sending compressed tokens to a regular address | Compressed transfers go to compressed accounts, not SPL ATAs | Use `CompressedTokenProgram.transfer()`, not SPL transfer |
| Trying to decompress more than you have | Account selection finds insufficient accounts | Check `getCompressedBalanceByOwner()` first |
| Hardcoding state tree addresses | Trees roll over when full, addresses change | Use `rpc.getStateTreeInfos()` and `selectStateTreeInfo()` |
| Mixing V1 and V2 tree types | V2 trees route through queue, V1 through tree | The SDK handles this — let `packCompressedAccounts()` decide |

## API Quick Reference

### High-Level Actions

| Function | What it does | Compute Units |
|----------|-------------|---------------|
| `compress()` | SOL → compressed account | 1,000,000 |
| `decompress()` | Compressed account → SOL | 1,000,000 |
| `transfer()` | Compressed → compressed | 350,000 |

### Program Instruction Builders

| Class | Methods |
|-------|---------|
| `LightSystemProgram` | `compress()`, `decompress()`, `transfer()`, `createAccount()` |
| `CompressedTokenProgram` | `createSplInterface()`, `mintTo()`, `transfer()`, `compress()`, `decompress()`, `approve()`, `revoke()` |

### RPC Methods (Photon API)

| Method | Purpose |
|--------|---------|
| `getCompressedAccount()` | Fetch single account by hash or address |
| `getCompressedAccountsByOwner()` | Paginated accounts for an owner |
| `getCompressedBalanceByOwner()` | Total compressed SOL balance |
| `getValidityProof()` | Get ZK proof for state transition |
| `getStateTreeInfos()` | Active state tree metadata (cached) |
| `getCompressedTokenAccountsByOwner()` | Compressed token accounts for an owner |
| `getCompressedTokenBalancesByOwner()` | Compressed token balances by mint |

### Key Types

| Type | Purpose |
|------|---------|
| `BN254` | 254-bit field element for ZK proofs |
| `CompressedAccount` | Account stored in a Merkle tree |
| `TreeInfo` | Metadata for state/address tree |
| `CompressedProof` | ZK proof (128 bytes: 32 + 64 + 32) |
| `ValidityProofWithContext` | Proof + root indices + tree context |
| `Rpc` | Extended RPC client with compression API |

## Related

- [Light Protocol documentation](https://www.zkcompression.com/) — Official protocol docs
- [Helius ZK Compression RPC](https://docs.helius.dev/compression-and-das-api/digital-asset-standard-das-api) — API reference for the Photon endpoints
- [`solana` package guide](../solana-package.md) — The base Solana Dart package that `light_sdk` extends
- [Borsh serialization guide](../borsh.md) — How the SDK encodes instruction data
