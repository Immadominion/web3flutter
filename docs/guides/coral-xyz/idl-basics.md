# IDL Deep Dive — Format Detection, Discriminators, and the Type System

> How `coral_xyz` reads an IDL, figures out which framework it came from, computes discriminators, and maps every type to Dart.

## Overview

An IDL (Interface Definition Language) is a JSON file that describes a Solana program's public interface — its instructions, accounts, types, events, and errors. Think of it as a Swagger spec for on-chain programs.

What makes `coral_xyz` different from a basic Anchor client: it handles **four** IDL formats, detects which one it's looking at automatically, and routes to the correct serialization and discriminator scheme. You load JSON, the SDK figures out the rest.

---

## Quick Start

```dart
import 'dart:convert';
import 'package:coral_xyz/coral_xyz.dart';

// Load and parse
final json = jsonDecode(idlString) as Map<String, dynamic>;
final idl = Idl.fromJson(json);

// What did we get?
print(idl.format);        // IdlFormat.anchor, .quasar, .codama, or .manual
print(idl.instructions);  // every callable instruction
print(idl.accounts);      // account types the program defines
print(idl.types);         // structs and enums used in args/accounts
print(idl.errors);        // custom error codes
```

---

## Core Concepts

### Four IDL Formats

`coral_xyz` supports four distinct IDL formats, each produced by a different Solana framework:

| Format | Framework | Discriminators | Account Serialization |
|--------|-----------|---------------|----------------------|
| `anchor` | Anchor | SHA256 8-byte hashes | Borsh (sequential reads) |
| `quasar` | Quasar | Explicit 1–7 byte values | Zero-copy (`repr(C)` byte-offset reads) |
| `codama` | Pinocchio (via Codama toolchain) | Varies | Zero-copy |
| `manual` | None — hand-defined via `ProgramInterface.define()` | Explicit | Zero-copy |

These aren't just labels. The format determines which `AccountsCoder` is used: `BorshAccountsCoder` for Anchor, `ZeroCopyAccountsCoder` for everything else. Get the wrong coder and account data decodes to garbage.

### Format Detection Heuristics

`IdlFormat.detect()` runs a priority-ordered chain of checks on the raw JSON:

```
1. Codama?   → json['standard'] == 'codama' OR json['kind'] == 'rootNode'
                OR metadata['spec'] == 'codama'
2. Manual?   → metadata['spec'] == 'manual'
3. Quasar?   → any instruction discriminator < 8 bytes
                OR any instruction has hasRemaining: true
                OR any instruction arg uses bounded types (dynString, dynVec, tail)
                OR any type field uses bounded types
4. Default   → anchor
```

Anchor is the fallback. If the IDL has no explicit signals for the other formats, it's treated as Anchor.

> **WHY THIS MATTERS**: Quasar detection relies on structural signals in the IDL — short discriminators, `hasRemaining` flags, or Quasar-specific type shapes like `{"string": {"maxLength": 32}}`. If a Quasar program's IDL doesn't contain any of these signals, it'll be misclassified as Anchor. The result: `BorshAccountsCoder` tries to decode `repr(C)` data and every field is wrong.

### The Quasar Type Shapes

The detection function `_isQuasarType()` recognizes three type shapes unique to Quasar:

```json
// Bounded string — fixed max allocation
{"string": {"maxLength": 32}}

// Bounded vec — fixed max allocation
{"vec": {"items": "u64", "maxLength": 10}}

// Tail — consumes all remaining bytes
{"tail": "u8"}
```

These map to `IdlType.dynString()`, `IdlType.dynVec()`, and `IdlType.tail()` in Dart. The zero-copy coder knows their wire formats. The Borsh coder does not — it only understands standard `string`, `vec`, `option`, `array`.

---

### The Idl Class

After parsing, you get an `Idl` with these fields:

```dart
class Idl {
  final IdlFormat format;
  final String? address;            // deployed program ID
  final String? name;               // program name
  final String? version;            // semantic version
  final IdlMetadata? metadata;      // name, version, spec, description, etc.
  final List<IdlInstruction> instructions;
  final List<IdlAccount>? accounts; // account type declarations
  final List<IdlEvent>? events;
  final List<IdlErrorCode>? errors;
  final List<IdlTypeDef>? types;    // struct and enum definitions
  final List<IdlConst>? constants;

  bool get isQuasar;
  bool get isAnchor;

  IdlInstruction? findInstruction(String name);
  IdlTypeDef? findType(String name);
}
```

Convenience getters `isQuasar` and `isAnchor` check the format directly. Use them when you need framework-specific branching in your app code.

### Legacy IDL Support

Older Anchor versions (pre-0.29) embedded account type definitions inside the `accounts` array rather than in `types`. `Idl.fromJson()` handles this transparently — it extracts inline type definitions from `accounts[].type` and merges them into the `types` list. You don't need to preprocess old IDLs.

---

### Discriminators — How Programs Tell Instructions Apart

Every Solana instruction starts with a discriminator — a prefix that tells the program which handler to invoke. Anchor and Quasar use completely different schemes.

#### Anchor: SHA256 Hashes

Anchor computes 8-byte discriminators from deterministic strings:

| Context | Hash input | Example |
|---------|-----------|---------|
| Instruction | `SHA256("global:{name}")[0..8]` | `SHA256("global:initialize")` → `[175, 175, 109, 31, ...]` |
| Account | `SHA256("account:{name}")[0..8]` | `SHA256("account:Counter")` → `[255, 176, 4, 245, ...]` |
| Event | `SHA256("event:{name}")[0..8]` | `SHA256("event:DepositEvent")` → `[...]` |

These are always exactly 8 bytes. They're embedded at the start of instruction data and at the start of account data on-chain.

```dart
// You can compute them yourself:
final disc = DiscriminatorComputer.computeInstructionDiscriminator('initialize');
// → Uint8List of 8 bytes from SHA256("global:initialize")
```

#### Quasar: Explicit Short Discriminators

Quasar programs specify discriminators directly in the IDL — typically 1 or 2 bytes:

```json
{
  "name": "initialize",
  "discriminator": [0],
  "args": [...]
}
```

This `[0]` is a 1-byte discriminator. The `DiscriminatorComputer` detects this:

```dart
// If the IDL provides an explicit discriminator, use it as-is
static Uint8List resolve({
  required String prefix,
  required String name,
  List<int>? explicit,
}) {
  if (explicit != null && explicit.isNotEmpty) {
    return fromExplicit(explicit);  // 1-7 bytes, used directly
  }
  return _computeDiscriminator(prefix, name);  // SHA256 fallback
}
```

> **CRITICAL**: Anchor and Quasar discriminators are **not interchangeable**. An Anchor program expects 8 bytes of SHA256 hash. A Quasar program expects the exact bytes from the IDL. Sending the wrong discriminator fails silently — the program either rejects the instruction or invokes the wrong handler.

#### Quasar Event Discriminators

Quasar events use a special prefix byte `0xFF` to distinguish them from instruction discriminators:

```dart
static const int quasarEventPrefix = 0xFF;

static bool hasQuasarEventPrefix(List<int> discriminator) {
  return discriminator.isNotEmpty && discriminator[0] == 0xFF;
}
```

Instruction and account discriminators are validated to never start with `0xFF`. This keeps event decoding unambiguous in transaction logs.

#### Comparing Discriminators

Because discriminators have variable length (8 for Anchor, 1-7 for Quasar), comparison needs to handle length mismatches:

```dart
static bool compareDiscriminators(Uint8List expected, Uint8List actual) {
  // Fails if lengths differ — a 1-byte discriminator never matches an 8-byte one
}
```

This matters for `decodeAny()` — when the coder tries to match raw account data against all known account types. It tries each discriminator length and reports which account type matches.

---

### The Type System

IDL types map to Dart types through the `IdlType` class. Here's the complete mapping:

#### Primitive Types

| IDL type | Dart type | Size (bytes) | Notes |
|----------|-----------|-------------|-------|
| `bool` | `bool` | 1 | `0x00` or `0x01` |
| `u8` | `int` | 1 | |
| `i8` | `int` | 1 | signed |
| `u16` | `int` | 2 | little-endian |
| `i16` | `int` | 2 | |
| `u32` | `int` | 4 | |
| `i32` | `int` | 4 | |
| `u64` | `BigInt` (zero-copy) / `int` or `BigInt` (Borsh) | 8 | See BigInt note below |
| `i64` | `BigInt` (zero-copy) / `int` (Borsh) | 8 | |
| `u128` | `BigInt` | 16 | zero-copy only |
| `i128` | `BigInt` | 16 | zero-copy only |
| `f32` | `double` | 4 | |
| `f64` | `double` | 8 | |
| `string` | `String` | 4 + len | 4-byte LE length prefix + UTF-8 |
| `publicKey` / `pubkey` | `PublicKey` | 32 | |
| `bytes` | `Uint8List` | 4 + len | 4-byte LE length prefix |

> **GOTCHA**: `ZeroCopyAccountsCoder` returns `BigInt` for `u64`, `i64`, `u128`, and `i128`. The Borsh coder's `writeU64()` accepts both `int` and `BigInt` for encoding, but always decodes smaller — `readU64()` returns `int`. If you switch from Anchor to Quasar (or vice versa), your type expectations change. Check `program.idl.format` and handle both cases:
>
> ```dart
> final count = data['count'];
> final intCount = count is BigInt ? count.toInt() : count as int;
> ```

#### Composite Types

| IDL type | Wire format | Dart type |
|----------|------------|-----------|
| `vec<T>` | 4-byte count + elements | `List<T>` |
| `option<T>` | 1-byte tag + value (if present) | `T?` |
| `coption<T>` | 4-byte tag + value (if present) | `T?` (COption, Quasar-specific) |
| `array<T, N>` | N × element size | `List<T>` (fixed length) |
| `defined<Name>` | resolved from IDL types | `Map<String, dynamic>` |

#### Quasar-Specific Types

| IDL type | Wire format | Purpose |
|----------|------------|---------|
| `dynString(maxLength)` | 4-byte len + UTF-8 (max allocated) | Bounded string — capped allocation |
| `dynVec(items, maxLength)` | 4-byte count + elements (max cap) | Bounded vec |
| `tail(element)` | remaining bytes | Consumes all remaining data |

These types only exist in Quasar IDLs and are decoded by `ZeroCopyAccountsCoder`. The Borsh coder doesn't recognize them.

#### Enum Encoding

Enums use a 1-byte variant index followed by variant fields (if any):

```json
{
  "name": "Status",
  "type": {
    "kind": "enum",
    "variants": [
      { "name": "Active" },
      { "name": "Paused" },
      { "name": "Closed", "fields": [{ "name": "reason", "type": "string" }] }
    ]
  }
}
```

Decoded in Dart as a `Map`:

```dart
// Active → {'Active': {}}
// Closed → {'Closed': {'reason': 'Too many withdrawals'}}
```

---

## IDL Versioning

Anchor IDLs changed structure across major versions:

| Version range | Key differences |
|-------------|----------------|
| 0.24.x | `accounts` use `isMut`/`isSigner` flags, types inline |
| 0.27.x | Added `docs` fields on instructions and accounts |
| 0.29+ | `address` in metadata, `writable`/`signer` replace `isMut`/`isSigner`, type aliases |

`Idl.fromJson()` normalizes these differences during parsing. It handles the legacy `isMut`/`isSigner` → `writable`/`signer` mapping and the inline-type extraction. You don't need to preprocess for version differences.

Quasar IDLs follow the 0.30+ Anchor IDL structure (since Quasar builds on Anchor's IDL tooling) but include the Quasar-specific signals — explicit short discriminators, bounded types, `hasRemaining` flags.

---

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Wrong format detected | Quasar IDL lacks explicit short discriminators or bounded types | Add explicit discriminator bytes to the IDL, or add a Quasar-specific type to trigger detection |
| Account field values are wrong | Borsh coder used on `repr(C)` account data | Check `idl.format` — if it should be `quasar`, the IDL needs Quasar signals |
| `FormatException` during parsing | IDL JSON has a type the parser doesn't recognize | Verify IDL was generated by a supported Anchor/Quasar version |
| Discriminator mismatch on Quasar program | Using SHA256 computation instead of explicit bytes | Ensure the IDL includes `discriminator: [N]` on the instruction — `resolve()` will use it |

---

## Related

- [coral_xyz Overview](.) — Quick start and architecture
- [Account Resolution](account-resolution) — PDA seeds, AccountsResolver, zero-copy decoding
- [Serialization](serialization) — Borsh and zero-copy encoding internals
