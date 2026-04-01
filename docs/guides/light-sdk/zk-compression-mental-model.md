# ZK Compression Mental Model

> Before touching `light_sdk`, you need to understand what ZK compression actually does to Solana's account model — why compressed accounts exist, how they are organized, and what the trade-offs are.

## Overview

Solana's normal account model is straightforward: every account is a blob of bytes stored on-chain, identified by a 32-byte public key, owned by a program. You pay rent for every byte stored. At current rates, a single SPL token account costs about 0.002 SOL in rent-exemption deposit. That is fine for DeFi power users. It is not fine for a mobile app trying to onboard a million people.

ZK compression rewrites the cost equation. Instead of storing each account's data on-chain, you store only a *hash* of the data as a leaf in a Merkle tree. The tree's root hash — a single 32-byte value summarizing the state of potentially millions of accounts — lives on-chain. The actual account data lives in transaction calldata (recorded in the Solana ledger forever) and in an off-chain indexer that makes it queryable.

When you want to modify a compressed account, you prove you know the current data (by providing it alongside a ZK proof that it hashes to a leaf in the tree), then submit a new version. The on-chain program verifies the proof, nullifies the old leaf, and inserts a new one.

The result: storing a compressed account costs about 100 lamports instead of 2,000,000 lamports. That is the 1000x cost reduction Light Protocol talks about.

## Quick Start

You do not interact with Merkle trees directly. The SDK abstracts them. But here is the minimum you need to know to make sense of the API:

```dart
// A compressed account is identified by its hash, not a public key
final account = await rpc.getCompressedAccount(hash: someHash);
print(account.lamports); // SOL balance
print(account.owner);    // Owning program
print(account.hash);     // BN254 field element — the leaf in the tree

// To prove this account is real, you need a validity proof
final proof = await rpc.getValidityProof(hashes: [account.hash]);
// This proof says: "this hash exists as a leaf in tree X at index Y"

// To modify the account, you submit the current data + proof + new data
// The on-chain program verifies, nullifies old leaf, writes new leaf
```

That is the mental model: **read from indexer, prove with ZK proof, modify on-chain**.

## Core Concepts

### Why Not Just Use Regular Accounts?

The answer is always cost. Here are the real numbers:

| Operation | Regular account cost | Compressed account cost |
|-----------|---------------------|------------------------|
| Store a token account | ~2,039,280 lamports (rent-exempt) | ~100 lamports (tree append fee) |
| Store 1,000 token accounts | ~2 SOL | ~0.0001 SOL |
| Store 1,000,000 token accounts | ~2,039 SOL | ~0.1 SOL |
| Airdrop to 100K wallets | ~204 SOL (rent) + tx fees | ~0.01 SOL + tx fees |

The cost difference is not marginal. It changes what kinds of applications are economically viable on Solana.

> **WHY THIS MATTERS**: If you are building a consumer app — airdrops, loyalty points, in-game items, social tokens — regular accounts make the numbers impossible. ZK compression makes them work. That is why this SDK exists.

### Compressed Accounts Are Not Accounts

This is the first thing to internalize. A compressed account is *not* a Solana account in the runtime sense. It does not have a public key that the Solana runtime can look up. It does not exist in the account database. It is a *convention* enforced by Light Protocol's on-chain programs.

What actually exists on-chain:

1. **State tree accounts** — Regular Solana accounts that hold the Merkle tree root and metadata
2. **Queue accounts** — Regular Solana accounts that hold pending nullifications
3. **Program accounts** — The Light System Program, Account Compression Program, etc.

That is it. The "compressed accounts" themselves are data structures that exist in transaction history and in the indexer's database. When someone says "I have a compressed account with 1 SOL," what they mean is:

- There is a leaf in a state tree whose hash matches the hash of `{owner: system_program, lamports: 1_000_000_000, address: null, data: null}`
- The indexer has recorded this leaf and can tell you about it
- A ZK proof can demonstrate that this leaf is part of the current tree root

### The Merkle Tree: Where State Actually Lives

Light Protocol uses a *forest* of concurrent Merkle trees. Each tree has a fixed height that determines how many leaves it can hold:

| Tree Version | Height | Max Leaves | Used For |
|-------------|--------|------------|----------|
| State V1 | 26 | ~67 million | Compressed account hashes |
| State V2 | 32 | ~4 billion | Compressed account hashes (newer, more efficient) |
| Address V1 | 26 | ~67 million | Unique address tracking |
| Address V2 | 40 | ~1 trillion | Unique address tracking (newer) |

When you create a compressed account, the SDK appends its hash as a new leaf to one of these trees. When you modify it, the old leaf is nullified (set to zero eventually) and a new leaf is appended.

This is fundamentally different from regular Solana accounts, which are modified in-place. Compressed accounts follow an **append-only** pattern: old state is invalidated, new state is appended.

#### How a Leaf Is Computed

The leaf hash for a compressed account is not a simple SHA256 of the data. It is a structured hash that includes everything the on-chain program needs to verify:

```
Leaf = Hash(
  DataHash,           // Hash of account data (or zeros if no data)
  Lamports,           // SOL balance as u64 bytes
  OwnerHash,          // Hash of the owner's public key
  Address,            // Optional 32-byte persistent identifier
  Discriminator,      // 8-byte type tag (for programs that need it)
  StateTreeHash,      // Public key of the tree this leaf belongs to
  LeafIndex,          // Position in the tree (u32)
)
```

This structure means that *any* change to the account — even adding 1 lamport — produces a different hash and therefore a different leaf. That is why compressed transfers consume old leaves and produce new ones rather than updating in place.

> **GOTCHA**: The hashing uses the BN254 elliptic curve field, not SHA256 or Keccak256 directly. The result must be a valid element of the BN254 scalar field (less than the field modulus). The SDK handles this by zeroing the most significant byte of the Keccak256 output. This is why `BN254` is a core type in the SDK — it is not just "a hash," it is a hash constrained to a specific mathematical field.

### The Indexer: Making Compressed State Queryable

Since compressed account data is not stored in Solana's account database, you cannot query it with standard RPC calls like `getAccountInfo()`. You need a specialized indexer.

**Photon** is the canonical ZK Compression indexer, built by Helius. It:

1. Processes every Solana transaction from genesis
2. Detects Light Protocol instruction events
3. Reconstructs the current state of all compressed accounts
4. Maintains a copy of the full Merkle trees
5. Exposes a JSON-RPC API for querying compressed state

When your Flutter app calls `rpc.getCompressedAccountsByOwner(walletPubkey)`, the SDK sends a request to the Photon API, which scans its database for all current (non-nullified) compressed accounts owned by that public key.

The Photon API is accessed through the same Helius RPC endpoint you use for standard Solana RPC. The SDK routes compression-specific methods (like `getCompressedAccount`) to the compression API and standard methods (like `getBalance`) to the regular Solana RPC. From the caller's perspective, it is one connection.

### The Prover: Why ZK Proofs Are Involved

When you want to spend or modify a compressed account, you need to prove two things to the on-chain program:

1. **Inclusion proof**: "This account exists in the Merkle tree at this position"
2. **Non-inclusion proof** (for new addresses): "This address does not already exist in the address tree"

You *could* provide a raw Merkle proof — a list of sibling hashes from the leaf up to the root. But a Merkle proof for a tree of height 26 would be 26 × 32 = 832 bytes. For multiple accounts in one transaction, you would quickly exceed Solana's 1,232-byte transaction size limit.

ZK proofs solve this. Instead of sending the full Merkle path, you send a **Groth16 SNARK proof** that is exactly 128 bytes, regardless of how many accounts it covers:

| Component | Size |
|-----------|------|
| `a` | 32 bytes |
| `b` | 64 bytes |
| `c` | 32 bytes |
| **Total** | **128 bytes** |

This proof says: "I know Merkle paths that prove these N accounts exist (and these M addresses do not exist), but I am not going to show you the paths — here is a cryptographic proof that I know them."

The prover server generates this proof. It takes the account hashes, their Merkle paths, and the tree roots, and runs them through the Groth16 proving system. The on-chain program verifies the proof using the on-chain verifier, which is fast (a few thousand compute units).

#### When You Need a Proof (and When You Don't)

| Operation | Needs proof? | Why |
|-----------|-------------|-----|
| Compress SOL | No | You are creating a new leaf. No existing state to prove. |
| Transfer compressed SOL | Yes | You are consuming existing leaves and creating new ones. Must prove the old leaves exist. |
| Decompress SOL | Yes | You are consuming existing leaves. Must prove they exist. |
| Create compressed account | Depends | If the account has an address, you need a non-inclusion proof for that address. If no address, no proof needed. |

This explains a common confusion in the SDK: `compress()` does not call `getValidityProof()`, but `transfer()` does. The reason is purely about whether existing state is being consumed.

### The Transaction Flow: What Actually Happens

Here is the complete flow for a compressed SOL transfer, step by step:

```
1. Flutter app calls transfer(rpc, payer, owner, lamports, toAddress)
   │
2. SDK calls rpc.getCompressedAccountsByOwner(owner)
   │  → Photon API returns list of compressed accounts
   │
3. SDK calls selectMinCompressedSolAccountsForTransfer(accounts, amount)
   │  → Picks minimum accounts whose total >= transfer amount
   │
4. SDK calls rpc.getValidityProof(hashes: selectedHashes)
   │  → Photon fetches Merkle paths for each account
   │  → Prover generates Groth16 proof covering all paths
   │  → Returns: CompressedProof (128 bytes) + root indices + tree info
   │
5. SDK calls LightSystemProgram.transfer(...)
   │  → packCompressedAccounts(): converts tree pubkeys to index pointers
   │  → InstructionDataInvoke.encode(): Borsh-serializes everything
   │  → Returns: Instruction with program ID, account metas, encoded data
   │
6. SDK calls buildAndSignTransaction(instructions, computeLimit: 350000)
   │  → Adds ComputeBudget instructions
   │  → Fetches recent blockhash
   │  → Signs with payer (and owner if different)
   │
7. SDK calls sendAndConfirmTransaction(signedTx)
   │  → Submits to Solana
   │  → Waits for confirmation
   │
8. On-chain: Light System Program
   │  → Verifies the ZK proof against current tree roots
   │  → Nullifies input leaves (marks old accounts as spent)
   │  → Appends new leaves (recipient account + change account)
   │  → Emits events that the indexer picks up
   │
9. Indexer (Photon) sees the events
   │  → Marks old compressed accounts as nullified
   │  → Creates new compressed account records
   │  → Updates tree roots in its database
   │
10. Next query to getCompressedAccountsByOwner() reflects the new state
```

This is the same fundamental flow for every compressed operation. The differences are in which instruction is used and whether a proof is needed.

### Nullification: How State Gets "Deleted"

Compressed accounts are not deleted immediately. When a transaction consumes a compressed account (as an input to a transfer or decompress), the leaf is *nullified*:

1. The leaf's hash is added to a **nullifier queue** (a regular Solana account)
2. The on-chain program marks the root index as consumed
3. A background process called a **forester** periodically empties the nullifier queue by setting the corresponding tree leaves to zero

This design means:

- **Finality is instant**: The moment the transaction confirms, the old account is effectively spent. No one can use it again because the proof would reference a consumed root index.
- **Tree cleanup is async**: The actual zero-writing into the tree happens later. This is fine because the nullifier queue prevents double-spending.
- **Liveness depends on foresters**: If the nullifier queue fills up and no forester processes it, new transactions that target that tree will fail. In practice, Helius runs foresters for mainnet trees.

> **GOTCHA**: If you are testing on devnet and your transactions start failing with "queue full" errors, it means no forester is running for that tree. On mainnet, this is not an issue because infrastructure operators run foresters continuously.

### Tree Rollover: When Trees Fill Up

Each tree has a maximum capacity. When a V1 state tree reaches ~67 million leaves, it rolls over:

1. A new state tree account is created with the same configuration
2. The old tree's metadata is updated to point to the new tree
3. New compressed accounts are appended to the new tree
4. The old tree remains readable (for inclusion proofs on existing accounts)

The SDK handles this transparently. When you call `rpc.getStateTreeInfos()`, the response includes the active tree and any "next tree" for rollover. The `selectStateTreeInfo()` utility picks the best tree. The `packCompressedAccounts()` function uses `treeInfo.nextTreeInfo` when available.

You do not need to think about tree rollover unless you are building infrastructure.

### Address Trees: Optional Persistent Identifiers

Regular compressed accounts are identified by their hash, which changes every time the account is modified. This is fine for fungible balances (you do not care *which* UTXO you are spending), but it is a problem for accounts that need a stable identifier — like a user profile, a game character, or a program-owned data account.

**Address trees** solve this. They are indexed Merkle trees that track which addresses have been used. When you create a compressed account with an `address` field, the protocol:

1. Derives a 32-byte address (using Keccak256 + BN254 field truncation)
2. Proves the address does not already exist (non-inclusion proof against the address tree)
3. Inserts the address into the address tree
4. Attaches the address to the compressed account

From then on, you can query the account by its address instead of by its (changing) hash.

The address derivation is similar to Solana PDAs but uses a different hash function:

```dart
// Solana PDA: SHA256(seeds + program_id + "ProgramDerivedAddress")
// Compressed address: Keccak256(program_id + seeds) truncated to BN254 field

final seed = deriveAddressSeed(
  seeds: [Uint8List.fromList('user_profile'.codeUnits), userPubkey.bytes],
  programId: myProgramId,
);
final address = deriveAddress(seed: seed, addressMerkleTreePubkey: treeId);
```

> **WHY THIS MATTERS**: If you are building anything that stores per-user state in compressed accounts, you need address trees to give those accounts stable identifiers. Without addresses, you can only find accounts by scanning all accounts for a given owner — which works, but does not let you reference a specific account by ID.

## Patterns & Recipes

### Pattern: The UTXO Mental Model

If you have used Bitcoin, compressed SOL transfers will feel familiar. Regular Solana accounts are like bank accounts — you have one balance that gets incremented and decremented. Compressed accounts are like cash — you have individual "bills" (UTXOs) that get consumed and created.

When you compress 1 SOL, you get a compressed account with 1,000,000,000 lamports. When you transfer 0.3 SOL from it, the SDK:

1. Consumes the 1 SOL account (input)
2. Creates a 0.3 SOL account for the recipient (output)
3. Creates a 0.7 SOL account for you (change output)

Now you have one compressed account with 700,000,000 lamports instead of the original 1,000,000,000. If you transfer 0.3 SOL again, you get another change account with 400,000,000 lamports. Over time, repeated transfers fragment your balance across multiple compressed accounts.

The `selectMinCompressedSolAccountsForTransfer()` utility handles this. It sorts your accounts by balance (descending) and picks the minimum set whose total exceeds the transfer amount. This minimizes the number of input accounts per transaction, which matters because each input account adds to the proof size and compute cost.

### Pattern: Compression Is a One-Way Bridge (Sort Of)

Compressing SOL is like moving money into a different account system. The SOL is held in a **SOL pool PDA** owned by the Light System Program. When you compress, your SOL transfers to this pool. When you decompress, it transfers back from the pool.

```
[Your wallet] --compress--> [SOL Pool PDA] --recorded as--> [Compressed Account leaf in tree]
[Compressed Account] --decompress--> [SOL Pool PDA] --transfers to--> [Your wallet]
```

This means the regular `getBalance()` on your wallet will show *less* SOL after compressing, even though you still "own" it. The compressed balance is only visible through `getCompressedBalanceByOwner()`.

### Pattern: Tokens Work The Same Way, But With Token Pools

Compressed tokens follow the same pattern as compressed SOL, but with a twist: there is a **token pool** for each SPL mint. The pool is a regular SPL token account owned by the Compressed Token Program.

When you compress 100 USDC:
1. 100 USDC transfers from your SPL token account to the token pool
2. A compressed token account is created with `{mint: USDC, amount: 100, owner: you}`

When you decompress:
1. The compressed token account is consumed
2. 100 USDC transfers from the token pool back to your SPL token account (or ATA)

The token pool must exist before you can compress tokens. For major tokens (USDC, SOL, popular mints), the pool already exists on mainnet. For new tokens, someone needs to call `CompressedTokenProgram.createSplInterface()` first.

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Querying compressed state right after a transaction | The indexer needs 1-3 seconds to process the event | Retry with exponential backoff: 2s, 3s, 4s |
| Assuming compressed accounts have public keys | They are identified by hash (which changes on modification) | Use `BN254` hashes, or assign an `address` for stable IDs |
| Passing a V2 tree reference where V1 is expected | V2 trees use the queue pubkey for output routing, V1 uses the tree pubkey | Let `packCompressedAccounts()` handle it — it checks `treeType` |
| Ignoring change accounts | A 1 SOL account transferred partially becomes 2 accounts | The SDK creates change accounts automatically |
| Not handling proof expiry | Root indices expire after ~100 slots (~40 seconds) | Minimize time between `getValidityProof()` and transaction submission |

## Related

- [SDK Architecture](sdk-architecture.md) — How the Dart SDK maps these concepts into code
- [State, Trees, and Proofs](state-trees-and-proofs.md) — The data structures in detail
- [Light Protocol docs](https://www.zkcompression.com/) — Official protocol documentation
- [Solana account model](https://docs.solanalabs.com/developing/programming-model/accounts) — How regular Solana accounts work (for contrast)
