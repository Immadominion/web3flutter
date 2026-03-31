# Dartus — Borsh Serialization for Dart

> Serialize and deserialize Solana on-chain data structures using the Borsh binary format in Dart.

## Overview

Borsh (Binary Object Representation Serializer for Hashing) is the standard serialization format on Solana. When you send instruction data to a program or read account data back, it's encoded in Borsh. The `dartus` package gives you Borsh in Dart.

You need this when:

- Sending custom instruction data to a Solana program
- Decoding account data returned by `getAccountInfo`
- Working with any program that isn't pre-wrapped by the `solana` package

## Quick Start

```yaml
dependencies:
  dartus: ^0.4.0
```

```dart
import 'package:dartus/dartus.dart';

// Define a schema matching your Rust struct 
final counterSchema = Schema.struct({
  'count': Schema.u64,
  'authority': Schema.fixedArray(Schema.u8, 32),
  'is_initialized': Schema.boolean,
});

// Deserialize account data
final decoded = borsh.deserialize(counterSchema, accountDataBytes);
print('Count: ${decoded['count']}');       // int
print('Initialized: ${decoded['is_initialized']}'); // bool
```

## Core Concepts

### Schema Types

Borsh uses a schema to define the byte layout. Here's the type mapping:

| Rust Type | Borsh Schema | Dart Result Type |
|-----------|-------------|-----------------|
| `u8` | `Schema.u8` | `int` |
| `u16` | `Schema.u16` | `int` |
| `u32` | `Schema.u32` | `int` |
| `u64` | `Schema.u64` | `int` (BigInt for large values) |
| `u128` | `Schema.u128` | `BigInt` |
| `i8` / `i16` / `i32` / `i64` | `Schema.i8` etc. | `int` |
| `bool` | `Schema.boolean` | `bool` |
| `String` | `Schema.string` | `String` |
| `Pubkey` ([u8; 32]) | `Schema.fixedArray(Schema.u8, 32)` | `List<int>` |
| `Vec<T>` | `Schema.vec(Schema.T)` | `List` |
| `[T; N]` | `Schema.fixedArray(Schema.T, N)` | `List` |
| `Option<T>` | `Schema.option(Schema.T)` | `T?` (nullable) |

### Serialization (Encoding Instruction Data)

When calling a Solana program, you need to encode your instruction arguments:

```dart
// Rust program expects:
// pub struct InitializeArgs {
//     pub name: String,
//     pub amount: u64,
// }

final instructionData = borsh.serialize(
  Schema.struct({
    'instruction': Schema.u8,  // Instruction discriminator
    'name': Schema.string,
    'amount': Schema.u64,
  }),
  {
    'instruction': 0,           // 0 = Initialize
    'name': 'My Vault',
    'amount': 1000000000,       // 1 SOL in lamports
  },
);

// Use in a transaction instruction
final instruction = Instruction(
  programId: programId,
  keys: [...accountMetas],
  data: instructionData,
);
```

> **GOTCHA**: The first byte(s) of instruction data are typically a discriminator that tells the program WHICH instruction to execute. For raw programs, this is usually a single `u8` (0, 1, 2...). For Anchor programs, it's an 8-byte SHA256 hash. Get this wrong and the program will reject your transaction or execute the wrong instruction.

### Deserialization (Decoding Account Data)

```dart
// Rust struct on-chain:
// pub struct VaultAccount {
//     pub owner: Pubkey,
//     pub balance: u64,
//     pub name: String,
//     pub is_locked: bool,
// }

final schema = Schema.struct({
  'owner': Schema.fixedArray(Schema.u8, 32),    // Pubkey = 32 bytes
  'balance': Schema.u64,
  'name': Schema.string,
  'is_locked': Schema.boolean,
});

final accountInfo = await client.getAccountInfo(
  vaultAddress.toBase58(),
  encoding: Encoding.base64,
);

final dataBytes = base64Decode(accountInfo!.data as String);
final vault = borsh.deserialize(schema, dataBytes);

// Convert owner bytes back to a public key
final ownerPubkey = Ed25519HDPublicKey(vault['owner'] as List<int>);
print('Owner: ${ownerPubkey.toBase58()}');
print('Balance: ${vault['balance']} lamports');
print('Name: ${vault['name']}');
print('Locked: ${vault['is_locked']}');
```

### Anchor Account Discriminators

Anchor programs prepend an 8-byte discriminator to every account. You must skip it.

```dart
// Anchor account data layout:
// [8 bytes: discriminator][...actual struct data...]

final anchorSchema = Schema.struct({
  'discriminator': Schema.fixedArray(Schema.u8, 8), // Skip these
  'count': Schema.u64,
  'authority': Schema.fixedArray(Schema.u8, 32),
});

final decoded = borsh.deserialize(anchorSchema, dataBytes);
// Now decoded['count'] is your actual data
// decoded['discriminator'] can be ignored (or verified)
```

> **WHY THIS MATTERS**: If you forget the 8-byte discriminator prefix, every field after it will be offset by 8 bytes, giving you garbage data. This doesn't throw an error — it silently gives wrong values. If your decoded numbers look random, check if you're accounting for the discriminator.

### Nested Structs

```dart
// Rust:
// pub struct Config {
//     pub admin: Pubkey,
//     pub settings: Settings,
// }
// pub struct Settings {
//     pub fee_bps: u16,
//     pub max_amount: u64,
// }

final settingsSchema = Schema.struct({
  'fee_bps': Schema.u16,
  'max_amount': Schema.u64,
});

final configSchema = Schema.struct({
  'admin': Schema.fixedArray(Schema.u8, 32),
  'settings': settingsSchema,
});

final decoded = borsh.deserialize(configSchema, dataBytes);
final settings = decoded['settings'] as Map<String, dynamic>;
print('Fee: ${settings['fee_bps']} basis points');
```

### Enums

```dart
// Rust:
// pub enum Status {
//     Active,
//     Paused,
//     Closed,
// }

// Borsh enums are encoded as a u8 index
final statusSchema = Schema.u8;

// Then map manually:
const statusMap = {0: 'Active', 1: 'Paused', 2: 'Closed'};
final status = statusMap[decoded['status']];
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Forgetting Anchor discriminator | Raw programs don't have it; Anchor does | Add 8-byte `fixedArray` prefix for Anchor accounts |
| Wrong field order | Borsh is NOT self-describing — order matters | Match Rust struct field order EXACTLY |
| Using `Schema.vec` for fixed-size arrays | They encode differently | Use `Schema.fixedArray` for `[T; N]`, `Schema.vec` for `Vec<T>` |
| Treating `u64` as safe int | Dart `int` overflows at 2^53 | Use `BigInt` for values that could exceed ~9 quadrillion |
| Not handling `Option` correctly | Borsh uses a 1-byte tag (0=None, 1=Some) | Use `Schema.option()` — don't try to manual decode |

## Related

- [Solana Package Deep Dive](./solana-package.md) — Where you'll use dartus for account data
- [Coral/Anchor Integration](./coral-anchor.md) — Higher-level alternative that handles serialization for you

---

*Package: [dartus on pub.dev](https://pub.dev/packages/dartus)*
