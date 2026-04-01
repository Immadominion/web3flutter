# RPC, Actions, and Transactions

> How the SDK talks to the Photon indexer, how high-level actions orchestrate multi-step flows, how instructions get packed and serialized, and what happens when things go wrong.

## Overview

The RPC layer is where `light_sdk` talks to the outside world. It wraps two separate APIs behind one `Rpc` object:

1. **Standard Solana RPC** — `getBalance()`, `getRecentBlockhash()`, `sendAndConfirmTransaction()` — everything you use for regular Solana operations
2. **Photon Compression API** — `getCompressedAccount()`, `getValidityProof()`, `getCompressedTokenAccountsByOwner()` — the custom methods that only work with Helius

On top of the RPC layer, the **actions layer** provides one-call functions for common operations. And underneath both layers, the **transaction building** utilities handle compute budgets, signing, and confirmation.

This page covers all three: how queries work, how proofs are fetched, how instructions are built and sent, and what the failure modes look like.

## Quick Start

```dart
import 'package:light_sdk/light_sdk.dart';
import 'package:solana/solana.dart';

Future<void> main() async {
  // Create the RPC client (connects to both Solana RPC and Photon API)
  final rpc = Rpc.create('https://devnet.helius-rpc.com?api-key=YOUR_KEY');

  // Standard Solana RPC
  final balance = await rpc.rpcClient.getBalance(wallet.publicKey);

  // Compression API: query compressed state
  final compressedBalance = await rpc.getCompressedBalanceByOwner(wallet.publicKey);
  final accounts = await rpc.getCompressedAccountsByOwner(wallet.publicKey);

  // Compression API: get validity proof
  final proof = await rpc.getValidityProof(
    hashes: accounts.items.map((a) => a.hash).toList(),
  );

  // Compression API: token queries
  final tokenAccounts = await rpc.getCompressedTokenAccountsByOwner(
    wallet.publicKey,
    mint: usdcMint,
  );
}
```

## Core Concepts

### The Rpc Class: Two APIs, One Connection

`Rpc` is not a subclass of `RpcClient`. It *contains* an `RpcClient` and adds compression methods alongside it:

```dart
final rpc = Rpc.create(
  'https://devnet.helius-rpc.com?api-key=YOUR_KEY',
  compressionApiEndpoint: null,    // Optional: separate endpoint for Photon
  proverEndpoint: null,            // Optional: separate endpoint for prover
  apiVersion: ApiVersion.v2,       // Default
  timeout: Duration(seconds: 30),  // Default
);

// Access the underlying Solana RPC when needed
final solBalance = await rpc.rpcClient.getBalance(pubkey);
```

When `compressionApiEndpoint` is null (the default), compression API calls go to the same URL as the Solana RPC. This works because Helius serves both APIs from the same endpoint, routing based on the RPC method name. Methods like `getCompressedAccount` are handled by Photon; methods like `getBalance` are handled by the standard Solana RPC.

If you are running your own Photon indexer, you can separate the endpoints:

```dart
final rpc = Rpc.create(
  'https://api.mainnet-beta.solana.com',            // Standard Solana RPC
  compressionApiEndpoint: 'https://my-photon:8080',  // Self-hosted Photon
  proverEndpoint: 'https://my-prover:3001',          // Self-hosted prover
);
```

### Account Queries: How to Find Compressed State

The compression API provides several query patterns:

#### By Owner (Most Common)

```dart
// Get all compressed accounts for an owner, paginated
final page1 = await rpc.getCompressedAccountsByOwner(
  ownerPubkey,
  cursor: null,      // Null for first page
  limit: 100,        // Max 1000
);

// Pagination
if (page1.items.length == 100) {
  final page2 = await rpc.getCompressedAccountsByOwner(
    ownerPubkey,
    cursor: page1.cursor,
    limit: 100,
  );
}
```

This is the primary discovery method. When a user opens their wallet, you call this to find all their compressed accounts. Each account in the response includes full metadata: hash, owner, lamports, tree info, leaf index, and optional address/data.

#### By Hash (Direct Lookup)

```dart
final account = await rpc.getCompressedAccount(hash: someHash);
```

If you already know the account's hash (e.g., from a previous query or a transaction receipt), this is the fastest lookup.

#### By Address (Stable Identifier)

```dart
final account = await rpc.getCompressedAccount(address: someAddress);
```

For accounts with persistent addresses (from `deriveAddress()`), you can query by address instead of hash. The address does not change when the account is modified.

#### Token-Specific Queries

```dart
// Get all compressed token accounts for an owner
final tokenAccounts = await rpc.getCompressedTokenAccountsByOwner(
  ownerPubkey,
  mint: usdcMint,            // Optional: filter by mint
  cursor: null,
  limit: 100,
);

// Get total compressed token balance by owner
final balances = await rpc.getCompressedTokenBalancesByOwner(
  ownerPubkey,
  mint: usdcMint,            // Optional: filter by mint
);

// Get compressed token balance for a specific account
final balance = await rpc.getCompressedTokenAccountBalance(someHash);
```

Token queries return accounts with their `TokenData` parsed — you get `mint`, `owner`, `amount`, `state`, `delegate` directly instead of raw bytes.

> **GOTCHA**: `getCompressedTokenAccountsByOwner()` returns accounts owned by the *token owner* (the person who can spend the tokens), not the program owner. This matches SPL token semantics where `getTokenAccountsByOwner()` filters by the token account's `owner` field, not by the account's Solana-level owner.

### Balance Queries

```dart
// Total compressed SOL for an owner
final solBalance = await rpc.getCompressedBalanceByOwner(ownerPubkey);
// Returns: BigInt (total lamports across all compressed accounts)

// Total compressed SOL for a specific account
final accountBalance = await rpc.getCompressedBalance(hash: someHash);
// Returns: BigInt (lamports for that single account)
```

These convenience methods save you from fetching all accounts and summing manually. But note that `getCompressedBalanceByOwner()` is a server-side operation — if the indexer is not caught up, the balance may be stale.

### State Tree Info: Where to Write New Leaves

Before compressing SOL or creating outbound compressed accounts, you need to know which tree to write to:

```dart
final treeInfos = await rpc.getStateTreeInfos();
// Returns: List<TreeInfo> — all active state trees

final selectedTree = selectStateTreeInfo(treeInfos);
// Utility: picks the best tree (prefers V2, checks capacity)
```

The response is **cached for 1 hour** inside the `Rpc` instance. This is safe because state trees change rarely (only when a tree rolls over, which happens after millions of operations). The cache avoids redundant RPC calls on every compress operation.

Address tree info works the same way:

```dart
final addressTree = await rpc.getAddressTreeInfoV2();
// Returns: TreeInfo for the active address tree
```

### Validity Proofs: The Most Important RPC Call

`getValidityProof()` is the call that makes everything work. It takes account hashes and (optionally) new addresses, and returns a ZK proof that lets you modify those accounts on-chain.

```dart
final proof = await rpc.getValidityProof(
  hashes: [account1.hash, account2.hash],   // Accounts being consumed
  newAddresses: [],                          // New addresses being created (optional)
);

// proof.compressedProof → CompressedProof (128 bytes, or null if no proof needed)
// proof.rootIndices → [0, 1] (which root history slot each account uses)
// proof.leafIndices → [42, 99] (leaf positions)
// proof.treeInfos → [tree1Info, tree2Info]
```

What happens inside this call:

1. The SDK sends a JSON-RPC request with the hashes to the compression API
2. Photon looks up the Merkle paths for each hash in its tree database
3. Photon forwards the paths to the prover
4. The prover generates a Groth16 SNARK proof covering all paths
5. The response includes the proof, root indices, and tree context

**Timing matters.** The proof references specific Merkle roots. On-chain, the program checks the proof against stored root history. If the root is too old (more than ~100 slots, roughly 40 seconds), the proof is invalid. Minimize the time between `getValidityProof()` and `sendAndConfirmTransaction()`.

> **CRITICAL**: If your transaction fails with "invalid proof" or "root not found," the most likely cause is a stale root. Either another transaction modified the tree between your proof fetch and your submission, or you waited too long. The fix is to re-fetch the compressed accounts, get a new proof, and retry.

### Signature and History Queries

```dart
// Get compression transaction signatures for an account
final sigs = await rpc.getCompressionSignaturesForAccount(accountHash);

// Get signatures for a specific address
final addrSigs = await rpc.getCompressionSignaturesForAddress(address);

// Get signatures for an owner
final ownerSigs = await rpc.getCompressionSignaturesForOwner(ownerPubkey);

// Get full transaction details with compression info
final txDetails = await rpc.getTransactionWithCompressionInfo(signature);
```

These are useful for building transaction history UIs. The `getTransactionWithCompressionInfo()` method returns parsed compression events, including which accounts were created and which were nullified.

### The Actions Layer: One-Call Operations

The action functions are the simplest way to do compression operations. They handle the full flow: query → prove → build → sign → send → confirm.

#### `compress()`: SOL → Compressed Account

```dart
final signature = await compress(
  rpc: rpc,
  payer: wallet,                             // Ed25519HDKeyPair (signs the tx)
  lamports: BigInt.from(1000000000),         // 1 SOL
  toAddress: wallet.publicKey,               // Recipient of compressed account
  outputStateTreeInfo: null,                 // Auto-selected
  commitment: Commitment.confirmed,
  timeout: Duration(seconds: 30),
);
```

**What happens inside:**
1. If `outputStateTreeInfo` is null, fetches tree infos and selects one
2. Calls `LightSystemProgram.compress()` to build the instruction
3. Builds transaction with 1,000,000 compute unit limit
4. Signs with `payer`
5. Sends and waits for confirmation

**No proof needed.** Compression creates a new leaf without consuming any existing ones. The SOL transfers from the payer to the SOL pool PDA, and a new compressed account appears in the tree.

#### `transfer()`: Compressed → Compressed

```dart
final signature = await transfer(
  rpc: rpc,
  payer: wallet,                             // Fee payer
  owner: wallet,                             // Owner of input accounts (must sign)
  lamports: BigInt.from(100000000),          // 0.1 SOL
  toAddress: recipientPubkey,
  commitment: Commitment.confirmed,
  timeout: Duration(seconds: 30),
);
```

**What happens inside:**
1. Fetches all compressed accounts for `owner`, paginated (up to 1000 per batch)
2. Accumulates accounts until total >= transfer amount
3. Calls `selectMinCompressedSolAccountsForTransfer()` to pick minimum inputs
4. Calls `rpc.getValidityProof()` for the selected hashes
5. Calls `LightSystemProgram.transfer()` to build the instruction
6. Builds transaction with 350,000 compute units
7. Signs with `payer` (and `owner` if different from payer)
8. Sends and confirms

**Change accounts.** If the selected inputs total more than the transfer amount, the SDK creates a change account. For example, transferring 0.3 SOL from a 1 SOL account produces two outputs: 0.3 SOL for the recipient, 0.7 SOL for the sender.

#### `decompress()`: Compressed → Regular SOL

```dart
final signature = await decompress(
  rpc: rpc,
  payer: wallet,
  owner: wallet,
  lamports: BigInt.from(500000000),          // 0.5 SOL
  recipient: wallet.publicKey,               // Regular Solana address to receive SOL
  commitment: Commitment.confirmed,
  timeout: Duration(seconds: 30),
);
```

**What happens inside:**
1. Same account fetch and selection as `transfer()`
2. Gets validity proof
3. Calls `LightSystemProgram.decompress()` — this sets `isCompress: false` and includes the decompression recipient
4. Builds transaction with 1,000,000 compute units
5. Signs, sends, confirms

The on-chain program transfers SOL from the SOL pool PDA to the decompression recipient. The compressed accounts are consumed (nullified).

### Account Selection: Picking The Right Inputs

When transferring 0.5 SOL, and you have compressed accounts of [0.3, 0.2, 0.8, 0.1] SOL, which do you pick?

```dart
final (selected, totalAmount) = selectMinCompressedSolAccountsForTransfer(
  allAccounts,
  BigInt.from(500000000), // 0.5 SOL
);
// selected = [0.8 SOL account]  (one account >= 0.5, minimizes inputs)
// totalAmount = 800000000
```

The algorithm:
1. Sort accounts by lamports descending
2. Accumulate from largest to smallest until total >= target
3. Return the minimum set

This minimizes the number of input accounts, which matters because:
- Each input account adds ~80 bytes to instruction data
- More inputs = more compute units
- The validity proof covers all inputs (more paths = slower proving)

For tokens, the same logic applies with a custom getter:

```dart
final (selected, total) = selectMinCompressedTokenAccountsForTransfer(
  allTokenAccounts,
  BigInt.from(100),      // 100 tokens
  (account) => account.parsed.amount,
);
```

If the total across all accounts is less than the requested amount, both functions throw `InsufficientBalanceException`.

### Transaction Building: Compute Budgets and Signing

Every compressed transaction needs three things beyond the compression instruction:

1. **Compute unit limit** — ZK proof verification is CPU-intensive
2. **Recent blockhash** — Standard Solana requirement
3. **Signatures** — From the payer and optionally the account owner

```dart
final signedTx = await buildAndSignTransaction(
  rpc: rpc,
  signer: payer,
  instructions: [compressInstruction],
  computeUnitLimit: 1000000,                 // 1M CU for compress/decompress
  computeUnitPrice: 1000,                    // Micro-lamports per CU (priority fee)
  commitment: Commitment.confirmed,
  additionalSigners: [owner],                // If owner != payer
);

final signature = await sendAndConfirmTransaction(
  rpc: rpc,
  signedTx: signedTx,
  commitment: Commitment.confirmed,
  timeout: Duration(seconds: 60),
);
```

**Compute unit recommendations:**

| Operation | CU Limit | Why |
|-----------|----------|-----|
| Compress SOL | 1,000,000 | No proof verification, but tree append is expensive |
| Decompress SOL | 1,000,000 | Proof verification + tree operations |
| Transfer SOL | 350,000 | Proof verification (lighter tree ops) |
| Transfer tokens | 600,000 | Token program CPI adds overhead |
| Create token pool | 400,000 | One-time setup |

These values come from the TypeScript SDK's defaults and are conservative. In practice, most operations use less. But under-estimating causes transaction failure, while over-estimating just wastes a few lamports in priority fees.

### The Compressed Token Program: Token-Specific Operations

For SPL-compatible compressed tokens, `CompressedTokenProgram` provides instruction builders that mirror the Light System Program but add token semantics:

#### Creating a Token Pool

Before any token can be compressed, its pool must exist:

```dart
final ix = await CompressedTokenProgram.createSplInterface(
  feePayer: payerPubkey,
  mint: usdcMint,
  tokenProgramId: Ed25519HDPublicKey.fromBase58(
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ),
);
```

This creates an SPL token account owned by the Compressed Token Program's PDA. The pool holds the "real" SPL tokens that back the compressed versions.

For major tokens on mainnet, the pool already exists. You only need this for new or custom tokens.

#### Compressing SPL Tokens

```dart
final ix = CompressedTokenProgram.compress(
  payer: payerPubkey,
  owner: ownerPubkey,
  source: splAtaAddress,           // Your SPL token account
  mint: usdcMint,
  amount: BigInt.from(100000000),  // 100 USDC (6 decimals)
  outputStateTreeInfo: treeInfo,
  tokenPoolInfo: tokenPoolInfo,
);
```

SPL tokens transfer from `source` to the token pool. A compressed token account is created with `{mint, owner, amount}`.

#### Transferring Compressed Tokens

```dart
// Select accounts (same pattern as SOL)
final (selected, total) = selectMinCompressedTokenAccountsForTransfer(
  tokenAccounts, amount, (a) => a.parsed.amount,
);

// Get proof
final proof = await rpc.getValidityProof(
  hashes: selected.map((a) => a.compressedAccount.hash).toList(),
);

// Build instruction
final ix = CompressedTokenProgram.transfer(
  payer: payerPubkey,
  inputCompressedTokenAccounts: selected,
  toAddress: recipientPubkey,
  amount: BigInt.from(50000000),
  recentInputStateRootIndices: proof.rootIndices,
  recentValidityProof: proof.compressedProof,
);
```

Token transfers consume input compressed token accounts and produce new ones, same UTXO model as compressed SOL. Change accounts are created automatically.

#### Decompressing Back to SPL

```dart
final ix = CompressedTokenProgram.decompress(
  payer: payerPubkey,
  inputCompressedTokenAccounts: selected,
  toAddress: splAtaAddress,            // SPL ATA to receive tokens
  amount: BigInt.from(50000000),
  recentInputStateRootIndices: proof.rootIndices,
  recentValidityProof: proof.compressedProof,
  tokenPoolInfo: tokenPoolInfo,
);
```

Tokens transfer from the pool back to the SPL ATA. The compressed accounts are consumed.

> **GOTCHA**: The `toAddress` for decompressing tokens must be an SPL token account (ATA), not a wallet address. If the ATA does not exist, you need to create it first with `createAssociatedTokenAccountInstruction()` in the same transaction.

#### Delegation

```dart
// Approve a delegate to spend your compressed tokens
final approveIx = CompressedTokenProgram.approve(
  payer: payerPubkey,
  inputCompressedTokenAccounts: selected,
  delegate: delegatePubkey,
  amount: BigInt.from(100000000),
  recentInputStateRootIndices: proof.rootIndices,
  recentValidityProof: proof.compressedProof,
);

// Revoke delegation
final revokeIx = CompressedTokenProgram.revoke(
  payer: payerPubkey,
  inputCompressedTokenAccounts: selected,
  recentInputStateRootIndices: proof.rootIndices,
  recentValidityProof: proof.compressedProof,
);
```

### Error Handling

The SDK defines specific exception types for compression-related failures:

```dart
try {
  final sig = await transfer(rpc: rpc, payer: wallet, ...);
} on InsufficientBalanceException catch (e) {
  // Not enough compressed SOL/tokens
  print('Need ${e.required}, have ${e.available}');
} on TransactionFailedException catch (e) {
  // Transaction landed but failed (program error)
  print('${e.code}: ${e.message}');
} on TransactionTimeoutException catch (e) {
  // Transaction did not confirm in time
  print('Timeout: ${e.message}');
} on ProofGenerationError catch (e) {
  // Prover could not generate proof (usually stale state)
  print('Proof error: ${e.message}');
} on ProverUnavailableError catch (e) {
  // Prover server is down
  print('Prover down: ${e.message}');
} on LightException catch (e) {
  // Generic Light Protocol error
  print('${e.functionName}: ${e.code} - ${e.message}');
}
```

The most common failure in production is `TransactionFailedException` with an "invalid proof" error. This happens when:

1. The account state changed between `getCompressedAccountsByOwner()` and transaction submission (another transaction consumed the same account)
2. The root expired (too much time between `getValidityProof()` and submission)
3. The indexer returned stale state (not caught up to the latest slot)

The fix for all three is the same: re-fetch accounts, get a new proof, rebuild the transaction, and retry.

### Borsh Encoding: What Gets Serialized

Every instruction's `data` field is Borsh-encoded. The `BorshWriter` class handles this:

```dart
final writer = BorshWriter();
writer.writeU8(value);               // 1 byte
writer.writeU16(value);              // 2 bytes, little-endian
writer.writeU32(value);              // 4 bytes, little-endian
writer.writeU64(bigInt);             // 8 bytes, little-endian
writer.writeFixedArray(bytes);       // Fixed-size byte array (no length prefix)
writer.writeVec(bytes);              // Vec<u8>: 4-byte length prefix + bytes
writer.writeBool(value);             // 1 byte (0x00 or 0x01)
writer.writeOption(value, encoder);  // 1-byte discriminant (0/1) + optional value
final bytes = writer.toBytes();
```

The most interesting encoding is the `Option` type. In Borsh, `Option<T>` is encoded as:
- `0x00` if None (1 byte total)
- `0x01 + T` if Some (1 byte + sizeof(T))

This shows up in `InstructionDataInvoke.encode()` for optional fields like `proof`, `relayFee`, and `compressOrDecompressLamports`:

```dart
// Option<CompressedProof>
writer.writeOption<CompressedProof>(proof, (p) {
  writer.writeFixedArray(p.a);   // 32 bytes
  writer.writeFixedArray(p.b);   // 64 bytes
  writer.writeFixedArray(p.c);   // 32 bytes
});
// If proof is null: writes 0x00 (1 byte)
// If proof exists: writes 0x01 + 128 bytes = 129 bytes
```

The complete instruction data layout for `InstructionDataInvoke`:

```
┌─────────────────────────────────────────────────┐
│ 8-byte discriminator                             │
│ Option<CompressedProof>          (1 or 129 bytes)│
│ Vec<PackedInputAccount>          (4 + n*~80)     │
│ Vec<PackedOutputAccount>         (4 + n*~40)     │
│ Option<u64> relay_fee            (1 or 9)        │
│ Vec<NewAddressParams>            (4 + n*~40)     │
│ Option<u64> compress_lamports    (1 or 9)        │
│ bool is_compress                 (1)             │
└─────────────────────────────────────────────────┘
```

The on-chain program reads this byte-by-byte in the same order. If even one byte is off, the remaining deserialization produces garbage, and the transaction fails with an obscure error. This is why the SDK pre-computes discriminators as constants rather than computing them at runtime.

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Calling `getValidityProof()` and then doing slow work before submitting | Root expires after ~40 seconds | Prepare everything first, then call proof + submit back-to-back |
| Not checking for pagination in `getCompressedAccountsByOwner()` | Default limit is low, might miss accounts | Check `cursor` in response, loop until all pages fetched |
| Using `compress()` action with external signer | Actions take `Ed25519HDKeyPair`, not arbitrary signers | Use `LightSystemProgram.compress()` and handle signing yourself |
| Setting compute units too low | Fails with "compute budget exceeded" | Use the recommended CU values: 1M for compress/decompress, 350K for transfer |
| Decompressing tokens to wallet address instead of ATA | `toAddress` must be an SPL token account for token decompress | Create ATA first with `createAssociatedTokenAccountInstruction()` |
| Retrying failed proof immediately | The underlying state is likely the same | Re-fetch accounts first, then get new proof, then retry |

## Related

- [State, Trees, and Proofs](state-trees-and-proofs.md) — The data types used in queries and instructions
- [SDK Architecture](sdk-architecture.md) — How RPC, Programs, and Actions layers are organized
- [Mobile Integration Patterns](mobile-integration.md) — How a real Flutter app wires this together
