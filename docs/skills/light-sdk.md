# light_sdk — ZK Compression for Dart and Flutter

> Dart SDK for Light Protocol's ZK compression on Solana. Compress accounts and tokens into Merkle trees at 1/1000th the storage cost, with validity proofs that fit in a single transaction.

## Overview

The `light_sdk` package (v0.1.0-beta.1) is the Dart implementation of Light Protocol's `@lightprotocol/stateless.js` TypeScript SDK. It lets Flutter apps create, transfer, and destroy compressed accounts and SPL-compatible compressed tokens using zero-knowledge proofs.

Compressed accounts store data off-chain (in the Solana ledger and a Photon indexer) with only a hash on-chain in a Merkle tree. A Groth16 SNARK proof (128 bytes, constant size) proves account existence for state transitions. This reduces per-account storage cost from ~0.002 SOL to ~100 lamports.

The SDK:
- Queries compressed state from the Photon indexer via Helius RPC
- Fetches ZK validity proofs from the prover
- Builds instructions for the Light System Program and Compressed Token Program
- Handles Borsh serialization, account packing, and tree routing (V1/V2)
- Provides high-level action functions for compress, transfer, and decompress

**Dependencies:** `solana ^0.31.2`, `equatable`, `pointycastle`

## Quick Start

```yaml
dependencies:
  light_sdk: ^0.1.0-beta.1
  solana: ^0.31.2
```

```dart
import 'package:light_sdk/light_sdk.dart';
import 'package:solana/solana.dart';

final rpc = Rpc.create('https://devnet.helius-rpc.com?api-key=YOUR_KEY');
final wallet = await Ed25519HDKeyPair.random();

// Compress 1 SOL
await compress(rpc: rpc, payer: wallet, lamports: BigInt.from(1000000000), toAddress: wallet.publicKey);

// Transfer 0.1 SOL compressed
await transfer(rpc: rpc, payer: wallet, owner: wallet, lamports: BigInt.from(100000000), toAddress: recipientPubkey);

// Decompress 0.5 SOL
await decompress(rpc: rpc, payer: wallet, owner: wallet, lamports: BigInt.from(500000000), recipient: wallet.publicKey);
```

## Core Concepts

### Key Types

| Type | Purpose |
|------|---------|
| `BN254` | 254-bit field element for ZK proofs and Merkle leaves |
| `CompressedAccount` | Account stored as a leaf in a state tree |
| `TreeInfo` | Metadata for state/address Merkle trees (V1/V2) |
| `CompressedProof` | 128-byte Groth16 SNARK proof (a: 32, b: 64, c: 32) |
| `ValidityProofWithContext` | Proof + root indices + tree context |
| `TokenData` | Parsed compressed token account fields |
| `Rpc` | Extended RPC client with Photon compression API |

### Program IDs

| Program | Address |
|---------|---------|
| Light System | `SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7` |
| Account Compression | `compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq` |
| Compressed Token | `cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m` |
| Registry | `Lighton6oQpVkeewmo2mcPTQQp7kYHr4fWpAgJyEmDX` |

### Instruction Builders

```dart
// SOL operations (LightSystemProgram)
LightSystemProgram.compress(payer:, toAddress:, lamports:, outputStateTreeInfo:)
LightSystemProgram.decompress(payer:, inputCompressedAccounts:, toAddress:, lamports:, recentInputStateRootIndices:, recentValidityProof:)
LightSystemProgram.transfer(payer:, inputCompressedAccounts:, toAddress:, lamports:, recentInputStateRootIndices:, recentValidityProof:)

// Token operations (CompressedTokenProgram)
CompressedTokenProgram.createSplInterface(feePayer:, mint:, tokenProgramId:)
CompressedTokenProgram.compress(payer:, owner:, source:, mint:, amount:, outputStateTreeInfo:, tokenPoolInfo:)
CompressedTokenProgram.decompress(payer:, inputCompressedTokenAccounts:, toAddress:, amount:, recentInputStateRootIndices:, recentValidityProof:, tokenPoolInfo:)
CompressedTokenProgram.transfer(payer:, inputCompressedTokenAccounts:, toAddress:, amount:, recentInputStateRootIndices:, recentValidityProof:)
CompressedTokenProgram.approve(payer:, inputCompressedTokenAccounts:, delegate:, amount:, recentInputStateRootIndices:, recentValidityProof:)
CompressedTokenProgram.revoke(payer:, inputCompressedTokenAccounts:, recentInputStateRootIndices:, recentValidityProof:)
```

### RPC Methods (Photon API)

```dart
// Account queries
rpc.getCompressedAccount({hash, address})
rpc.getCompressedAccountsByOwner(owner, {cursor, limit})
rpc.getCompressedBalanceByOwner(owner)

// Proof
rpc.getValidityProof(hashes:, newAddresses:)

// Token queries
rpc.getCompressedTokenAccountsByOwner(owner, {mint})
rpc.getCompressedTokenBalancesByOwner(owner, {mint})

// Tree metadata (cached 1h)
rpc.getStateTreeInfos()
rpc.getAddressTreeInfoV2()

// History
rpc.getCompressionSignaturesForOwner(owner)
rpc.getTransactionWithCompressionInfo(signature)
```

### Address Derivation

```dart
// V1: Keccak256(programId + seeds) truncated to BN254 field
final seed = deriveAddressSeed(seeds: [bytes1], programId: programId);
final address = deriveAddress(seed: seed, addressMerkleTreePubkey: treePubkey);

// V2: Keccak256(seeds + [255]) → Keccak256(seed + tree + programId + [255])
final seed = deriveAddressSeedV2([bytes1, bytes2]);
final address = deriveAddressV2(addressSeed: seed, addressMerkleTreePubkey: treePubkey, programId: programId);
```

### Account Selection

```dart
final (selected, total) = selectMinCompressedSolAccountsForTransfer(accounts, amount);
final (selected, total) = selectMinCompressedTokenAccountsForTransfer(tokenAccounts, amount, (a) => a.parsed.amount);
```

### Compute Unit Requirements

| Operation | CU Limit |
|-----------|----------|
| Compress SOL/token | 1,000,000 |
| Decompress SOL/token | 1,000,000 |
| Transfer SOL | 350,000 |
| Transfer token | 600,000 |

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Using non-Helius RPC | Compression API is Helius-specific | Use Helius RPC endpoint |
| Querying state immediately after transaction | Indexer needs 1-3s to process | Retry with escalating delays |
| Decompress tokens to wallet address | Must go to SPL ATA | Derive and create ATA first |
| Proof expires before transaction lands | Root indices expire ~40s | Minimize time between proof fetch and submission |

## Deep Dive

For comprehensive documentation of the protocol, SDK internals, and production Flutter integration patterns, see the [light-sdk guide set](../guides/light-sdk/index.md):

1. [ZK Compression Mental Model](../guides/light-sdk/zk-compression-mental-model.md) — Merkle trees, proofs, indexer
2. [SDK Architecture](../guides/light-sdk/sdk-architecture.md) — Module layout, instruction building, packing
3. [State, Trees, and Proofs](../guides/light-sdk/state-trees-and-proofs.md) — BN254, CompressedAccount, TreeInfo
4. [RPC, Actions, and Transactions](../guides/light-sdk/rpc-actions-and-transactions.md) — Photon API, Borsh encoding
5. [Mobile Integration Patterns](../guides/light-sdk/mobile-integration.md) — Privy signing, progress tracking, refresh strategies

## Related

- [Borsh serialization](borsh.md) — Encoding format for instruction data
- [solana-core](solana-core.md) — Base Solana concepts
- [spl-token](spl-token.md) — SPL token operations (regular tokens)
- [Light Protocol docs](https://www.zkcompression.com/) — Official protocol documentation
