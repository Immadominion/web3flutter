# borsh — Borsh Serialization for Dart

> Code generator and runtime types for serializing/deserializing Solana on-chain data in Borsh binary format. Two packages: `borsh_annotation` (types + reader/writer) and `borsh` (code generator).

## Overview

Borsh (Binary Object Representation Serializer for Hashing) is Solana's standard serialization format. Every instruction you send and every account you read uses Borsh encoding. These two packages give you Borsh in Dart:

- `borsh_annotation` — Runtime types (`BType` hierarchy), `BinaryReader`, `BinaryWriter`, `@BorshSerializable` annotation
- `borsh` — `build_runner` code generator that processes `@BorshSerializable` and generates serialization code

The `solana` package already depends on `borsh_annotation` and adds its own extended types (`BPublicKey`, `BBool`). You only need the `borsh` package directly if you're defining your own Borsh-serializable structs.

**Package links:** [borsh on pub.dev](https://pub.dev/packages/borsh) / [borsh_annotation on pub.dev](https://pub.dev/packages/borsh_annotation) / [GitHub](https://github.com/espresso-cash/espresso-cash-public/tree/master/packages/borsh)

## Quick Start

```yaml
dependencies:
  borsh_annotation: ^0.3.1+5
  solana: ^0.31.0        # for BPublicKey, BBool

dev_dependencies:
  borsh: ^0.3.1+4
  build_runner: ^2.4.0
```

```dart
import 'dart:typed_data';
import 'package:borsh_annotation/borsh_annotation.dart';

part 'my_struct.g.dart';

@BorshSerializable()
class MyStruct with _$MyStruct {
  factory MyStruct({
    @BU64() required BigInt amount,
    @BString() required String name,
    @BU8() required int status,
  }) = _MyStruct;

  const MyStruct._();

  factory MyStruct.fromBorsh(Uint8List data) => _$MyStructFromBorsh(data);
}
```

```bash
dart run build_runner build
```

```dart
final s = MyStruct(amount: BigInt.from(1000000), name: 'vault', status: 1);
final bytes = s.toBorsh();             // Uint8List
final decoded = MyStruct.fromBorsh(bytes); // roundtrip
```

## Core Concepts

### BType Hierarchy

Every field annotation is a `BType<T>`. These define how to read/write that type:

| Annotation | Dart Type | Bytes | Encoding |
|-----------|-----------|-------|----------|
| `@BU8()` | `int` | 1 | unsigned 8-bit |
| `@BU16()` | `int` | 2 | unsigned 16-bit LE |
| `@BU32()` | `int` | 4 | unsigned 32-bit LE |
| `@BU64()` | `BigInt` | 8 | unsigned 64-bit LE |
| `@BString()` | `String` | 4 + N | u32 length prefix + UTF-8 |
| `@BFixedArray(N, BU8())` | `List<int>` | N × elem | fixed-length array, no prefix |
| `@BArray(BU8())` | `List<int>` | 4 + N × elem | u32 length prefix + elements |
| `@BOption(BU64())` | `BigInt?` | 1 + (0 or 8) | u8 flag (0=none, 1=some) + value |

**Extended types from `solana` package:**

| Annotation | Dart Type | Bytes | Note |
|-----------|-----------|-------|------|
| `@BPublicKey()` | `Ed25519HDPublicKey` | 32 | Fixed 32-byte array |
| `@BBool()` | `bool` | 1 | u8: 0=false, 1=true |

> **CRITICAL**: `BU64` maps to `BigInt`, NOT `int`. Dart's `int` is 64-bit but signed. Solana's `u64` values (lamports, token amounts) can exceed `int` max. Always use `BigInt` for u64 fields.

### The Required Class Pattern

Every `@BorshSerializable()` class MUST follow this exact pattern:

```dart
@BorshSerializable()
class MyStruct with _$MyStruct {              // 1. mixin _$MyStruct
  factory MyStruct({                           // 2. factory constructor
    @BU8() required int field1,                // 3. annotated fields
    @BString() required String field2,
  }) = _MyStruct;                              // 4. redirect to _MyStruct

  const MyStruct._();                          // 5. private constructor

  factory MyStruct.fromBorsh(Uint8List data) => _$MyStructFromBorsh(data); // 6. fromBorsh
}
```

All 6 parts are required. Miss any one and code gen fails silently or produces wrong output.

> **GOTCHA**: The `const MyStruct._();` private constructor is easy to forget. Without it, the factory redirect `= _MyStruct` won't compile because the generated `_MyStruct` extends `MyStruct` and needs a super constructor.

### What the Code Generator Produces

For each `@BorshSerializable()` class, `build_runner` generates 4 artifacts:

**1. Mixin `_$MyStruct`** — abstract getters + `toBorsh()`:

```dart
mixin _$MyStruct {
  int get field1 => throw UnimplementedError();
  String get field2 => throw UnimplementedError();

  Uint8List toBorsh() {
    final writer = BinaryWriter();
    const BU8().write(writer, field1);
    const BString().write(writer, field2);
    return writer.toArray();
  }
}
```

**2. Private class `_MyStruct`** — actual field storage:

```dart
class _MyStruct extends MyStruct {
  _MyStruct({required this.field1, required this.field2}) : super._();
  @override final int field1;
  @override final String field2;
}
```

**3. BType class `BMyStruct`** — enables nesting:

```dart
class BMyStruct implements BType<MyStruct> {
  const BMyStruct();
  void write(BinaryWriter writer, MyStruct value) {
    writer.writeStruct(value.toBorsh());
  }
  MyStruct read(BinaryReader reader) {
    return MyStruct(
      field1: const BU8().read(reader),
      field2: const BString().read(reader),
    );
  }
}
```

**4. Top-level factory `_$MyStructFromBorsh`**:

```dart
MyStruct _$MyStructFromBorsh(Uint8List data) {
  final reader = BinaryReader(data.buffer.asByteData());
  return const BMyStruct().read(reader);
}
```

> **WHY THIS MATTERS**: The generated `BMyStruct` class is the key to struct composition. When you have a nested struct, annotate that field with `@BMyStruct()` — the generated BType handles recursive serialization automatically.

### Struct Composition (Nesting)

```dart
@BorshSerializable()
class Inner with _$Inner {
  factory Inner({
    @BU32() required int x,
    @BU32() required int y,
  }) = _Inner;
  const Inner._();
  factory Inner.fromBorsh(Uint8List data) => _$InnerFromBorsh(data);
}

@BorshSerializable()
class Outer with _$Outer {
  factory Outer({
    @BString() required String name,
    @BInner() required Inner position,    // uses generated BInner type
    @BArray(BInner()) required List<Inner> history, // array of structs
  }) = _Outer;
  const Outer._();
  factory Outer.fromBorsh(Uint8List data) => _$OuterFromBorsh(data);
}
```

### BinaryReader / BinaryWriter (Manual Use)

For cases where code gen isn't needed (simple reads, skipping fields):

```dart
import 'package:borsh_annotation/borsh_annotation.dart';

// Writing
final writer = BinaryWriter();
writer.writeU8(1);                    // instruction discriminator
writer.writeU64(BigInt.from(1000));   // amount
writer.writeString('hello');          // length-prefixed string
final bytes = writer.toArray();       // Uint8List

// Reading
final reader = BinaryReader(bytes.buffer.asByteData());
final disc = reader.readU8();
final amount = reader.readU64();        // BigInt
final name = reader.readString();
```

> **GOTCHA**: `BinaryReader` tracks its offset internally. Read fields in EXACTLY the same order they were written. Borsh is NOT self-describing — there are no field tags or type markers. If you read a `u64` where a `u32` was written, every subsequent field is offset by 4 bytes and returns garbage.

### Skipping Discriminators

Anchor programs prepend an 8-byte discriminator to accounts. Skip it before reading:

```dart
final accountData = base64Decode(accountInfo.data as String);
final reader = BinaryReader(accountData.buffer.asByteData());

// Skip 8-byte Anchor discriminator
for (var i = 0; i < 8; i++) {
  reader.readU8();
}

// Now read the actual struct fields
final count = reader.readU64();
final authority = const BPublicKey().read(reader);
```

Or if using `@BorshSerializable`, include the discriminator as a field:

```dart
@BorshSerializable()
class AnchorAccount with _$AnchorAccount {
  factory AnchorAccount({
    @BFixedArray(8, BU8()) required List<int> discriminator, // skip these
    @BU64() required BigInt count,
    @BPublicKey() required Ed25519HDPublicKey authority,
  }) = _AnchorAccount;
  const AnchorAccount._();
  factory AnchorAccount.fromBorsh(Uint8List data) => _$AnchorAccountFromBorsh(data);
}
```

### Custom BType

For types the package doesn't cover, extend `BType`:

```dart
class BTimestamp extends BType<DateTime> {
  const BTimestamp();

  @override
  void write(BinaryWriter writer, DateTime value) {
    writer.writeI64(BigInt.from(value.millisecondsSinceEpoch ~/ 1000));
  }

  @override
  DateTime read(BinaryReader reader) {
    final unixSeconds = reader.readI64();
    return DateTime.fromMillisecondsSinceEpoch(
      unixSeconds.toInt() * 1000,
      isUtc: true,
    );
  }
}

// Use it:
@BorshSerializable()
class Event with _$Event {
  factory Event({
    @BTimestamp() required DateTime createdAt,
    @BString() required String name,
  }) = _Event;
  const Event._();
  factory Event.fromBorsh(Uint8List data) => _$EventFromBorsh(data);
}
```

## Patterns & Recipes

### Decoding Raw Account Data

```dart
import 'package:solana/solana.dart';

final accountInfo = await rpc.getAccountInfo(
  address,
  encoding: Encoding.base64,
);

if (accountInfo.value == null) throw Exception('Account not found');

// base64 decode the raw data
final rawData = accountInfo.value!.data as BinaryAccountData;
final bytes = rawData.data; // List<int>

// Decode with your struct
final myData = MyStruct.fromBorsh(Uint8List.fromList(bytes));
```

### Building Instruction Data Manually

```dart
final writer = BinaryWriter();

// Anchor 8-byte discriminator
final discriminator = sha256.convert(utf8.encode('global:initialize')).bytes.sublist(0, 8);
for (final b in discriminator) {
  writer.writeU8(b);
}

// Instruction arguments
writer.writeU64(BigInt.from(1000000)); // amount
writer.writeString('My Token');         // name

final instructionData = ByteArray(writer.toArray());
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Using `int` for `@BU64()` | Dart habit. `BU64` reads/writes `BigInt` | Always use `BigInt` for u64 fields |
| Missing `const MyStruct._()` | Looks optional but isn't | Required for the factory redirect pattern |
| Wrong field order | Borsh is positional, not named | Match Rust struct field order EXACTLY |
| Forgetting `part 'file.g.dart'` | Code gen can't write to file | Must be at top of file |
| Using `@BOption(BU32())` for Rust `Option<u32>` where program uses a flag field | Some programs use `u32(0)` as "none" instead of Borsh Option | Check the actual on-chain encoding, don't assume |
| Not running `build_runner` after changes | Generated code is stale | `dart run build_runner build --delete-conflicting-outputs` |

## Related

- [solana-core.md](solana-core.md) — RPC, transactions, program interaction
- [coral-xyz.md](coral-xyz.md) — Anchor programs (use IDL-driven code gen instead of manual Borsh for Anchor)
- [spl-token.md](spl-token.md) — Token program uses Borsh-annotated structs (RawMint, etc.)
- [metaplex-nft.md](metaplex-nft.md) — Metaplex uses mixed Borsh + manual parsing
