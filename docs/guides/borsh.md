# Borsh Serialization — `borsh` + `borsh_annotation`

> Two packages, one job: turn Dart classes into Solana-compatible binary and back. `borsh_annotation` defines the type system and reader/writer. `borsh` generates the serialization code at build time.

## Overview

Solana accounts store raw bytes. Programs read raw bytes. Transactions carry raw bytes. Every piece of on-chain data —  token mints, NFT metadata, program state — is a flat byte buffer.

Borsh (Binary Object Representation Serializer for Hashing) is Solana's standard binary format. It's deterministic (same data → same bytes, critical for hashing), schema-driven (no field names in the output), and little-endian.

The Dart implementation splits into two packages:

- **`borsh_annotation`** (v0.3.1+5) — Zero-dependency runtime: `BType` hierarchy, `BinaryReader`, `BinaryWriter`, and the `@BorshSerializable` marker annotation
- **`borsh`** (v0.3.1+4) — Build-time code generator: reads `@BorshSerializable` classes, emits serialization/deserialization code via `build_runner`

---

## Quick Start

```yaml
# pubspec.yaml
dependencies:
  borsh_annotation: ^0.3.1+5

dev_dependencies:
  borsh: ^0.3.1+4
  build_runner: ^2.4.0
```

```dart
import 'dart:typed_data';
import 'package:borsh_annotation/borsh_annotation.dart';

part 'my_account.g.dart';

@BorshSerializable()
class MyAccount with _$MyAccount {
  factory MyAccount({
    @BU64() required BigInt balance,
    @BString() required String name,
    @BBool() required bool isActive,
  }) = _MyAccount;

  const MyAccount._();

  factory MyAccount.fromBorsh(Uint8List data) => _$MyAccountFromBorsh(data);
}
```

```bash
dart run build_runner build
```

Now you can round-trip:

```dart
final account = MyAccount(balance: BigInt.from(1000000), name: 'vault', isActive: true);
final bytes = account.toBorsh();     // Uint8List
final decoded = MyAccount.fromBorsh(bytes);  // MyAccount
```

---

## Core Concepts

### The BType System

Every field in a `@BorshSerializable` class needs a `BType` annotation that tells the generator how to read and write that field. `BType<T>` is the abstract base:

```dart
abstract class BType<T> {
  const BType();
  void write(BinaryWriter writer, T value);
  T read(BinaryReader reader);
}
```

**Primitive types** (from `borsh_annotation`):

| Annotation | Dart Type | Wire Size | Wire Format |
|-----------|-----------|-----------|-------------|
| `@BU8()` | `int` | 1 byte | unsigned 8-bit |
| `@BU16()` | `int` | 2 bytes | unsigned 16-bit LE |
| `@BU32()` | `int` | 4 bytes | unsigned 32-bit LE |
| `@BU64()` | `BigInt` | 8 bytes | unsigned 64-bit LE |
| `@BString()` | `String` | 4 + N bytes | u32 length prefix + UTF-8 |

> **WHY THIS MATTERS**: `BU64` uses `BigInt`, not `int`. Dart's `int` is 64-bit signed, but Solana's `u64` can hold values up to 2^64-1 (18.4 quintillion). Using `int` would silently overflow at 2^63. Every lamport balance, token amount, and timestamp on Solana is a `u64`.

**Collection types**:

| Annotation | Dart Type | Wire Format |
|-----------|-----------|-------------|
| `@BFixedArray(3, BU8())` | `List<int>` | N elements back-to-back, **no length prefix** |
| `@BArray(BU8())` | `List<int>` | u32 length prefix + elements |
| `@BOption(BString())` | `String?` | 1 byte flag (0=none, 1=some) + value if some |

**Extended types** (from the `solana` package, not `borsh_annotation`):

| Annotation | Dart Type | Wire Format |
|-----------|-----------|-------------|
| `@BBool()` | `bool` | 1 byte (0x00 = false, 0x01 = true) |
| `@BPublicKey()` | `Ed25519HDPublicKey` | 32 bytes (fixed) |
| `@BFixedString(32)` | `String` | u32 length + fixed byte array with zero-padding |

Types compose. You can nest them arbitrarily deep:

```dart
@BOption(BArray(BMetadataCreator()))  // Option<Vec<MetadataCreator>>
List<MetadataCreator>? creators,

@BFixedArray(3, BFixedArray(2, BU8()))  // [[u8; 2]; 3]
List<List<int>> matrix,
```

**What's NOT supported**: No signed integers (`i8/i16/i32/i64`), no floats (`f32/f64`), no enums, no maps, no sets, no tuples, no 128-bit integers. If you need these, you write a custom `BType` subclass.

### BinaryReader — The Cursor

`BinaryReader` wraps a `ByteData` buffer with an auto-advancing offset:

```dart
final reader = BinaryReader(data.buffer.asByteData());

final count = reader.readU8();       // reads 1 byte, advances offset by 1
final amount = reader.readU64();     // reads 8 bytes LE, returns BigInt, advances by 8
final name = reader.readString();    // reads u32 length, then UTF-8 bytes, advances by 4+len
final items = reader.readArray<int>((r) => r.readU8());  // u32 count + N reads
```

All multi-byte reads use **little-endian** byte order. `readU64` decodes via custom `_decodeBigInt` that accumulates LE bytes into a `BigInt`.

If a read would exceed the buffer, `BinaryReader` throws a `RangeError`. This is your most common deserialization error — it means your schema doesn't match the data.

### BinaryWriter — The Buffer

`BinaryWriter` starts with a 1024-byte buffer and auto-resizes (grows by 1024 bytes when fewer than 16 bytes remain):

```dart
final writer = BinaryWriter();

writer.writeU8(1);
writer.writeU64(BigInt.from(1000000));
writer.writeString('hello');
writer.writeFixedArray<int>([1, 2, 3], (w, v) => w.writeU8(v));
writer.writeArray<int>([1, 2, 3], (w, v) => w.writeU8(v));  // writes u32 length first
writer.writeStruct(nestedStruct.toBorsh());   // raw bytes, no length prefix

final bytes = writer.toArray();  // Uint8List trimmed to actual length
```

---

### The Generated Code — What build_runner Actually Produces

For this class:

```dart
@BorshSerializable()
class Vault with _$Vault {
  factory Vault({
    @BU64() required BigInt balance,
    @BString() required String owner,
    @BOption(BU32()) int? lastWithdrawSlot,
  }) = _Vault;

  const Vault._();

  factory Vault.fromBorsh(Uint8List data) => _$VaultFromBorsh(data);
}
```

The generator produces **four artifacts** in the `.g.dart` part file:

**1. Mixin `_$Vault`** — provides getters and `toBorsh()`:

```dart
mixin _$Vault {
  BigInt get balance => throw UnimplementedError();
  String get owner => throw UnimplementedError();
  int? get lastWithdrawSlot => throw UnimplementedError();

  Uint8List toBorsh() {
    final writer = BinaryWriter();
    const BU64().write(writer, balance);
    const BString().write(writer, owner);
    const BOption(BU32()).write(writer, lastWithdrawSlot);
    return writer.toArray();
  }
}
```

**2. Private class `_Vault`** — the actual data holder:

```dart
class _Vault extends Vault {
  _Vault({required this.balance, required this.owner, this.lastWithdrawSlot}) : super._();
  final BigInt balance;
  final String owner;
  final int? lastWithdrawSlot;
}
```

**3. BType class `BVault`** — makes `Vault` composable in other structs:

```dart
class BVault implements BType<Vault> {
  const BVault();

  @override
  void write(BinaryWriter writer, Vault value) {
    writer.writeStruct(value.toBorsh());
  }

  @override
  Vault read(BinaryReader reader) {
    return Vault(
      balance: const BU64().read(reader),
      owner: const BString().read(reader),
      lastWithdrawSlot: const BOption(BU32()).read(reader),
    );
  }
}
```

**4. Top-level factory**:

```dart
Vault _$VaultFromBorsh(Uint8List data) {
  final reader = BinaryReader(data.buffer.asByteData());
  return const BVault().read(reader);
}
```

> **WHY THIS MATTERS**: The generated `BVault` class is what makes composition work. When you annotate a field with `@BVault()`, the generator emits `const BVault().write(writer, value)` — which calls `toBorsh()` on the nested struct and writes the raw bytes. No length prefix for structs, just bytes concatenated in order.

### The Required Class Pattern

Every `@BorshSerializable` class must follow this exact shape:

```dart
@BorshSerializable()
class ClassName with _$ClassName {           // 1. Mixin
  factory ClassName({                        // 2. Factory constructor
    @BTypeAnnotation() required Type field,  // 3. Annotated fields
  }) = _ClassName;                           // 4. Redirect to generated class

  const ClassName._();                       // 5. Private named constructor

  factory ClassName.fromBorsh(Uint8List data) => _$ClassNameFromBorsh(data);  // 6. Deserialize factory
}
```

The generator reads constructor parameters and their `@BType()` annotation metadata. It strips the `@` from the annotation source text and uses it as a `const` constructor call in the generated code. This is why `@BFixedArray(3, BU8())` works — the generator emits `const BFixedArray(3, BU8())`.

---

## Patterns & Recipes

### Real-World: SPL Token Mint Account

```dart
@BorshSerializable()
class RawMint with _$RawMint {
  factory RawMint({
    @BU32() required int mintAuthorityOption,   // 0 = None, 1 = Some
    @BPublicKey() required Ed25519HDPublicKey mintAuthority,
    @BU64() required BigInt supply,
    @BU8() required int decimals,
    @BBool() required bool isInitialized,
    @BU32() required int freezeAuthorityOption,
    @BPublicKey() required Ed25519HDPublicKey freezeAuthority,
  }) = _RawMint;

  const RawMint._();

  factory RawMint.fromBorsh(Uint8List data) => _$RawMintFromBorsh(data);
}
```

Notice `mintAuthorityOption` is a `@BU32()`, not a `@BOption()`. That's because SPL Token's on-chain layout uses a manual `u32` flag + full `Pubkey` field (always 32 bytes, zeroed when None) — not Borsh's standard `Option<T>` encoding. You must match the on-chain layout exactly, even when it's weird.

### Custom BType for Unsupported Formats

```dart
class BTimestamp implements BType<DateTime> {
  const BTimestamp();

  @override
  void write(BinaryWriter writer, DateTime value) {
    const BU64().write(writer, BigInt.from(value.millisecondsSinceEpoch ~/ 1000));
  }

  @override
  DateTime read(BinaryReader reader) {
    final seconds = const BU64().read(reader);
    return DateTime.fromMillisecondsSinceEpoch(seconds.toInt() * 1000);
  }
}

// Usage:
@BorshSerializable()
class MyState with _$MyState {
  factory MyState({
    @BTimestamp() required DateTime createdAt,
  }) = _MyState;
  // ...
}
```

### Skipping Anchor Discriminators

Anchor accounts start with an 8-byte discriminator. To deserialize:

```dart
factory MyAnchorAccount.fromAccountData(Uint8List data) {
  // Skip the 8-byte discriminator
  return MyAnchorAccount.fromBorsh(data.sublist(8));
}
```

---

## How Borsh Encodes Data — Byte by Byte

Understanding the wire format helps when debugging:

```
u8:     [0x05]                                    → 5
u16:    [0x05, 0x00]                              → 5 (little-endian)
u32:    [0x05, 0x00, 0x00, 0x00]                  → 5 (little-endian)
u64:    [0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] → 5

String: [0x05, 0x00, 0x00, 0x00, 0x68, 0x65, 0x6C, 0x6C, 0x6F]
         └── length=5 (u32) ─────┘ └──── "hello" UTF-8 ────────┘

Vec<T>: [0x03, 0x00, 0x00, 0x00, elem0, elem1, elem2]
         └── count=3 (u32) ─────┘

Option: [0x00]              → None
        [0x01, ...value]    → Some(value)

Struct: [field0_bytes][field1_bytes][field2_bytes]  ← no delimiters, no padding
```

Fields are serialized in declaration order. The schema is the ONLY thing that tells you where one field ends and the next begins. Get the order wrong and everything after the mismatch reads garbage.

---

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| `RangeError` on deserialization | Schema doesn't match on-chain data layout | Hex-dump the bytes and walk through with the Rust struct definition |
| Wrong values but no error | Field order mismatch between Dart and Rust | Match field declaration order exactly to the Rust struct |
| `int` overflow for token amounts | Used `@BU32()` for a `u64` field | Use `@BU64()` with `BigInt` for all amounts, balances, timestamps |
| Missing 8 bytes at start | Anchor discriminator not skipped | `data.sublist(8)` before calling `fromBorsh()` |
| Option field always reads wrong | SPL uses `u32 flag + full value` not Borsh's `u8 + optional value` | Match the actual on-chain encoding, not the logical semantics |
| Build fails: "No associated BType" | Forgot to run `build_runner` for the nested struct's package | Ensure all dependencies with `@BorshSerializable` classes have been generated |
| Generated code missing | Part file not included | Add `part 'filename.g.dart';` at the top of the file |

---

## API Quick Reference

| Type | Package | Purpose |
|------|---------|---------|
| `BType<T>` | `borsh_annotation` | Abstract base — `read(reader)` / `write(writer, value)` |
| `BU8`, `BU16`, `BU32`, `BU64` | `borsh_annotation` | Unsigned integers (u64 → BigInt) |
| `BString` | `borsh_annotation` | Length-prefixed UTF-8 string |
| `BFixedArray(len, type)` | `borsh_annotation` | Fixed-length array (no prefix) |
| `BArray(type)` | `borsh_annotation` | Dynamic array (u32 prefix) |
| `BOption(type)` | `borsh_annotation` | Nullable (1 byte flag + optional value) |
| `BBool` | `solana` | Boolean (1 byte) |
| `BPublicKey` | `solana` | Ed25519 public key (32 bytes fixed) |
| `BinaryReader` | `borsh_annotation` | Cursor-based deserializer with offset tracking |
| `BinaryWriter` | `borsh_annotation` | Auto-resizing serialization buffer |
| `@BorshSerializable()` | `borsh_annotation` | Marker annotation for code generation |

---

## Related

- [The solana Package](solana-package) — Uses Borsh for account data, transaction encoding, Metaplex
- [coral_xyz](coral-xyz/) — Auto-generates Borsh schemas from Anchor IDLs
- [Token Operations](token-ops) — SPL token accounts use Borsh-like binary layouts
