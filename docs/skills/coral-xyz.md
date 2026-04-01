# coral_xyz — Universal Dart Client for Solana Programs

> IDL-driven Dart client for interacting with Solana programs built with Anchor, Quasar, or Pinocchio. Load an IDL, get typed namespaces for instructions, accounts, events, and PDA derivation — no manual Borsh wiring needed.

## Overview

The `coral_xyz` package (v1.0.0-beta.9) is the Dart equivalent of `@coral-xyz/anchor` from the TypeScript ecosystem. Give it a program's IDL (JSON), and it gives you a `Program` object with full namespace access: call instructions, fetch and decode accounts, subscribe to events, derive PDAs, and simulate transactions — all without writing manual Borsh serialization.

It supports three Solana program frameworks:

- **Anchor** — SHA256 8-byte discriminators, Borsh-encoded accounts, standard Anchor IDL format
- **Quasar** — Explicit N-byte discriminators, zero-copy `#[repr(C)]` accounts, bounded strings/vecs
- **Pinocchio / Manual** — Developer-defined interfaces via `ProgramInterface` builder, raw byte layouts

The IDL format is auto-detected. You don't choose — pass any IDL JSON and `coral_xyz` figures out the framework.

**Package links:** [GitHub](https://github.com/user/dart-coral-xyz) / [coral_xyz_codegen](https://github.com/user/coral_xyz_codegen)

## Quick Start

```yaml
dependencies:
  coral_xyz: ^1.0.0-beta.9
  solana: ^0.31.0
```

```dart
import 'dart:convert';
import 'package:coral_xyz/coral_xyz.dart';

// 1. Load IDL from JSON (file, asset bundle, or network)
final idlJson = '{"address":"A9yY...","instructions":[...],...}';
final idl = Idl.fromJson(jsonDecode(idlJson) as Map<String, dynamic>);

// 2. Set up provider
final connection = Connection('https://api.devnet.solana.com');
final wallet = await KeypairWallet.generate();
final provider = AnchorProvider(connection, wallet);

// 3. Create program
final program = Program(idl, provider: provider);

// 4. Call an instruction
final signature = await program.methods['initialize']!([])
    .accounts({
      'counter': counterPda,
      'payer': wallet.publicKey,
      'systemProgram': PublicKeyUtils.systemProgram,
    })
    .rpc();

// 5. Fetch an account
final data = await program.account['Counter']!.fetch(counterPda);
print(data['count']); // BigInt
```

## Core Concepts

### Program Construction

Three ways to create a `Program`:

```dart
import 'package:coral_xyz/coral_xyz.dart';

// From IDL with address embedded (IDL JSON has "address" field)
final program = Program(idl, provider: provider);

// From IDL with explicit programId (overrides IDL address)
final program = Program.withProgramId(
  idl,
  PublicKeyUtils.fromBase58('A9yY...bR5o'),
  provider: provider,
);

// Fetch IDL from on-chain (Anchor programs store IDL on-chain)
final program = await Program.at('A9yY...bR5o', provider: provider);
```

> **CRITICAL**: `Program(idl)` requires the IDL to have an `address` field. If your IDL JSON lacks it, inject it before parsing: `idlMap['address'] = 'YOUR_PROGRAM_ID';` then `Idl.fromJson(idlMap)`. Or use `Program.withProgramId()`.

The `Program` auto-detects the IDL format and selects the correct coder:

| IDL Format | Detection | Account Coder | Discriminator |
|-----------|-----------|---------------|---------------|
| Anchor | Default / `metadata.spec: "0.1.0"` | BorshAccountsCoder | SHA256 8-byte |
| Quasar | Explicit discriminators / bounded types / `hasRemaining` | ZeroCopyAccountsCoder | Explicit N-byte |
| Manual | `metadata.spec: "manual"` | RawAccountsCoder | Developer-defined |
| Codama | `"standard": "codama"` or `"kind": "rootNode"` | Depends on target | Depends on target |

### Provider Setup

`AnchorProvider` wraps a `Connection` + optional `Wallet`. Multiple factory constructors for different scenarios:

```dart
// Full provider (reads + writes + signs)
final provider = AnchorProvider(
  Connection('https://api.devnet.solana.com'),
  wallet,
);

// With explicit options
final provider = AnchorProvider(
  connection,
  wallet,
  options: ConfirmOptions(
    commitment: Commitment.confirmed,
    skipPreflight: false,
    maxRetries: 3,
  ),
);

// Read-only (no wallet — can only fetch accounts, not send transactions)
final provider = AnchorProvider.readOnly(
  Connection('https://api.devnet.solana.com'),
);

// Local validator (localhost:8899 + reads ~/.config/solana/id.json)
final provider = await AnchorProvider.local();

// From ANCHOR_PROVIDER_URL env var
final provider = await AnchorProvider.env();
```

> **GOTCHA**: `AnchorProvider.readOnly()` has no wallet. Calling `.rpc()` on methods will fail. Use it only for `program.account[...].fetch()` operations. When you need to send transactions later, create a new program with a full provider.

### Wallet Creation

`KeypairWallet` is the primary wallet implementation. All constructors are async:

```dart
// Generate random
final wallet = await KeypairWallet.generate();

// From secret key bytes (64 bytes: private + public)
final wallet = await KeypairWallet.fromSecretKeyAsync(secretKeyBytes);

// From JSON array (Solana CLI keypair format — 64 ints)
final wallet = await KeypairWallet.fromJsonAsync(keypairJsonArray);

// From base58 secret key string
final wallet = await KeypairWallet.fromBase58Async(secretKeyBase58);

// From BIP39 mnemonic
final wallet = await KeypairWallet.fromMnemonic(
  'word1 word2 ... word12',
  account: 0,
  change: 0,
);

// From seed (32 bytes)
final wallet = await KeypairWallet.fromSeed(seedBytes);
```

### Connection

`Connection` wraps espresso-cash's `SolanaClient`:

```dart
final connection = Connection('https://api.devnet.solana.com');

// Direct RPC access
final balance = await connection.getBalance(address);
final accountInfo = await connection.getAccountInfo(address);
final blockhash = await connection.getLatestBlockhash();

// Program account queries with filters
final accounts = await connection.getProgramAccounts(
  programIdString,
  filters: [AccountFilter.dataSize(size)],
);

// WebSocket subscriptions
final stream = connection.onAccountChange(address);
stream.listen((account) => print('Account changed'));
```

### Calling Instructions (Methods Namespace)

The `methods` namespace is the primary way to call program instructions. It returns a `TypeSafeMethodBuilder` with a fluent API:

```dart
// Bracket access — returns a builder function
final signature = await program.methods['initialize']!([])
    .accounts({
      'counter': counterPda,
      'payer': wallet.publicKey,
      'systemProgram': PublicKeyUtils.systemProgram,
    })
    .signers([keypair])
    .rpc();

// With arguments
await program.methods['increment']!([BigInt.from(5)])
    .accounts({'counter': counterPda})
    .rpc();
```

For Flutter apps, dynamic method access is common:

```dart
// Dynamic access via noSuchMethod (TypeScript-like)
await (program.methods as dynamic)
    .initialize()
    .accounts({
      'counter': counterPda,
      'payer': wallet.publicKey,
      'systemProgram': PublicKeyUtils.systemProgram,
    })
    .rpc();

// With args
await (program.methods as dynamic)
    .addTodo(content)
    .accounts({
      'userProfile': profilePda,
      'todoAccount': todoPda,
      'authority': wallet.publicKey,
      'systemProgram': PublicKeyUtils.systemProgram,
    })
    .rpc();
```

> **WHY THIS MATTERS**: The `(program.methods as dynamic)` cast is needed because Dart's static type system can't resolve IDL-defined method names at compile time. The `noSuchMethod` override on `MethodsNamespace` intercepts the call and routes it to the correct builder. This mirrors how `program.methods.initialize()` works in TypeScript Anchor.

### TypeSafeMethodBuilder — Full Fluent API

Every method access returns a `TypeSafeMethodBuilder`. Chain these before a terminal call:

```dart
final builder = program.methods['transfer']!([BigInt.from(1000000)])
    .accounts({
      'from': fromPda,
      'to': toPda,
      'authority': wallet.publicKey,
    })
    .accountsPartial({              // partial — only override some accounts
      'tokenProgram': customTokenProgram,
    })
    .signers([extraKeypair])        // additional signers beyond wallet
    .remainingAccounts([            // extra accounts not in IDL
      AccountMeta(
        publicKey: extraAccount,
        isWritable: true,
        isSigner: false,
      ),
    ])
    .preInstructions([computeBudgetIx])   // instructions before main
    .postInstructions([memoIx]);          // instructions after main
```

Terminal methods — pick one to execute:

```dart
// Send transaction, return signature
final String signature = await builder.rpc();

// Get the TransactionInstruction only (don't send)
final TransactionInstruction ix = await builder.instruction();

// Get full AnchorTransaction (with instructions, fee payer, blockhash)
final AnchorTransaction tx = await builder.transaction();

// Simulate without sending
final SimulationResult result = await builder.simulate();
print(result.success);       // bool
print(result.logs);          // List<String>
print(result.unitsConsumed); // int?

// View function (simulates, extracts return value from logs)
final dynamic returnValue = await builder.view();

// Get resolved account pubkeys without executing
final Map<String, PublicKey?> keys = await builder.pubkeys();

// Get everything prepared
final prepared = await builder.prepare();
// prepared.instruction, prepared.signers, prepared.pubkeys
```

### Fetching Accounts (Account Namespace)

```dart
// Fetch single account — returns decoded Map<String, dynamic>
final data = await program.account['Counter']!.fetch(counterPda);
final count = data['count'] as BigInt;
final authority = data['authority']; // Ed25519HDPublicKey

// Fetch allowing null (returns null if account doesn't exist)
final data = await program.account['Counter']!.fetch(
  maybePda,
  useCache: false, // bypass cache
);

// Fetch multiple accounts at once
final List<dynamic?> results = await program.account['Counter']!
    .fetchMultiple([pda1, pda2, pda3]);

// Fetch all accounts of a type (getProgramAccounts under the hood)
final List<ProgramAccount> all = await program.account['Counter']!.all();
for (final pa in all) {
  print('${pa.publicKey}: ${pa.account}');
}

// Fetch all with filters
final filtered = await program.account['Counter']!.fetchAll(
  filters: [AccountFilter.dataSize(100)],
  commitment: Commitment.confirmed,
);

// Subscribe to account changes
final Stream<dynamic> stream = program.account['Counter']!.subscribe(counterPda);
stream.listen((data) {
  print('New count: ${data['count']}');
});

// Unsubscribe
program.account['Counter']!.unsubscribe(counterPda);

// Get account data size (for rent calculation)
final int size = program.account['Counter']!.size;
```

> **GOTCHA**: Account data is returned as `Map<String, dynamic>`, not typed classes. Fields use the names from the IDL. BigInt is used for u64/i64/u128/i128 fields. PublicKey fields return `Ed25519HDPublicKey`. Arrays return `List<dynamic>`. Nested structs return nested `Map<String, dynamic>`.

### Other Namespaces

```dart
// RPC namespace — lower-level, requires explicit Context
final String sig = await program.rpc['initialize']!.call(
  [],
  Context(accounts: {'counter': counterPda, 'payer': payer}),
);

// Instruction namespace — returns TransactionInstruction
final TransactionInstruction ix = await program.instruction['initialize']!
    .callAsync(
      [],
      Context(accounts: {'counter': counterPda, 'payer': payer}),
    );

// Transaction namespace — returns AnchorTransaction
final AnchorTransaction tx = await program.transaction['initialize']!
    .callAsync([], Context(accounts: {...}));

// Simulate namespace
final SimulationResult result = await program.simulate['initialize']!
    .call([], Context(accounts: {...}));
```

### IDL Model

The `Idl` class represents the full program interface:

```dart
// Parse from JSON
final idl = Idl.fromJson(jsonDecode(idlString) as Map<String, dynamic>);

// Access fields
idl.name;                    // String? — program name
idl.address;                 // String? — program ID
idl.format;                  // IdlFormat — anchor, quasar, manual, codama
idl.instructions;            // List<IdlInstruction>
idl.accounts;                // List<IdlAccount>?
idl.events;                  // List<IdlEvent>?
idl.errors;                  // List<IdlErrorCode>?
idl.types;                   // List<IdlTypeDef>?
idl.constants;               // List<IdlConst>?
idl.isAnchor;                // bool
idl.isQuasar;                // bool

// Lookup helpers
final ix = idl.findInstruction('initialize');
final acct = idl.findAccount('Counter');
final typeDef = idl.findType('PollOption');
```

Build an IDL programmatically for programs without JSON IDL (Pinocchio, native):

```dart
final idl = ProgramInterface.define(
  name: 'my_program',
  address: 'A9yY...bR5o',
  version: '0.1.0',
)
  .instruction('initialize', discriminator: [0])
    .account('counter', writable: true, signer: false)
    .account('payer', writable: true, signer: true)
    .account('systemProgram')
    .arg('initialValue', IdlType(kind: 'u64'))
    .done()
  .instruction('increment', discriminator: [1])
    .account('counter', writable: true)
    .arg('amount', IdlType(kind: 'u64'))
    .done()
  .account('Counter', discriminator: [0xFF, 0x01])
    .field('count', IdlType(kind: 'u64'))
    .field('authority', IdlType(kind: 'pubkey'))
    .done()
  .error(6000, 'Overflow', msg: 'Counter overflowed')
  .build();

final program = Program(idl, provider: provider);
// Now use program.methods, program.account, etc. — same API as IDL-loaded programs
```

### PDA Derivation

Two PDA systems: low-level `PublicKeyUtils` and IDL-aware `PdaDerivationEngine`.

```dart
import 'dart:convert';
import 'dart:typed_data';
import 'package:coral_xyz/coral_xyz.dart';

// PublicKeyUtils — mirrors solana web3.js findProgramAddress
final PdaResult result = await PublicKeyUtils.findProgramAddress(
  [
    utf8.encode('counter'),                    // string seed
    wallet.publicKey.toBytes(),                // pubkey seed
  ],
  programId,
);
final PublicKey counterPda = result.address;
final int bump = result.bump;
```

Type-safe seeds with `PdaDerivationEngine`:

```dart
// PdaDerivationEngine — typed seeds, sync computation
final PdaResult result = PdaDerivationEngine.findProgramAddress(
  [
    StringSeed('vault'),
    PublicKeySeed(userPublicKey),
  ],
  programId,
);

// Batch PDA derivation
final List<PdaResult> pdas = PdaDerivationEngine.findProgramAddressBatch(
  [
    [StringSeed('vault'), PublicKeySeed(user1)],
    [StringSeed('vault'), PublicKeySeed(user2)],
    [StringSeed('vault'), PublicKeySeed(user3)],
  ],
  programId,
);

// Validate a PDA
final bool valid = PdaDerivationEngine.validateProgramAddress(
  knownPda,
  [StringSeed('vault'), PublicKeySeed(user)],
  programId,
);
```

PDA derivation from IDL seed definitions (auto-resolved during instruction calls):

```dart
// PdaSeedResolver resolves IDL-defined PDA seeds
final seeds = PdaSeedResolver.resolveSeeds(
  idlPda.seeds,
  accounts: {'authority': walletPubkey},
  args: {'name': 'my_vault'},
);
final pda = PdaSeedResolver.derivePda(
  idlPda,
  programId,
  accounts: resolvedAccounts,
  args: instructionArgs,
);
```

> **WHY THIS MATTERS**: When an instruction's IDL defines PDA seeds for an account, `AccountsResolver` auto-derives the PDA during `.rpc()` / `.instruction()` calls. You only need manual PDA derivation when the IDL doesn't have seed definitions, or when you need the address before calling an instruction (e.g., to check if an account exists first).

### Events

```dart
// Subscribe to events
final int listenerId = program.addEventListener<Map<String, dynamic>>(
  'CounterIncremented',
  (event, slot, signature) {
    print('Event at slot $slot: $event');
    print('New count: ${event['newCount']}');
  },
);

// Unsubscribe
await program.removeEventListener(listenerId);

// Check event system status
print(program.events.stats);   // EventStats
print(program.events.state);   // WebSocketState
```

### PublicKey Utilities

`PublicKey` is a typedef for `solana.Ed25519HDPublicKey`:

```dart
// Create from various formats
final pk = PublicKeyUtils.fromBase58('A9yY...bR5o');
final pk = PublicKeyUtils.fromBytes(byteList);
final pk = PublicKeyUtils.fromHex(hexString);

// Well-known addresses
final system = PublicKeyUtils.systemProgram;   // 111...1
final zero = PublicKeyUtils.defaultPubkey;     // all zeros

// Validation
PublicKeyUtils.isValidBase58('A9yY...');  // bool
PublicKeyUtils.isOnCurve(bytes);          // bool

// Extensions on PublicKey instances
pk.toBytes();        // Uint8List (32 bytes)
pk.toBase58String(); // String
pk.toHex();          // String
pk.isDefault;        // true if all zeros
```

### Coders (Advanced)

Direct coder access for custom encoding/decoding:

```dart
// Auto-detect coder from IDL
final coder = AutoCoder(idl);  // Anchor→Borsh, Quasar→ZeroCopy

// Explicit Borsh coder
final coder = BorshCoder(idl);

// Encode instruction data
final Uint8List data = coder.instructions.encode(
  'initialize',
  {'initialValue': BigInt.from(42)},
);

// Decode instruction data
final Instruction? decoded = coder.instructions.decode(rawBytes);
print(decoded?.name);  // 'initialize'
print(decoded?.data);  // {'initialValue': BigInt(42)}

// Decode event from base64 log
final Event? event = coder.events.decode<IdlEvent>(base64Log);
print(event?.name);   // 'CounterIncremented'
print(event?.data);   // decoded fields

// Format instruction for display
final display = coder.instructions.format(decoded!, accountMetas);
print(display?.args);      // formatted argument list
print(display?.accounts);  // formatted account list
```

### AnchorTransaction

```dart
final tx = AnchorTransaction(
  instructions: [ix1, ix2],
  feePayer: wallet.publicKey,
);

tx.setRecentBlockhash(blockhash);
tx.add(additionalIx);

final estimatedSize = tx.estimateSize();
final estimatedFee = tx.estimateFee();
```

### Sending Transactions via Provider

```dart
// Single transaction
final String signature = await provider.sendAndConfirm(
  transaction,
  signers: [keypair1, keypair2],
  options: ConfirmOptions(commitment: Commitment.confirmed),
);

// Batch send
final List<String> sigs = await provider.sendAll([
  TransactionWithSigners(tx1, [signer1]),
  TransactionWithSigners(tx2, [signer2]),
]);

// Simulate
final result = await provider.simulate(transaction);
print(result.logs);
```

## Patterns & Recipes

### Flutter App — Full Setup Pattern

```dart
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:coral_xyz/coral_xyz.dart';

class SolanaService {
  static const String _programId = 'A9yYAEQ1sCfZ...';
  static const String _rpcUrl = 'https://api.devnet.solana.com';

  Program? _program;
  PublicKey? _counterPda;

  // 1. Initialize read-only (for fetching accounts before wallet connect)
  Future<void> initReadOnly() async {
    final idlString = await rootBundle.loadString('assets/idl.json');
    final idlMap = jsonDecode(idlString) as Map<String, dynamic>;
    idlMap['address'] = _programId;

    final idl = Idl.fromJson(idlMap);
    final connection = Connection(_rpcUrl);

    _program = Program.withProgramId(
      idl,
      PublicKeyUtils.fromBase58(_programId),
      provider: AnchorProvider.readOnly(connection),
    );
  }

  // 2. Upgrade to full provider when wallet connects
  void connectWallet(Wallet wallet) {
    _program = Program.withProgramId(
      _program!.idl,
      _program!.programId,
      provider: AnchorProvider(Connection(_rpcUrl), wallet),
    );
  }

  // 3. Derive PDA
  Future<PublicKey> getCounterPda() async {
    _counterPda ??= (await PublicKeyUtils.findProgramAddress(
      [utf8.encode('counter_v2')],
      _program!.programId,
    )).address;
    return _counterPda!;
  }

  // 4. Write — initialize
  Future<String> initialize() async {
    final pda = await getCounterPda();
    return await ((_program!.methods as dynamic).initialize()
        .accounts({
          'counter': pda,
          'payer': _program!.provider.wallet!.publicKey,
          'systemProgram': PublicKeyUtils.systemProgram,
        })
        .rpc()) as String;
  }

  // 5. Write — increment
  Future<String> increment(int amount) async {
    final pda = await getCounterPda();
    return await ((_program!.methods as dynamic)
        .increment(BigInt.from(amount))
        .accounts({'counter': pda})
        .rpc()) as String;
  }

  // 6. Read — fetch counter
  Future<int> getCount() async {
    final pda = await getCounterPda();
    final data = await _program!.account['Counter']!.fetch(pda);
    return (data['count'] as BigInt).toInt();
  }

  // 7. Cleanup
  Future<void> dispose() async {
    await _program?.dispose();
  }
}
```

### Using IDL Constants for PDA Seeds

```dart
// Access constants defined in the IDL
final userTag = program.idl.constants!
    .firstWhere((c) => c.name == 'USER_TAG');

// Parse the constant value (IDL stores as JSON string)
final seedBytes = (jsonDecode(userTag.value) as List).cast<int>();

final pda = (await PublicKeyUtils.findProgramAddress(
  [
    Uint8List.fromList(seedBytes),
    wallet.publicKey.toBytes(),
  ],
  program.programId,
)).address;
```

### Complex Account Deserialization

```dart
// Fetch an account with nested structs (e.g., Poll with PollOption list)
final data = await program.account['Poll']!.fetch(pollAddress);

// The coder auto-deserializes nested types from the IDL
final String name = data['name'] as String;
final String description = data['description'] as String;
final List<dynamic> rawOptions = data['options'] as List;

// Type-cast nested structs
final options = rawOptions.map((opt) {
  final m = opt as Map<String, dynamic>;
  return PollOption(
    label: m['label'] as String,
    id: (m['id'] as BigInt).toInt(),
    votes: (m['votes'] as BigInt).toInt(),
  );
}).toList();
```

### Transaction with Keypair Signer (Account Creation)

```dart
// When creating a new account, generate a keypair and pass it as signer
final newAccountKeypair = await Ed25519HDKeyPair.random();
final newAccountWallet = await KeypairWallet.fromCustomKeypairAsync(
  Keypair(newAccountKeypair),
);

await (program.methods as dynamic)
    .createPoll(name, description, options)
    .accounts({
      'poll': newAccountKeypair.publicKey,
      'owner': wallet.publicKey,
      'systemProgram': PublicKeyUtils.systemProgram,
    })
    .signers([newAccountWallet])
    .rpc();
```

### Switching Between Read-Only and Write Providers

```dart
// Start read-only
var program = Program.withProgramId(idl, programId,
    provider: AnchorProvider.readOnly(Connection(rpcUrl)));

// Fetch accounts works
final data = await program.account['Counter']!.fetch(pda);

// User connects wallet — rebuild with full provider
program = Program.withProgramId(
  program.idl,
  program.programId,
  provider: AnchorProvider(Connection(rpcUrl), wallet),
);

// Now rpc() works
await (program.methods as dynamic).increment(BigInt.one)
    .accounts({'counter': pda}).rpc();
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| `Program(idl)` throws "address required" | IDL JSON has no `address` field | Use `Program.withProgramId(idl, publicKey)` or inject `idlMap['address'] = id` before `Idl.fromJson()` |
| `.rpc()` fails with "wallet is null" | Using `AnchorProvider.readOnly()` | Create a full `AnchorProvider(connection, wallet)` for write operations |
| Account data returns `null` | Account not initialized on-chain yet | Call the initialize instruction first, or check with `fetch()` which returns `null` |
| `BigInt` instead of `int` | IDL u64/i64 fields decode to `BigInt` | Cast: `(data['count'] as BigInt).toInt()` — safe for values < 2^53 |
| Dynamic method cast required | `MethodsNamespace` uses `noSuchMethod` for dynamic dispatch | Use `(program.methods as dynamic).methodName(args)` in Flutter apps |
| PDA mismatch between Dart and Rust | Program's hardcoded `ID_BYTES` doesn't match deployed keypair | Ensure `PublicKeyUtils.findProgramAddress(seeds, deployedProgramId)` uses the DEPLOYED program ID, not the hardcoded test ID in Rust source |
| Accounts map key names wrong | IDL uses camelCase but you passed snake_case (or vice versa) | Match IDL account names exactly — check `program.idl.findInstruction('methodName')?.accounts` |
| `AccountsResolver` can't auto-derive PDA | IDL lacks PDA seed definitions for that account | Pass the PDA explicitly in `.accounts({...})` — auto-resolution only works when IDL has `pda.seeds` |

## IDL Types Reference

The `Idl` class models the full program interface. Key type mappings:

| IDL Type String | `IdlType.kind` | Dart Decode Type |
|----------------|----------------|-----------------|
| `u8` | `'u8'` | `int` |
| `u16` | `'u16'` | `int` |
| `u32` | `'u32'` | `int` |
| `u64` | `'u64'` | `BigInt` |
| `u128` | `'u128'` | `BigInt` |
| `i8` | `'i8'` | `int` |
| `i16` | `'i16'` | `int` |
| `i32` | `'i32'` | `int` |
| `i64` | `'i64'` | `BigInt` |
| `bool` | `'bool'` | `bool` |
| `string` | `'string'` | `String` |
| `pubkey` / `publicKey` | `'pubkey'` | `Ed25519HDPublicKey` |
| `bytes` | `'bytes'` | `List<int>` |
| `{ "vec": { "items": T } }` | `'vec'` | `List<dynamic>` |
| `{ "option": T }` | `'option'` | `T?` (nullable) |
| `{ "array": [T, N] }` | `'array'` | `List<dynamic>` |
| `{ "defined": { "name": "X" } }` | `'defined'` | `Map<String, dynamic>` |

## Related

- [borsh.md](borsh.md) — Manual Borsh serialization when you need struct-level control
- [solana-core.md](solana-core.md) — Underlying `solana` package for RPC, keypairs, transactions
