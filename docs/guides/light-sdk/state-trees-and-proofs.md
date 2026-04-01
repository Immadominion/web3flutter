# State, Trees, and Proofs

> The data types at the bottom of the SDK — `BN254`, `CompressedAccount`, `TreeInfo`, `ValidityProof` — and why each field exists, what constraints it carries, and how the address derivation system works.

## Overview

Every compressed operation in the SDK eventually touches four core types:

- **`BN254`** — A 254-bit number constrained to a specific elliptic curve field. This is what account hashes, tree leaves, and addresses are represented as.
- **`CompressedAccount`** — The data structure for a single compressed account: who owns it, how many lamports it has, which tree it lives in, and what position.
- **`TreeInfo`** — Metadata about the Merkle tree containing an account: the tree's public key, its nullifier queue, and whether it is V1 or V2.
- **`CompressedProof` / `ValidityProofWithContext`** — The 128-byte ZK proof that says "these accounts exist," plus the context needed to use it in an instruction.

These types are the foundation. The RPC layer returns them. The program layer consumes them. The action layer wires them together. If you do not understand what each field does, debugging compressed transactions becomes guesswork.

## Quick Start

```dart
import 'package:light_sdk/light_sdk.dart';

// BN254: a hash constrained to the ZK proof field
final hash = BN254.fromBase58('7V1m2qGVwMDPJkFm2mNQVn4jKzbeNp3C9VhKZHkCGGhS');
print(hash.toBigInt());    // The numeric value
print(hash.isZero);        // Whether this is the zero element
print(hash.bytes);         // 32 bytes, big-endian

// CompressedAccount: an account in the Merkle tree
final account = CompressedAccount(
  owner: Ed25519HDPublicKey.fromBase58('11111111111111111111111111111111'),
  lamports: BigInt.from(1000000000),
  hash: hash,
  treeInfo: someTreeInfo,
  leafIndex: 42,
);

// TreeInfo: which tree holds this account
final tree = TreeInfo(
  tree: Ed25519HDPublicKey.fromBase58('...'),
  queue: Ed25519HDPublicKey.fromBase58('...'),
  treeType: TreeType.stateV2,
);

// CompressedProof: 128 bytes of ZK magic
final proof = CompressedProof(
  a: List<int>.filled(32, 0),  // 32 bytes
  b: List<int>.filled(64, 0),  // 64 bytes
  c: List<int>.filled(32, 0),  // 32 bytes
);
```

## Core Concepts

### BN254: Not Just a Hash

The most alien type in the SDK for someone coming from regular Solana development is `BN254`. On regular Solana, hashes are SHA256 outputs — 32 bytes, no special constraints. In Light Protocol, hashes must be valid elements of the **BN254 scalar field**.

BN254 (also called alt-bn128) is an elliptic curve used for efficient pairing-based cryptography. Its scalar field has a specific prime modulus:

```
p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
```

Any value used as a leaf in the Merkle tree, as an account hash, or as an address must be less than this number. Since a 256-bit number can exceed this, the SDK truncates Keccak256 outputs by zeroing the most significant byte:

```dart
// From address.dart — after Keccak256 hashing
hash[0] = 0;  // Truncate to fit in BN254 field
```

This makes the effective hash 248 bits instead of 256, which is still collision-resistant for all practical purposes.

#### Why BN254 Instead of SHA256?

The Merkle tree verification is done inside a ZK proof circuit (Groth16). ZK circuits work natively with field arithmetic on specific curves. BN254 is the curve used by the circuit. If hashes were SHA256, the prover would need to simulate SHA256 *inside* the ZK circuit, which is extremely expensive (tens of thousands of constraints per hash).

By using a BN254-native hash function (Poseidon), the circuit is orders of magnitude more efficient. This is why proof generation takes milliseconds instead of minutes.

The Dart SDK uses Keccak256 (not Poseidon) for *address derivation*, because address derivation happens off-chain where performance does not matter. But the resulting hash is still truncated to the BN254 field so it can be used in proofs.

#### BN254 API

```dart
// Construction
final fromBytes = BN254.fromBytes(Uint8List(32));               // Raw 32 bytes, big-endian
final fromInt = BN254.fromBigInt(BigInt.from(12345));            // Integer value
final fromKey = BN254.fromBase58('7V1m...');                     // Base58-encoded (Solana format)
final fromPubkey = BN254.fromPublicKey(someEd25519HDPublicKey);  // From Solana pubkey

// Conversion
final bigInt = hash.toBigInt();      // BigInt representation
final base58 = hash.toBase58();      // Base58 string (for display)
final bytes = hash.bytes;            // Uint8List (32 bytes, big-endian)
final list = hash.toList();          // List<int> (for serialization)

// Checks
final isZero = hash.isZero;          // Whether this is the zero element

// Constants
final fieldSize = BN254.fieldSize;                  // The prime modulus p
final highAddress = BN254.highestAddressPlusOne;    // Address space boundary
final zero = BN254.zero;                            // Zero element
```

> **GOTCHA**: `BN254.fromBase58()` creates a BN254 from a base58 string that was originally a Solana public key. This works because both are 32 bytes. But the semantic meaning is different — a BN254 is a field element, not an Ed25519 point. The SDK uses base58 for display purposes, not because BN254 values "are" public keys.

### CompressedAccount: The UTXO

`CompressedAccount` represents a single compressed account — one leaf in a state tree. Here is every field and what it does:

```dart
class CompressedAccount {
  final Ed25519HDPublicKey owner;     // Who owns this account
  final BigInt lamports;               // SOL balance
  final BN254 hash;                    // Leaf hash in the tree
  final TreeInfo treeInfo;             // Which tree it lives in
  final int leafIndex;                 // Position in the tree
  final List<int>? address;            // Optional 32-byte persistent ID
  final CompressedAccountData? data;   // Optional program data
  final bool readOnly;                 // Read-only input flag
  final bool proveByIndex;             // Batch tree optimization flag
}
```

#### `owner`
The public key of the program that owns this account. For user-owned SOL, this is the System Program (`111...1`). For compressed token accounts, this is the Compressed Token Program. For custom program accounts, this is your program's ID.

This is the same ownership model as regular Solana accounts. The owner program is the only one that can modify the account's data and debit its lamports.

#### `lamports`
The SOL balance attached to this account. For compressed token accounts, this is usually zero — the token amount is in the `data` field instead. For compressed SOL transfers, this is the whole point.

Uses `BigInt` because lamport values can exceed JavaScript's `Number.MAX_SAFE_INTEGER` (though in practice they rarely do for individual accounts).

#### `hash`
The BN254 field element that represents this account as a leaf in the Merkle tree. This hash is computed from all other fields (owner, lamports, address, data, tree, leaf index). Any change to any field produces a different hash.

This is how the tree knows the account exists. The on-chain program does not store or check the account data directly — it checks that this hash exists as a leaf in the tree, using the validity proof.

#### `treeInfo`
Metadata about which state tree contains this account. See the TreeInfo section below.

#### `leafIndex`
The position of this account's hash in the Merkle tree (zero-indexed). Together with `treeInfo.tree`, this uniquely identifies the leaf. The leaf index is also used in the hash computation, which means moving an account to a different position would change its hash.

After a transaction consumes this account, the leaf at this index is eventually zeroed by the forester. A new leaf is appended at the next available index.

#### `address`
An optional 32-byte persistent identifier. Most compressed accounts do not have one. SOL balance accounts and fungible token accounts do not need stable IDs — you just scan by owner.

Accounts that need stable identifiers — user profiles, game state, program configuration — use the address field. The address is derived using Keccak256 from seeds (similar to Solana PDAs) and registered in an address tree to ensure uniqueness. See the Address Derivation section below.

#### `data`
Optional program data attached to the account:

```dart
class CompressedAccountData {
  final List<int> discriminator;  // 8-byte type tag
  final List<int> data;           // Raw program data
  final List<int> dataHash;       // Poseidon hash of data
}
```

The `discriminator` is the same 8-byte prefix that Anchor programs use to identify account types. The `data` is the raw bytes of whatever the program stores. The `dataHash` is a Poseidon hash of the data used in the Merkle leaf computation.

For simple SOL accounts (no program data), this field is null. For compressed token accounts, it contains the mint, amount, owner, delegate, and state fields encoded in a token-specific layout.

#### `readOnly` and `proveByIndex`
Optimization flags for advanced use cases:

- `readOnly`: The input account is not being modified, just read. This avoids nullification, reducing cost.
- `proveByIndex`: For V2 batched trees, the account can be proven by its leaf index rather than requiring a full Merkle proof. This is more efficient when the tree supports batch operations.

### TreeInfo: Where an Account Lives

Every compressed account exists in a specific Merkle tree. `TreeInfo` carries the metadata:

```dart
class TreeInfo {
  final Ed25519HDPublicKey tree;          // Tree account on Solana
  final Ed25519HDPublicKey queue;         // Nullifier queue account
  final TreeType treeType;                // V1/V2, state/address
  final Ed25519HDPublicKey? cpiContext;   // For CPI-based programs
  final TreeInfo? nextTreeInfo;           // Rollover target
}
```

#### `tree`
The public key of the Solana account that stores the Merkle tree's root and metadata on-chain. This is a regular Solana account owned by the Account Compression Program. For V1 trees, this is also what output accounts reference in their packed instructions.

#### `queue`
The public key of the nullifier queue. When a compressed account is consumed in a transaction, its hash is added to this queue. The forester later processes the queue to zero out the corresponding tree leaves.

For V2 batched trees, the queue serves double duty: new output leaves are also routed through the queue before being inserted into the tree. This is why V2 output accounts reference `queue` instead of `tree`.

#### `treeType`
One of four values:

| TreeType | Structure | Height | Purpose |
|----------|-----------|--------|---------|
| `stateV1` | Concurrent Merkle tree | 26 | Stores compressed account hashes |
| `stateV2` | Batched Merkle tree | 32 | Stores compressed account hashes (newer) |
| `addressV1` | Indexed Merkle tree | 26 | Tracks unique addresses |
| `addressV2` | Batched indexed Merkle tree | 40 | Tracks unique addresses (newer) |

V2 trees are more efficient (larger capacity, batch operations), but both versions are live on mainnet. The SDK handles the routing differences — you do not pick a version.

#### `nextTreeInfo`
When a tree is approaching its rollover threshold, `nextTreeInfo` points to the new tree that will receive new leaves. The SDK's `packCompressedAccounts()` uses this to route output accounts to the correct tree:

```dart
final activeTreeInfo = treeInfo.nextTreeInfo ?? treeInfo;
```

If `nextTreeInfo` is non-null, new outputs go to the next tree. If null, they go to the current tree. This is transparent to the caller.

#### The `isV2` and `isAddressTree` Helpers

```dart
final isV2 = treeInfo.isV2;              // stateV2 or addressV2
final isAddress = treeInfo.isAddressTree; // addressV1 or addressV2
```

Convenience getters. Used internally by `packCompressedAccounts()` to decide whether to route through `tree` or `queue`.

### CompressedProof: 128 Bytes of Cryptographic Proof

The validity proof is a Groth16 SNARK with three components:

```dart
class CompressedProof {
  final List<int> a;  // 32 bytes — G1 point
  final List<int> b;  // 64 bytes — G2 point
  final List<int> c;  // 32 bytes — G1 point
}
```

These are elliptic curve points in compressed form. The on-chain verifier knows the verification key (baked into the program) and can check that `e(a, b) == e(c, vk)` (pairing check) holds, which proves the prover knew valid Merkle paths without revealing them.

You never construct a proof yourself. The prover server generates it from the Merkle tree data. You receive it from `rpc.getValidityProof()` and pass it to instruction builders.

The total size is always 128 bytes, regardless of how many accounts are being proven. This constant size is what makes ZK compression feasible within Solana's transaction size limit.

### ValidityProofWithContext: Proof Plus Metadata

The raw `CompressedProof` is not enough to build an instruction. You also need:

```dart
class ValidityProofWithContext {
  final ValidityProof? compressedProof;  // The 128-byte proof (null for empty batches)
  final List<BN254> roots;               // Merkle roots used in the proof
  final List<int> rootIndices;           // Root history indices (for on-chain lookup)
  final List<int> leafIndices;           // Leaf positions for each account
  final List<BN254> leaves;             // The leaf hashes being proven
  final List<TreeInfo> treeInfos;       // Trees for each leaf
  final List<bool> proveByIndices;      // Batch optimization flags
}
```

The critical field is `rootIndices`. The on-chain program maintains a rolling history of recent Merkle roots (the "root buffer"). When verifying a proof, it looks up the root at `rootIndices[i]` to check against. If the root has rolled out of the buffer (more than ~100 slots old), the proof is rejected.

This is why you should minimize the time between calling `getValidityProof()` and submitting the transaction. If you wait too long, the root may expire and the transaction fails.

### Address Derivation: Stable Identifiers for Compressed Accounts

Compressed addresses serve the same purpose as Solana PDAs — giving accounts stable, deterministic identifiers. But the derivation mechanism is different.

#### Solana PDA derivation
```
SHA256(seeds + program_id + "ProgramDerivedAddress")
→ Check if valid Ed25519 point. If so, try different bump seed.
→ Result: 32-byte address that is NOT on the Ed25519 curve
```

#### Compressed address derivation (V1)
```dart
// Step 1: Hash seeds with program ID using Keccak256
final seed = deriveAddressSeed(
  seeds: [Uint8List.fromList('user_profile'.codeUnits), userPubkey.bytes],
  programId: myProgramId,
);
// Internally: Keccak256(programId.bytes + seed1 + seed2)[0] = 0

// Step 2: Hash seed with tree pubkey
final address = deriveAddress(
  seed: seed,
  addressMerkleTreePubkey: treeId,
);
// Internally: Keccak256(treePubkey.bytes + seed) with bump seeds until < BN254 field
```

#### Compressed address derivation (V2)
```dart
// Step 1: Hash seeds with bump byte (255)
final seed = deriveAddressSeedV2([seed1, seed2, seed3]);
// Internally: Keccak256(seed1 + seed2 + seed3 + [255])[0] = 0

// Step 2: Hash seed + tree + program ID with bump byte (255)
final address = deriveAddressV2(
  addressSeed: seed,
  addressMerkleTreePubkey: treeId,
  programId: myProgramId,
);
// Internally: Keccak256(seed + treePubkey + programId + [255])[0] = 0
```

The key differences from Solana PDAs:

1. **Keccak256 instead of SHA256** — Keccak is more efficient inside ZK circuits
2. **BN254 field constraint** — The result must be less than the field modulus
3. **Truncation instead of bump seeds** — V1 uses bump seeds (trying 255 down to 0), V2 just zeroes the MSB
4. **Two-step derivation** — First derive a seed, then derive the address from the seed and tree

> **WHY THIS MATTERS**: If you are porting code from the TypeScript SDK, the address derivation functions have the same names and semantics. But if you are trying to derive addresses that match PDAs from an Anchor program, they will *not* match — different hash function, different constraints.

### Keccak256 Hashing: Three Variants

The SDK provides three hashing functions, each matching a specific TypeScript SDK function:

```dart
// hashvToBn254FieldSizeBe: Hash multiple inputs, truncate MSB
final hash1 = hashvToBn254FieldSizeBe([bytes1, bytes2, bytes3]);
// = Keccak256(bytes1 || bytes2 || bytes3) with hash[0] = 0

// hashvToBn254FieldSizeBeU8Array: Same but adds bump byte (255)
final hash2 = hashvToBn254FieldSizeBeU8Array([bytes1, bytes2]);
// = Keccak256(bytes1 || bytes2 || [255]) with hash[0] = 0

// hashToBn254FieldSizeBe: Legacy, tries bump seeds 255 → 0
final (hash3, bump) = hashToBn254FieldSizeBe(data)!;
// = Keccak256(data || [bump]) with hash[0] = 0, first bump where result < field size
```

All three use `package:pointycastle`'s `KeccakDigest(256)` with incremental updates. The TypeScript SDK uses `@noble/hashes/sha3` `keccak_256`, which produces identical output.

The incremental hashing (calling `digest.update()` for each input before `digest.doFinal()`) produces the same result as concatenating all inputs and hashing once, because Keccak is a sponge construction that absorbs input sequentially.

### Token Data: Compressed SPL Tokens

Compressed token accounts store their token-specific data in the `CompressedAccountData.data` field:

```dart
class TokenData {
  final Ed25519HDPublicKey mint;        // Token mint
  final Ed25519HDPublicKey owner;       // Token owner
  final BigInt amount;                  // Token balance
  final TokenAccountState state;        // uninitialized / initialized / frozen
  final Ed25519HDPublicKey? delegate;   // Optional delegate
  final List<int>? tlv;                 // Token-2022 extension data
}
```

This matches the SPL Token account layout but in a compressed form. The Compressed Token Program ensures that compressed transfers respect the same rules as regular SPL transfers — you can only spend if you are the owner or an approved delegate.

## Patterns & Recipes

### Pattern: Check If an Account Has an Address

```dart
final account = await rpc.getCompressedAccount(hash: someHash);
if (account.address != null) {
  print('This account has a persistent address');
  print('Address: ${Ed25519HDPublicKey(account.address!).toBase58()}');
} else {
  print('This account is hash-identified only (no stable address)');
}
```

Most accounts (SOL balances, token balances) do not have addresses. Program-owned data accounts typically do.

### Pattern: Verify a BN254 Value Is in the Field

```dart
final value = someHash.toBigInt();
if (value >= BN254.fieldSize) {
  // This should never happen if the SDK produced the hash
  throw StateError('Hash is outside BN254 field');
}
```

The SDK enforces this in constructors, so you will not encounter out-of-field values from normal operations. But if you are importing hashes from external sources, validate.

### Pattern: Read Tree Info from an Account

```dart
final account = compressedAccounts.first;
final tree = account.treeInfo;

print('Tree: ${tree.tree.toBase58()}');
print('Queue: ${tree.queue.toBase58()}');
print('Type: ${tree.treeType}');           // stateV1, stateV2, etc.
print('Is V2: ${tree.isV2}');
print('Has rollover: ${tree.nextTreeInfo != null}');
print('Leaf index: ${account.leafIndex}');
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Comparing `BN254` by base58 string | Two BN254 values with the same bytes will have the same base58, but string comparison is fragile | Use `==` operator (the class extends `Equatable`) |
| Assuming leaf index is globally unique | The same leaf index can exist in different trees | Always pair `leafIndex` with `treeInfo` |
| Ignoring `readOnly` and `proveByIndex` flags | They default to `false`, which works but is suboptimal for read operations | Set `readOnly: true` for accounts you only need to read, not modify |
| Reconstructing TreeInfo manually | You might get the tree/queue pubkeys swapped for V2 | Use the TreeInfo from `rpc.getCompressedAccountsByOwner()` response — it is already correct |
| Using `deriveAddressSeed` when V2 derivation is needed | V1 and V2 produce different seeds | Check which version the program expects. V2 is the current standard for new programs. |

## Related

- [ZK Compression Mental Model](zk-compression-mental-model.md) — The protocol context for these data types
- [SDK Architecture](sdk-architecture.md) — How these types fit into the module hierarchy
- [RPC, Actions, and Transactions](rpc-actions-and-transactions.md) — How these types are used in operations
