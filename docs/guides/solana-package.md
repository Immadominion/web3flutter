# The `solana` Package — Solana's Complete Dart SDK

> The foundation of every Solana Flutter app. 52 RPC methods, Ed25519 key management, transaction building, WebSocket subscriptions, 6 built-in program helpers, Metaplex NFT support, and Solana Pay — all in pure Dart.

## Overview

The `solana` package (v0.31.2, maintained by the Espresso Cash team) is the most complete Dart SDK for Solana. It's not a thin wrapper around JSON-RPC — it implements the full client stack: key derivation from mnemonics, transaction compilation (legacy and v0), Ed25519 signing, binary message encoding, WebSocket subscriptions, and typed helpers for Solana's core programs.

Every other Solana Dart package — `coral_xyz`, `solana_mobile_client`, the Espresso Cash app itself — builds on top of this one. Understanding its internals means understanding how Solana works at the wire level.

**Dependencies**: `bip39` (mnemonics), `cryptography` (Ed25519), `ed25519_hd_key` (SLIP-0010 HD derivation), `borsh_annotation` (binary serialization), `http` (RPC), `web_socket_channel` (subscriptions), `freezed_annotation` (immutable types).

---

## Quick Start

```dart
import 'package:solana/solana.dart';

// Create a client
final client = SolanaClient(
  rpcUrl: Uri.parse('https://api.devnet.solana.com'),
  websocketUrl: Uri.parse('wss://api.devnet.solana.com'),
);

// Generate a keypair from a mnemonic
final wallet = await Ed25519HDKeyPair.fromMnemonic(
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  account: 0,
  change: 0,
);

// Check balance
final balance = await client.rpcClient.getBalance(wallet.address);
print('${balance.value / lamportsPerSol} SOL');  // lamportsPerSol = 1000000000

// Transfer SOL
await client.transferLamports(
  source: wallet,
  destination: Ed25519HDPublicKey.fromBase58('target_address_here'),
  lamports: 100000000, // 0.1 SOL
  commitment: Commitment.confirmed,
);
```

---

## Core Concepts

### The Account Model

Solana doesn't have "contracts with storage." Every piece of data is an **account** — your wallet, a token balance, a program's state, the program code itself.

```
┌─────────────────────────────────────────┐
│              Solana Account              │
├──────────────┬──────────────────────────┤
│ public key   │ The account's address    │
│ lamports     │ SOL balance (1B = 1 SOL) │
│ owner        │ Program that controls it │
│ data         │ Arbitrary bytes          │
│ executable   │ Is this a program?       │
└──────────────┴──────────────────────────┘
```

Accounts cost **rent** — you deposit SOL up front to keep them alive. An account with enough SOL to cover 2 years of storage (the "rent-exempt" minimum) stays alive indefinitely. Drop below that, and the runtime garbage-collects it.

When you call `getAccountInfo`, this is exactly what comes back. The `data` field is raw bytes — making sense of those bytes is where Borsh serialization comes in.

### RPC Client — 52 JSON-RPC Methods

`RpcClient` speaks JSON-RPC 2.0 over HTTP to a Solana validator. The class is **code-generated** from an annotated abstract definition using the `jsonrpc_client` build tool — this is why you see a generated `client.rpc.dart` file.

```dart
final rpc = RpcClient('https://api.devnet.solana.com');

// Accounts
final account = await rpc.getAccountInfo(address);
final balance = await rpc.getBalance(address);
final programAccounts = await rpc.getProgramAccounts(programId);
final multiple = await rpc.getMultipleAccounts([addr1, addr2]);

// Transactions
final sig = await rpc.sendTransaction(base64EncodedTx);
final result = await rpc.simulateTransaction(base64EncodedTx);
final sigs = await rpc.getSignaturesForAddress(address, limit: 10);

// Tokens
final tokenBalance = await rpc.getTokenAccountBalance(tokenAccount);
final tokenAccounts = await rpc.getTokenAccountsByOwner(owner, mint: mint);
final supply = await rpc.getTokenSupply(mint);

// Network state
final blockhash = await rpc.getLatestBlockhash();
final slot = await rpc.getSlot();
final epochInfo = await rpc.getEpochInfo();
final rent = await rpc.getMinimumBalanceForRentExemption(165); // bytes → lamports
```

Full method inventory: `getAccountInfo`, `getBalance`, `getBlock`, `getBlockHeight`, `getBlockProduction`, `getBlockCommitment`, `getBlocks`, `getBlocksWithLimit`, `getBlockTime`, `getClusterNodes`, `getEpochInfo`, `getEpochSchedule`, `getFeeForMessage`, `getFirstAvailableBlock`, `getGenesisHash`, `getHealth`, `getHighestSnapshotSlot`, `getIdentity`, `getInflationGovernor`, `getInflationRate`, `getInflationReward`, `getLargestAccounts`, `getLatestBlockhash`, `getLeaderSchedule`, `getMaxRetransmitSlot`, `getMaxShredInsertSlot`, `getMinimumBalanceForRentExemption`, `getMultipleAccounts`, `getProgramAccounts`, `getRecentPerformanceSamples`, `getSignaturesForAddress`, `getSignatureStatuses`, `getSlot`, `getSlotLeader`, `getSlotLeaders`, `getStakeMinimumDelegation`, `getSupply`, `getTokenAccountBalance`, `getTokenAccountsByDelegate`, `getTokenAccountsByOwner`, `getTokenLargestAccounts`, `getTokenSupply`, `getTransaction`, `getTransactionCount`, `getVersion`, `getVoteAccounts`, `isBlockhashValid`, `minimumLedgerSlot`, `requestAirdrop`, `sendTransaction`, `simulateTransaction`.

**The HTTP layer**: Each method serializes parameters into a JSON-RPC 2.0 request, sends it via `http.post()`, and deserializes the response into typed Dart objects. All response DTOs are code-generated with `freezed` and `json_serializable`. Errors surface as `JsonRpcException` with detailed error codes (from `-32001` through `-32016`) including `preflightFailure`, `signatureVerificationFailure`, `nodeUnhealthy`, etc.

**Batch requests**: `bulkRequest()` sends multiple JSON-RPC calls in a single HTTP POST. The server returns all responses in one payload.

> **WHY THIS MATTERS**: The RPC client is code-generated, not hand-written. This means every Solana JSON-RPC method has proper typing, parameter validation, and response parsing. The 100+ DTO types (`AccountInfo`, `TransactionDetail`, `BlockCommitment`, etc.) are all `@freezed` — immutable, with equality, `copyWith`, and JSON round-tripping out of the box.

### SolanaClient — The High-Level Orchestrator

`SolanaClient` composes `RpcClient` + `SubscriptionClient` and adds orchestrated workflows:

```dart
final client = SolanaClient(
  rpcUrl: Uri.parse('https://api.devnet.solana.com'),
  websocketUrl: Uri.parse('wss://api.devnet.solana.com'),
  timeout: Duration(seconds: 30),
);
```

The critical method is `sendAndConfirmTransaction`:

1. Fetches latest blockhash via `rpcClient.getLatestBlockhash()`
2. Compiles the `Message` into a `CompiledMessage` with the blockhash
3. Signs with all provided `Ed25519HDKeyPair` signers
4. Calls `onSigned` callback with the first signature (for optimistic UI)
5. Sends via `rpcClient.sendTransaction(tx.encode())`
6. Opens a WebSocket, subscribes to the signature, waits for target confirmation status
7. Returns the transaction ID (first signature as base58)

The extension methods on `SolanaClient` provide ready-to-use flows for SOL transfers (`transferLamports`), airdrops (`requestAirdrop`), token operations (`getMint`, `mintTo`, `transferSplToken`), ATA management, and Solana Pay.

---

### Ed25519 Key Derivation

The crypto layer implements BIP39 mnemonics → SLIP-0010 HD key derivation → Ed25519 keypairs.

```dart
// Standard Solana path: m/44'/501'/0'/0'
final wallet = await Ed25519HDKeyPair.fromMnemonic(
  'word1 word2 ... word12',
  account: 0,  // third segment
  change: 0,   // fourth segment
);

// From raw private key (32 bytes)
final wallet = await Ed25519HDKeyPair.fromPrivateKeyBytes(privateKey: bytes);

// Random (generates new keypair — NOT recoverable without the privkey)
final wallet = await Ed25519HDKeyPair.random();
```

**The derivation path logic**:

| Parameters | Path generated |
|-----------|---------------|
| `account: null, change: null` | `m/44'/501'` |
| `account: 0, change: null` | `m/44'/501'/0'` |
| `account: 0, change: 0` | `m/44'/501'/0'/0'` |
| `account: 2, change: 1` | `m/44'/501'/2'/1'` |

> **CRITICAL**: If a user imports their Phantom mnemonic into your app and you use the wrong path, you'll derive a valid keypair — but it won't be *their* keypair. Their funds appear missing. Phantom uses `m/44'/501'/0'/0'` (account=0, change=0). Solflare defaults to `m/44'/501'/0'` (no change index). This is the #1 wallet import bug.

**Signing**: `Ed25519HDKeyPair.signMessage()` takes a `Message` and `recentBlockhash`, compiles to bytes, signs with `Ed25519` (from the `cryptography` package), and returns a `SignedTx`. The private key lives in `Ed25519HDKeyPairData` which wraps `SensitiveBytes` — it has a `destroy()` method for zeroing the key from memory when done.

### Ed25519HDPublicKey — Addresses and PDAs

```dart
final pubkey = Ed25519HDPublicKey.fromBase58('So11111111111111111111111111111111111111112');
final bytes = pubkey.bytes;     // Uint8List, 32 bytes
final addr = pubkey.toBase58(); // base58 string
```

**PDA derivation**:

```dart
final pda = await Ed25519HDPublicKey.findProgramAddress(
  seeds: [
    'vault'.codeUnits,        // UTF-8 bytes of "vault"
    userPubkey.bytes,          // 32 bytes of user's key
  ],
  programId: programId,
);
// Returns an Ed25519HDPublicKey — the bump is tried 255→0 internally
```

The implementation concatenates `seeds + [bump] + programId + "ProgramDerivedAddress"`, SHA256-hashes it, and checks the result is NOT on the Ed25519 curve via `isPointOnEd25519Curve()`. This curve check is implemented in **pure Dart** — the package includes a full `curve25519` library (`FieldElement`, `EdwardsPoint`, `CompressedEdwardsY`) specifically for this purpose.

> **WHY THIS MATTERS**: The pure-Dart curve25519 exists solely for PDA validation. It decompresses a 32-byte point into extended coordinates and checks if it's a valid Ed25519 point. If it is, the PDA is invalid (bumps to next value). This is why PDA derivation is `async` — it may iterate through many bump values, each requiring a SHA256 hash and curve check.

---

### Transaction Building

Transactions are assembled from `Message` objects containing `Instruction` lists:

```dart
// Build a message
final message = Message(instructions: [
  SystemInstruction.transfer(
    fundingAccount: sender.publicKey,
    recipientAccount: receiver,
    lamports: 1000000000,
  ),
  MemoInstruction(signers: [sender.publicKey], memo: 'pizza money'),
]);

// Compile + sign (legacy)
final compiled = message.compile(
  recentBlockhash: blockhash,
  feePayer: sender.publicKey,
);
final signedTx = await sender.signMessage(
  message: message,
  recentBlockhash: blockhash,
);

// Send
final txId = await rpc.sendTransaction(signedTx.encode());
```

**Instruction anatomy**:

```dart
class Instruction {
  final Ed25519HDPublicKey programId;
  final List<AccountMeta> accounts;
  final ByteArray data;  // program-specific bytes
}
```

**AccountMeta** has `pubKey`, `isWriteable`, and `isSigner`. Ordering matters — signers first, then writable, then read-only — and `compile()` handles this sort automatically.

**Message compilation** packs instructions into a `CompiledMessage` — the wire format sent to the validator:

| Field | Content |
|-------|---------|
| Header | 3 bytes: numSigners, numReadOnlySigned, numReadOnlyUnsigned |
| Account keys | Compact-array of 32-byte public keys (deduplicated, ordered) |
| Recent blockhash | 32-byte hash |
| Instructions | Compact-array of compiled instructions (program index + account indices + data) |

Two compilation modes: `compile()` for legacy transactions and `compileV0()` for versioned transactions with address lookup tables.

**Versioned transactions (v0)**: The `CompiledMessage` union has `.legacy(...)` and `.v0(...)` variants. V0 messages include `addressTableLookups` — references to on-chain lookup tables that expand the account list without bloating the transaction. Detection is automatic from the first byte: legacy messages start with a number ≤ 127, v0 starts with `0x80`.

### WebSocket Subscriptions

`SubscriptionClient` connects to a validator's WebSocket endpoint for real-time notifications:

```dart
final subClient = client.createSubscriptionClient();

// Account changes
final stream = await subClient.accountSubscribe(
  address,
  commitment: Commitment.confirmed,
);
stream.listen((account) => print('Balance: ${account.lamports}'));

// Transaction logs
final logStream = await subClient.logsSubscribe(
  LogsFilter.mentions(pubKeys: [programId]),
);

// Signature confirmation (one-shot — auto-unsubscribes after first notification)
final confirmStream = await subClient.signatureSubscribe(signature);

// Slot updates
final slotStream = await subClient.slotSubscribe();
```

Six subscription types: `accountSubscribe`, `logsSubscribe`, `programSubscribe`, `signatureSubscribe`, `slotSubscribe`, `rootSubscribe`. Each returns a `Stream`. Cancelling the stream listener auto-sends the corresponding `*Unsubscribe` RPC call.

The WebSocket URL is derived from the RPC URL: `http://` → `ws://`, port 8899 → 8900 for local validators.

---

### Built-in Program Helpers (6 Programs)

The package includes typed instruction builders for Solana's core programs:

#### SystemProgram (`11111111111111111111111111111111`)

```dart
SystemInstruction.transfer(
  fundingAccount: sender,
  recipientAccount: receiver,
  lamports: 1000000000,
);

SystemInstruction.createAccount(
  fundingAccount: payer,
  newAccount: newKeypair.publicKey,
  lamports: rentExemptBalance,
  space: 165,  // account data size in bytes
  owner: TokenProgram.id,
);
```

Also: `assign`, `createAccountWithSeed`, `advanceNonceAccount`, `withdrawNonceAccount`, `initializeNonceAccount`, `authorizeNonceAccount`.

#### TokenProgram (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`)

```dart
TokenInstruction.initializeMint(mint: mint, decimals: 9, mintAuthority: authority);
TokenInstruction.mintTo(mint: mint, destination: ata, amount: 1000, authority: auth);
TokenInstruction.transfer(source: from, destination: to, amount: 500, owner: owner);
TokenInstruction.burn(account: tokenAccount, mint: mint, amount: 100, owner: owner);
TokenInstruction.closeAccount(account: tokenAccount, destination: wallet, owner: owner);
```

Also: `transferChecked`, `approve`, `revoke`, `setAuthority` (with `AuthorityType` enum: `mintTokens`, `freezeAccount`, `accountOwner`, `closeAccount`), `freezeAccount`, `thawAccount`, `syncNative`.

**Token-2022** (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`): Same instruction set plus 17 extension instruction indices (25–41) covering `closeAuthority`, `transferFee`, `confidentialTransfer`, `defaultAccountState`, `reallocate`, `memoTransfer`, `nonTransferable`, `interestBearing`, `cpiGuard`, `permanentDelegate`, `transferHook`, `metadataPointer`, `groupPointer`, `groupMemberPointer`.

#### AssociatedTokenAccountProgram

```dart
final ata = await findAssociatedTokenAddress(owner: wallet, mint: tokenMint);
// Derivation: findProgramAddress([owner, TOKEN_PROGRAM_ID, mint], ATA_PROGRAM_ID)

// Create the ATA if it doesn't exist
AssociatedTokenAccountInstruction.createAccount(
  funder: payer,
  address: ata,
  owner: wallet,
  mint: tokenMint,
);
```

#### ComputeBudgetProgram

```dart
ComputeBudgetInstruction.setComputeUnitLimit(units: 400000);
ComputeBudgetInstruction.setComputeUnitPrice(microLamports: 50000);
ComputeBudgetInstruction.requestHeapFrame(bytes: 256 * 1024);
```

> **GOTCHA**: Priority fees are set via `setComputeUnitPrice` in **micro-lamports per compute unit**. Setting this to 50000 with a 200K CU limit costs 0.01 SOL. Always compute the total cost before sending — `(unitPrice × unitLimit) / 1_000_000` = lamports.

#### StakeProgram

Full staking lifecycle: `initialize`, `delegateStake`, `deactivate`, `withdraw`, `split`, `merge`, `authorize`, `setLockup`. Account space constant: 200 bytes.

#### MemoProgram

```dart
MemoInstruction(signers: [wallet], memo: 'Payment for order #42');
// Max memo size: 566 bytes
```

---

### Metaplex Integration

NFT metadata fetching and parsing:

```dart
final metadata = await rpc.getMetadata(mint: nftMint);
// Reads the metadata PDA → parses binary data → returns Metadata object

print(metadata?.name);     // "Cool NFT #123"
print(metadata?.symbol);   // "COOL"
print(metadata?.uri);      // "https://arweave.net/..."

// Fetch off-chain JSON (image, attributes, etc.)
final offChain = await metadata?.getExternalJson();
print(offChain?.image);        // "https://arweave.net/image.png"
print(offChain?.attributes);   // [{trait_type: "Rarity", value: "Legendary"}]

// Master edition (supply, max supply)
final edition = await rpc.getMasterEdition(mint: nftMint);
print(edition?.supply);     // BigInt — copies minted
print(edition?.maxSupply);  // BigInt? — null if unlimited
```

PDA derivation: `["metadata", metaplexProgramId, mint]` for metadata, `+ "edition"` for master edition. Program ID: `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`.

`Metadata.fromBinary()` parses the raw account bytes: 1 skip byte → updateAuthority (32) → mint (32) → name (length-prefixed) → symbol → uri. The `MasterEdition` is deserialized via Borsh (`@BorshSerializable`).

### Solana Pay

Payment request URLs conforming to the Solana Pay specification:

```dart
// Transfer request (simple: send X SOL/SPL tokens)
final request = SolanaPayRequest(
  recipient: merchantPubkey,
  amount: Decimal.fromInt(1),  // 1 SOL
  label: 'Coffee Shop',
  message: 'Large latte',
  memo: 'order-42',
);
final url = request.toUrl();   // solana:recipient?amount=1&label=Coffee+Shop&...

// Parse from QR code scan
final parsed = SolanaPayRequest.parse(scannedUrl);

// Transaction request (complex: merchant returns a pre-built transaction)
final txRequest = SolanaTransactionRequest(link: Uri.parse('https://merchant.com/pay'));
final info = await txRequest.get();        // GET → label, icon
final response = await txRequest.post(account: wallet.address);  // POST → serialized tx
```

`SolanaClient` extensions handle the full flow: `createSolanaPayMessage` (builds transfer tx with optional SPL token + memo + reference accounts), `sendSolanaPay`, `findSolanaPayTransaction` (searches by reference pubkey), `validateSolanaPayTransaction`.

---

### The Anchor Bridge

Minimal but important — the `anchor.dart` barrel provides discriminator computation for Anchor programs:

```dart
import 'package:solana/anchor.dart';

// Compute an Anchor discriminator
final disc = await computeDiscriminator('global', 'initialize');
// → SHA-256("global:initialize")[0..8] → List<int> of 8 bytes

// Create an Anchor instruction
final ix = await AnchorInstruction.forMethod(
  programId: programId,
  method: 'deposit',
  namespace: 'global',
  accounts: [
    AccountMeta.writeable(pubKey: vault, isSigner: false),
    AccountMeta.readonly(pubKey: user, isSigner: true),
  ],
  arguments: ByteArray.u64(amount),
);
```

`AnchorAccount` is an abstract class with a `discriminator` getter — implement it for typed account deserialization.

> **WHY THIS MATTERS**: This bridge exists so you can interact with Anchor programs using just the `solana` package — without pulling in `coral_xyz`. For simple single-instruction calls, it's lighter. `coral_xyz` builds on top of this for full IDL-driven interaction with auto-resolution, namespaces, and event parsing.

---

## Patterns & Recipes

### Retry with Fresh Blockhash

```dart
Future<String> sendWithRetry(Message message, Ed25519HDKeyPair signer) async {
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.sendAndConfirmTransaction(
        message: message,
        signers: [signer],
        commitment: Commitment.confirmed,
      );
    } on JsonRpcException catch (e) {
      if (e.code == -32002) continue; // BlockhashNotFound — retry with fresh blockhash
      rethrow;
    }
  }
  throw Exception('Transaction failed after 3 attempts');
}
```

### V0 Transactions with Address Lookup Tables

```dart
final compiled = message.compileV0(
  recentBlockhash: blockhash,
  feePayer: wallet.publicKey,
  addressLookupTableAccounts: [lookupTable],
);
final signed = await signV0Transaction(blockhash, message, [wallet],
  addressLookupTableAccounts: [lookupTable],
);
await rpc.sendTransaction(signed.encode());
```

---

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Phantom mnemonic imports to wrong address | Wrong derivation path — `m/44'/501'` vs `m/44'/501'/0'/0'` | Use `account: 0, change: 0` for Phantom compatibility |
| `BlockhashNotFound` error | Transaction built with stale blockhash (>60s old) | Fetch blockhash immediately before signing, or retry |
| RPC timeout on mainnet | Public RPC nodes are rate-limited | Use a dedicated RPC provider (Helius, QuickNode, Triton) |
| Transaction too large | Too many instructions or accounts (max 1232 bytes) | Split into multiple transactions or use v0 with lookup tables |
| `InstructionError` with no useful message | Program returned a custom error code | Check the error's `instructionIndex` and match the code to the program's IDL error list |
| Priority fee unexpectedly high | `setComputeUnitPrice` is micro-lamports per CU, not total | Total cost = `(price × limit) / 1_000_000` lamports |

---

## API Quick Reference

| Type | Purpose |
|------|---------|
| `SolanaClient` | High-level orchestrator — send, confirm, subscribe |
| `RpcClient` | 52 JSON-RPC methods over HTTP |
| `SubscriptionClient` | 6 WebSocket subscription types |
| `Ed25519HDKeyPair` | Keypair — sign transactions, derive from mnemonic |
| `Ed25519HDPublicKey` | Public key — PDA derivation, address validation |
| `Message` | Bundle of instructions — compiles to wire format |
| `Instruction` | Single program call — programId + accounts + data |
| `AccountMeta` | Account reference — pubKey + writable + signer flags |
| `CompiledMessage` | Wire format — legacy or v0, ready for signing |
| `SignedTx` | Signed transaction — encode to base64 for sending |
| `ByteArray` | Binary buffer with typed constructors (u8, u16, u32, u64, string, base58) |

---

## Related

- [Borsh Serialization](borsh) — How data gets packed into bytes
- [Solana Mobile](solana-mobile) — MWA protocol and Seed Vault
- [Token Operations](token-ops) — SPL tokens, ATAs, Token-2022
- [coral_xyz](coral-xyz/) — IDL-driven program interaction built on this package
