# solana — Dart SDK for Solana

> The foundational Dart package for all Solana interaction: RPC, keypairs, transactions, programs. Everything else depends on this.

## Overview

The `solana` package (v0.31.2, by Espresso Cash) is the most complete Dart SDK for Solana. It provides:

- `RpcClient` — all 52 JSON-RPC methods with proper Dart types
- `SolanaClient` — high-level send-and-confirm orchestrator
- `Ed25519HDKeyPair` / `Ed25519HDPublicKey` — BIP39 mnemonic derivation, PDA creation
- `Message`, `Instruction`, `SignedTx` — transaction building and encoding
- `SubscriptionClient` — WebSocket subscriptions (accounts, logs, slots, signatures)
- Built-in program helpers — SystemProgram, Token, Token-2022, ATA, ComputeBudget, Memo, Stake

**Package link:** [pub.dev/packages/solana](https://pub.dev/packages/solana) / [GitHub](https://github.com/espresso-cash/espresso-cash-public/tree/master/packages/solana)

## Quick Start

```yaml
dependencies:
  solana: ^0.31.0
```

```dart
import 'package:solana/solana.dart';

final client = SolanaClient(
  rpcUrl: Uri.parse('https://api.devnet.solana.com'),
  websocketUrl: Uri.parse('wss://api.devnet.solana.com'),
);

final wallet = await Ed25519HDKeyPair.random();
await client.rpcClient.requestAirdrop(wallet.address, lamportsPerSol);

final balance = await client.rpcClient.getBalance(wallet.address);
print('${balance.value / lamportsPerSol} SOL'); // 1.0 SOL
```

## Core Concepts

### Imports

The package has multiple barrel files. Use the right one:

| Import | When to Use |
|--------|------------|
| `package:solana/solana.dart` | Default — includes everything |
| `package:solana/encoder.dart` | Transaction building only (`Message`, `Instruction`, `SignedTx`, `AccountMeta`, `ByteArray`) |
| `package:solana/dto.dart` | RPC response types (`Account`, `Commitment`, `LatestBlockhash`, etc.) |
| `package:solana/anchor.dart` | Anchor instruction/account helpers |
| `package:solana/metaplex.dart` | Metaplex NFT types |
| `package:solana/base58.dart` | `base58encode()` / `base58decode()` only |

### RpcClient — The Connection

```dart
final rpc = RpcClient(
  'https://api.devnet.solana.com',
  timeout: const Duration(seconds: 30),
  customHeaders: {'Authorization': 'Bearer $apiKey'}, // for paid RPCs
);
```

> **CRITICAL**: Public endpoints (`api.mainnet-beta.solana.com`) rate-limit at 40 req/10s. Production apps MUST use a paid provider (Helius, QuickNode, Triton). Your app WILL break under load otherwise.

Every RPC method that returns contextual data wraps it in `ContextResult<T>`. Access the actual value with `.value`:

```dart
// WRONG — this is a BalanceResult, not an int
final balance = await rpc.getBalance(address);

// RIGHT — unwrap the context
final balance = await rpc.getBalance(address);
final lamports = balance.value; // int

// Same pattern for all context-wrapped results:
final bh = await rpc.getLatestBlockhash();
final blockhash = bh.value.blockhash;      // String
final lastValid = bh.value.lastValidBlockHeight; // int
```

> **GOTCHA**: Agents frequently forget `.value` on `getBalance()`, `getLatestBlockhash()`, and other context-wrapped RPCs. The error won't be obvious at compile time if you pass the result object where an int is expected.

### Ed25519HDKeyPair — Keypairs

```dart
// Random (testing only)
final kp = await Ed25519HDKeyPair.random();

// From mnemonic (wallets)
final kp = await Ed25519HDKeyPair.fromMnemonic(
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  account: 0,
  change: 0,
);

// From raw private key bytes
final kp = await Ed25519HDKeyPair.fromPrivateKeyBytes(
  privateKey: privateKeyBytes, // List<int>, 64 bytes
);

// From seed + HD path (advanced)
final kp = await Ed25519HDKeyPair.fromSeedWithHdPath(
  seed: seedBytes,
  hdPath: "m/44'/501'/0'/0'",
);
```

**Derivation path rules** (this is where agents mess up the most):

| `account` | `change` | HD Path | Used By |
|-----------|----------|---------|---------|
| `null` | `null` | `m/44'/501'` | Legacy — DO NOT USE |
| `0` | `null` | `m/44'/501'/0'` | |
| `0` | `0` | `m/44'/501'/0'/0'` | Phantom, Solflare, standard |
| `null` | `0` | `m/44'/501'/0'/0'` | Same as above |

> **CRITICAL**: For Phantom compatibility, ALWAYS use `account: 0, change: 0`. This produces the standard path `m/44'/501'/0'/0'`. If you omit these parameters or use the wrong values, you'll derive a completely different address from the same mnemonic. This is the #1 wallet import bug.

### Ed25519HDPublicKey — Public Keys and PDAs

```dart
// From base58 string
final pubkey = Ed25519HDPublicKey.fromBase58('11111111111111111111111111111111');

// Access raw bytes
final bytes = pubkey.bytes; // List<int>, 32 bytes

// Back to base58
final b58 = pubkey.toBase58();

// Find PDA (Program Derived Address)
final pda = await Ed25519HDPublicKey.findProgramAddress(
  seeds: [
    'metadata'.codeUnits,
    metaplexProgramId.bytes,
    mintAddress.bytes,
  ],
  programId: metaplexProgramId,
);
// pda is Ed25519HDPublicKey — this does NOT return a (key, bump) tuple

// Find ATA (uses helper function)
final ata = await findAssociatedTokenAddress(
  owner: walletPubkey,
  mint: mintPubkey,
  tokenProgramType: TokenProgramType.tokenProgram, // or .token2022Program
);
```

> **GOTCHA**: `findProgramAddress` returns `Ed25519HDPublicKey` directly, not a tuple with a bump seed. The bump is found internally via brute-force. If you need the bump (rare in Dart — the program usually finds it), use `createProgramAddress` with an explicit bump.

### Building Transactions

Transactions in Solana are `Message` + signatures. A `Message` contains a list of `Instruction`s.

```dart
import 'package:solana/encoder.dart';

// 1. Build instructions
final transferIx = SystemInstruction.transfer(
  fundingAccount: sender.publicKey,
  recipientAccount: recipientPubkey,
  lamports: 100000000, // 0.1 SOL
);

// 2. Create a message
final message = Message(instructions: [transferIx]);

// 3. Sign and send (high-level)
final txId = await solanaClient.sendAndConfirmTransaction(
  message: message,
  signers: [sender],
  commitment: Commitment.confirmed,
);
```

**Manual transaction building** (when you need control):

```dart
// Compile to wire format
final bh = await rpc.getLatestBlockhash();
final compiled = message.compile(
  recentBlockhash: bh.value.blockhash,
  feePayer: sender.publicKey,
);

// Sign
final signature = await sender.sign(compiled.toByteArray());
final signedTx = SignedTx(
  signatures: [signature],
  compiledMessage: compiled,
);

// Send raw
final txId = await rpc.sendTransaction(
  signedTx.encode(), // base64
  preflightCommitment: Commitment.confirmed,
);
```

**V0 transactions** (with address lookup tables):

```dart
final lookupTable = await rpc.getAddressLookupTable(lookupTableAddress);

final compiled = message.compileV0(
  recentBlockhash: bh.value.blockhash,
  feePayer: sender.publicKey,
  addressLookupTableAccounts: [lookupTable],
);
```

### Custom Instructions

When the package doesn't have a helper for the program you need:

```dart
final instruction = Instruction(
  programId: Ed25519HDPublicKey.fromBase58('YourProgramIdHere...'),
  accounts: [
    AccountMeta.writeable(pubKey: accountA, isSigner: true),
    AccountMeta.readonly(pubKey: accountB, isSigner: false),
    AccountMeta.writeable(pubKey: accountC, isSigner: false),
  ],
  data: ByteArray.merge([
    ByteArray.u8(0),           // instruction index
    ByteArray.u64(1000000),    // amount argument
    ByteArray.fromString('hello'), // string argument (length-prefixed)
  ]),
);
```

> **WHY THIS MATTERS**: `AccountMeta` has two factories: `.writeable()` and `.readonly()`. Both take `isSigner`. The most common mistake is setting `isWriteable`/`isSigner` wrong — this causes "failed to simulate transaction" errors that give no useful message. Double-check every account against the program's expected accounts.

### ByteArray — Building Instruction Data

`ByteArray` is the instruction data builder. All integers are little-endian:

```dart
ByteArray.u8(255)          // 1 byte
ByteArray.u16(65535)       // 2 bytes LE
ByteArray.u32(4294967295)  // 4 bytes LE
ByteArray.u64(1000000000)  // 8 bytes LE
ByteArray.i8(-1)           // 1 byte signed
ByteArray.fromString('hi') // 8-byte length prefix + UTF-8 bytes
ByteArray.fromBase58('abc') // raw bytes from base58
ByteArray.merge([a, b, c]) // concatenate multiple ByteArrays
ByteArray.empty()          // zero bytes
```

### SubscriptionClient — WebSocket

```dart
final sub = solanaClient.createSubscriptionClient();

// Watch for transaction confirmation
sub.signatureSubscribe(txId).listen((status) {
  if (status.err == null) print('Confirmed!');
});

// Watch account changes
sub.accountSubscribe(address).listen((account) {
  print('New balance: ${account.lamports}');
});

// Watch program logs
sub.logsSubscribe(LogsFilter.mentions([programId])).listen((logs) {
  print('Logs: ${logs.logs}');
});

// Always close when done
sub.close();
```

### Program ID Constants

```dart
// System
Ed25519HDPublicKey.fromBase58('11111111111111111111111111111111')

// SPL Token
Ed25519HDPublicKey.fromBase58('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

// Token-2022
Ed25519HDPublicKey.fromBase58('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')

// Associated Token Account
Ed25519HDPublicKey.fromBase58('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

// Compute Budget
Ed25519HDPublicKey.fromBase58('ComputeBudget111111111111111111111111111111')

// Memo v2
Ed25519HDPublicKey.fromBase58('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

// Metaplex Token Metadata
Ed25519HDPublicKey.fromBase58('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
```

### Anchor Support

```dart
import 'package:solana/anchor.dart';

// Build an Anchor instruction with auto-computed discriminator
final ix = await AnchorInstruction.forMethod(
  programId: programId,
  method: 'initialize',
  namespace: 'global',    // always 'global' for instructions
  accounts: [
    AccountMeta.writeable(pubKey: counterPda, isSigner: false),
    AccountMeta.writeable(pubKey: wallet.publicKey, isSigner: true),
    AccountMeta.readonly(
      pubKey: Ed25519HDPublicKey.fromBase58('11111111111111111111111111111111'),
      isSigner: false,
    ),
  ],
  arguments: ByteArray.u64(42), // instruction args after discriminator
);

// Or with a pre-computed discriminator
final disc = await computeDiscriminator('global', 'initialize');
final ix = AnchorInstruction.withDiscriminator(
  programId: programId,
  discriminator: ByteArray(disc),
  accounts: [...],
  arguments: ByteArray.u64(42),
);
```

### ComputeBudget — Priority Fees

```dart
// Always add these for mainnet transactions
final setLimit = ComputeBudgetInstruction.setComputeUnitLimit(units: 200000);
final setPrice = ComputeBudgetInstruction.setComputeUnitPrice(microLamports: 50000);

final message = Message(instructions: [
  setLimit, setPrice, // compute budget FIRST
  ...yourInstructions,
]);
```

> **CRITICAL**: On mainnet, transactions without priority fees get dropped during congestion. Always include `setComputeUnitPrice`. The value depends on network conditions — 50,000 microLamports is a reasonable baseline, but check recent priority fee levels.

### Error Handling

```dart
try {
  await rpc.sendTransaction(signedTx.encode());
} on JsonRpcException catch (e) {
  print('RPC error ${e.code}: ${e.message}');
  final txErr = e.transactionError; // TransactionError? — parsed details
  // Common: InstructionError, InsufficientFundsForRent, BlockhashNotFound
} on HttpException catch (e) {
  // Network/timeout issues
} on SubscriptionClientException catch (e) {
  // WebSocket errors
}
```

## Patterns & Recipes

### Send SOL with Confirmation

```dart
Future<TransactionId> sendSol({
  required SolanaClient client,
  required Ed25519HDKeyPair sender,
  required Ed25519HDPublicKey recipient,
  required int lamports,
}) async {
  final message = Message.only(
    SystemInstruction.transfer(
      fundingAccount: sender.publicKey,
      recipientAccount: recipient,
      lamports: lamports,
    ),
  );
  return client.sendAndConfirmTransaction(
    message: message,
    signers: [sender],
    commitment: Commitment.confirmed,
  );
}
```

### Retry with Fresh Blockhash

```dart
Future<TransactionId> sendWithRetry({
  required RpcClient rpc,
  required Message message,
  required List<Ed25519HDKeyPair> signers,
  int maxRetries = 3,
}) async {
  for (var i = 0; i < maxRetries; i++) {
    try {
      return await rpc.signAndSendTransaction(message, signers);
    } on JsonRpcException catch (e) {
      if (e.message.contains('Blockhash not found') && i < maxRetries - 1) {
        await Future<void>.delayed(const Duration(seconds: 2));
        continue; // retry with fresh blockhash (signAndSendTransaction fetches new one)
      }
      rethrow;
    }
  }
  throw Exception('Transaction failed after $maxRetries retries');
}
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Forgetting `.value` on `getBalance()` | Returns `BalanceResult`, not `int` | Always access `.value` on context-wrapped results |
| Wrong derivation path | Omitting `account: 0, change: 0` | Use `Ed25519HDKeyPair.fromMnemonic(m, account: 0, change: 0)` |
| Using `createProgramAddress` instead of `findProgramAddress` | TypeScript PDA patterns differ | `findProgramAddress` handles bump iteration internally |
| Wrong `isSigner` / `isWriteable` on `AccountMeta` | Copy-paste from TS or wrong program docs | Check each account against the program's IDL or source |
| No priority fees on mainnet | Works on devnet without them | Add `ComputeBudgetInstruction.setComputeUnitPrice()` |
| Stale blockhash | Transaction built too early, sent too late | Fetch blockhash right before signing, or use `sendAndConfirmTransaction` |
| Using `Commitment.processed` for reads after writes | Processed can be rolled back | Use `Commitment.confirmed` minimum for post-write reads |
| Passing wrong `Encoding` to `getAccountInfo` | `jsonParsed` only works for known programs | Use `Encoding.base64` for raw account data, decode manually |

## Related

- [borsh.md](borsh.md) — Serialization for instruction data and account parsing
- [spl-token.md](spl-token.md) — TokenInstruction, ATA, mint operations
- [transaction-building.md](transaction-building.md) — Deep dive on transaction simulation failures
- [metaplex-nft.md](metaplex-nft.md) — NFT metadata and minting
- [stake-program.md](stake-program.md) — Native SOL staking
- [coral-xyz.md](coral-xyz.md) — Anchor program integration
