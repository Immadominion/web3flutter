# coral_xyz — Universal Solana Program Client for Dart

> One SDK for every Solana program framework: Anchor, Quasar, and Pinocchio. Load an IDL, get type-safe program interaction.

## Overview

`coral_xyz` is a Dart client that talks to Solana programs. You give it an IDL (Interface Definition Language) — a JSON file describing a program's instructions, accounts, types, and errors — and it gives you a fully-typed `Program` object that can build instructions, send transactions, decode accounts, and listen for events.

It supports three Rust frameworks out of the box:

- **Anchor** — The most popular. SHA256-based 8-byte discriminators, Borsh serialization
- **Quasar** — Zero-copy `repr(C)` accounts, short explicit discriminators, bounded types
- **Pinocchio** — Lightweight programs described via Codama IDLs

And for programs that don't ship an IDL at all, you can define one manually with `ProgramInterface.define()`.

The SDK detects which framework a program uses from its IDL and routes to the right serializer, discriminator scheme, and account decoder automatically. You don't pick a framework — the IDL tells `coral_xyz` what to do.

---

## Quick Start

```dart
import 'dart:convert';
import 'package:coral_xyz/coral_xyz.dart';

// 1. Connect to Solana
final connection = Connection('https://api.devnet.solana.com');
final wallet = await KeypairWallet.generate();
final provider = AnchorProvider(connection, wallet);

// 2. Load the program's IDL
final idlJson = jsonDecode(idlString) as Map<String, dynamic>;
final idl = Idl.fromJson(idlJson);

// 3. Create the program client
final program = Program(idl, provider: provider);

// 4. Call an instruction using the fluent builder
final signature = await program.methods['initialize']!([42])
    .accounts({'counter': counterKeypair.publicKey})
    .signers([counterKeypair])
    .rpc();
```

That's the full flow. Everything below explains what happens inside each step.

---

## Core Concepts

### The Program Object

`Program` is the central type. It wraps an IDL and a provider, then exposes seven namespaces for interacting with the on-chain program:

| Namespace | What it does | Returns |
|-----------|-------------|---------|
| `methods` | Fluent builder — the main entry point | `TypeSafeMethodBuilder` |
| `rpc` | Send + confirm transactions | `String` (signature) |
| `instruction` | Build raw `TransactionInstruction` objects | `TransactionInstruction` |
| `transaction` | Build unsigned `Transaction` objects | `Transaction` |
| `simulate` | Simulate without sending | `SimulationResult` |
| `views` | Simulate + extract return value | decoded return type |
| `account` | Fetch and subscribe to program accounts | typed account data |

```dart
// All of these do the same thing internally:
final sig = await program.methods['deposit']!([amount]).accounts(accs).rpc();
final sig = await program.rpc['deposit']!([amount], Context(accounts: accs));
```

The `methods` namespace is the recommended API. The individual namespaces exist for cases where you need finer control — building an instruction without sending it, or combining instructions from multiple programs into one transaction.

### IDL Format Auto-Detection

When you call `Idl.fromJson()`, the SDK inspects the JSON and classifies it:

| Signal | Detected format |
|--------|----------------|
| `standard == 'codama'` or `kind == 'rootNode'` | `IdlFormat.codama` (Pinocchio) |
| `metadata.spec == 'manual'` | `IdlFormat.manual` (hand-defined) |
| Any discriminator < 8 bytes, or `hasRemaining`, or bounded types (`dynString`, `dynVec`, `tail`) | `IdlFormat.quasar` |
| Everything else | `IdlFormat.anchor` |

This detection drives real behavior. An Anchor IDL gets `BorshAccountsCoder` (sequential Borsh deserialization). A Quasar IDL gets `ZeroCopyAccountsCoder` (direct byte-offset reads from `ByteData`). You never pick the coder — the format decides.

> **WHY THIS MATTERS**: If you're debugging account deserialization issues, check `program.idl.format` first. A Quasar program decoded with the Borsh coder will silently produce garbage data because the memory layouts are fundamentally different. The `repr(C)` layout reads fields at fixed byte offsets; Borsh reads them sequentially.

### The Coder Stack

Every `Program` has a `Coder` that handles all serialization:

```
AutoCoder(idl)
  ├── BorshInstructionCoder   ← instruction data encoding/decoding
  ├── AccountsCoder            ← BorshAccountsCoder OR ZeroCopyAccountsCoder
  ├── BorshEventCoder          ← event log decoding
  └── BorshTypesCoder          ← user-defined type encoding
```

`AutoCoder` dispatches the accounts coder based on `idl.format`. Instructions and events use the same Borsh coder for all frameworks — only account deserialization differs because that's where Quasar's zero-copy layout diverges from Borsh.

### The Provider

`AnchorProvider` bundles a `Connection` (RPC endpoint) and a `Wallet` (signer):

```dart
// Full setup
final provider = AnchorProvider(
  Connection('https://api.devnet.solana.com'),
  await KeypairWallet.fromBase58Async(secretKey),
  options: ConfirmOptions(commitment: CommitmentConfigs.confirmed),
);

// For read-only usage (no signing)
final provider = AnchorProvider.readOnly(connection);

// For local testing with solana-test-validator
final provider = await AnchorProvider.local();
```

The provider handles transaction signing and confirmation. When you call `.rpc()` on a builder, the provider:

1. Gets a recent blockhash
2. Signs the transaction with the wallet
3. Sends via `sendRawTransaction`
4. Waits for confirmation at the configured commitment level

> **GOTCHA**: `AnchorProvider.local()` reads `~/.config/solana/id.json` for the wallet keypair. If that file doesn't exist (e.g., in CI), it throws. Use `AnchorProvider.readOnly()` for test setups that only need to read data.

---

## Patterns & Recipes

### Fetching Account Data

```dart
final counter = program.account['Counter']!;

// Single account
final data = await counter.fetch(counterAddress);
// data is Map<String, dynamic> — fields match the IDL definition

// All accounts of this type
final allCounters = await counter.all();
// Returns List<ProgramAccount<T>> with .account and .publicKey

// Subscribe to changes (WebSocket)
final stream = counter.subscribe(counterAddress);
stream.listen((updated) {
  print('New count: ${updated['count']}');
});
```

### Building Multi-Instruction Transactions

```dart
// Build instructions without sending
final ix1 = await program.methods['initialize']!([])
    .accounts(initAccounts)
    .instruction();

final ix2 = await program.methods['deposit']!([amount])
    .accounts(depositAccounts)
    .instruction();

// Combine into one transaction
final tx = Transaction()..add(ix1)..add(ix2);
final sig = await provider.sendAndConfirm(tx);
```

### Listening for Events

```dart
final listenerId = program.events.addEventListener<Map<String, dynamic>>(
  'DepositEvent',
  (event, slot, signature) {
    print('Deposit: ${event['amount']} at slot $slot');
  },
);

// Later:
await program.events.removeEventListener(listenerId);
```

### Working with Programs That Have No IDL

```dart
final idl = ProgramInterface.define(
  name: 'counter',
  address: 'CounterProgram11111111111111111111111',
)
  .instruction('initialize', discriminator: [0])
    .account('counter', writable: true, signer: true)
    .account('user', signer: true)
    .account('systemProgram')
    .arg('initialValue', 'u64')
    .done()
  .account('Counter', discriminator: [0])
    .field('authority', 'pubkey')
    .field('count', 'u64')
    .done()
  .build();

final program = Program(idl, provider: provider);
// Now use program.methods exactly like any IDL-loaded program
```

> **WHY THIS MATTERS**: `ProgramInterface.define()` sets `metadata.spec = 'manual'`, which routes account decoding to `ZeroCopyAccountsCoder`. This means your field definitions must match the exact on-chain byte layout — field order matters, field sizes matter, padding matters.

---

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Account data is garbage | Wrong IDL format detected — Borsh coder used on a Quasar program | Check `program.idl.format`. If wrong, the IDL is missing Quasar signals (explicit short discriminators, bounded types) |
| `StateError: Missing required accounts` | Auto-resolution couldn't derive a PDA because a dependency account wasn't provided | Provide the account explicitly in `.accounts()`, or supply `.accountsPartial()` with the accounts you have |
| Transaction simulation failed with `0x1` | Discriminator mismatch — instruction data starts with wrong bytes | Verify the IDL matches the deployed program version. Anchor uses SHA256 8-byte hashes; Quasar uses explicit short discriminators |
| `BigInt` returned instead of `int` for u64 fields | `ZeroCopyAccountsCoder` returns `BigInt` for u64+ types | This is intentional — Dart `int` is 64-bit signed, which can't hold the full u64 range. Use `BigInt` arithmetic or `.toInt()` if your values are small enough |
| Event listener fires but data is null | Quasar programs emit events via self-CPI (`emit_cpi!`) | The event parser handles this — check that your event name matches the IDL exactly (case-sensitive) |

---

## API Quick Reference

| Class | Purpose |
|-------|---------|
| `Program` | Central client. Wraps IDL + provider + coder + namespaces |
| `Idl` | Parsed IDL. `fromJson()` auto-detects format |
| `AnchorProvider` | Connection + wallet + transaction signing |
| `Connection` | RPC and WebSocket methods |
| `KeypairWallet` | Wallet backed by Ed25519 keypair |
| `TypeSafeMethodBuilder` | Fluent builder for instructions |
| `AccountClient` | Fetch/subscribe to typed program accounts |
| `EventManager` | WebSocket event subscriptions |
| `ProgramInterface` | Builder for hand-defined IDLs |
| `PdaDerivationEngine` | PDA derivation with typed seeds |
| `AccountsResolver` | Auto-resolves instruction accounts from IDL hints |

---

## Related

- [IDL Deep Dive](idl-basics) — Format detection, discriminator computation, type system
- [Account Resolution](account-resolution) — PDA derivation engine, auto-resolution, zero-copy decoding
- [Serialization](serialization) — Borsh encoding, zero-copy decoding, type mapping
- [Events & Program Interface](events-and-interface) — Event parsing, manual IDL definition
- [Solana Package](../solana-package) — The underlying RPC and transaction layer
