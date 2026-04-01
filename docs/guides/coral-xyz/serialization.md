# Serialization — Borsh Encoding and Zero-Copy Decoding

> How `coral_xyz` turns Dart values into bytes for the chain, and how it reads bytes back into Dart types. Two serialization systems, one unified API.

## Overview

Solana programs store data as raw bytes. When your Dart app sends an instruction or reads an account, something needs to convert between Dart types and byte arrays. `coral_xyz` has two serialization systems:

- **Borsh** — Binary Object Representation Serializer for Hashing. Sequential reads/writes. Used by Anchor programs.
- **Zero-copy** — Direct byte-offset reads from a `ByteData` buffer. Used by Quasar, Pinocchio, and manually-defined programs.

You don't choose between them. The `AutoCoder` dispatches based on the IDL's detected format. But understanding both matters for debugging — when field values are wrong, the serialization layer is usually where things went sideways.

---

## Quick Start

```dart
import 'package:coral_xyz/coral_xyz.dart';

// Encoding an instruction (both frameworks use BorshInstructionCoder)
final coder = CoderFactory.fromIdl(idl);
final encoded = coder.instructions.encode('deposit', {'amount': BigInt.from(1000000000)});
// encoded = [discriminator (8 bytes)] + [amount as u64 LE (8 bytes)]

// Decoding an account — coder chosen automatically by idl.format
final decoded = coder.accounts.decode<Map<String, dynamic>>('Counter', rawBytes);
// decoded = {'authority': PublicKey(...), 'count': BigInt.from(42)}
```

---

## Core Concepts

### The Coder Stack

Every `Program` object holds a `Coder` with four sub-coders:

| Sub-coder | Purpose | Framework differences |
|-----------|---------|----------------------|
| `InstructionCoder` | Encode instruction args + discriminator | Same for all frameworks (Borsh) |
| `AccountsCoder` | Decode on-chain account data | **Borsh** for Anchor, **zero-copy** for Quasar/Manual/Codama |
| `EventCoder` | Decode event data from transaction logs | Same for all (Borsh), but discriminator scheme differs |
| `TypesCoder` | Encode/decode user-defined types | Same for all (Borsh) |

The `AutoCoder` factory wires the right `AccountsCoder` based on `idl.format`:

```dart
class AccountsCoderFactory {
  static AccountsCoder<String> create(Idl idl) {
    switch (idl.format) {
      case IdlFormat.anchor: return BorshAccountsCoder(idl);
      default:               return ZeroCopyAccountsCoder(idl);
    }
  }
}
```

### Borsh Serialization (Anchor)

Borsh is a deterministic binary format — the same data always produces the same bytes. It reads and writes fields sequentially.

#### Encoding

`BorshSerializer` writes values to an internal byte buffer:

```dart
final serializer = BorshSerializer();
serializer.writeU8(1);                   // 1 byte
serializer.writeU64(BigInt.from(1000));   // 8 bytes, little-endian
serializer.writeString('hello');          // 4-byte length + UTF-8 bytes
serializer.writeBool(true);              // 1 byte (0x01)
final bytes = serializer.toBytes();
```

The instruction coder uses this internally. When you call `coder.instructions.encode('deposit', {'amount': 1000})`, it:

1. Looks up the `deposit` instruction layout from the IDL
2. Computes the discriminator (`SHA256("global:deposit")[0..8]` for Anchor, or explicit bytes for Quasar)
3. Serializes each arg in IDL-declared order using `BorshSerializer`
4. Returns `discriminator + serialized args`

#### Decoding

`BorshDeserializer` reads from a byte array with an advancing offset:

```dart
final deserializer = BorshDeserializer(bytes);
final a = deserializer.readU8();       // reads 1 byte, offset advances
final b = deserializer.readU64();      // reads 8 bytes, offset advances
final s = deserializer.readString();   // reads 4-byte length, then that many UTF-8 bytes
```

`BorshAccountsCoder.decode()` skips the discriminator bytes, then reads each field from the IDL's type definition in order. If any field size is wrong, every subsequent field reads from the wrong offset — this is the most common cause of garbled account data.

#### BigInt Handling

`writeU64()` accepts both `int` and `BigInt`:

```dart
serializer.writeU64(42);                    // int — splits into two u32s
serializer.writeU64(BigInt.from(42));       // BigInt — writes 8 bytes via bit-shifting
```

`readU64()` returns `int` in the Borsh deserializer. This means the full u64 range (0 to 2^64-1) can overflow Dart's 64-bit signed `int`. For values > 2^63-1, use zero-copy decoding or handle the value as unsigned manually.

### Zero-Copy Decoding (Quasar / Manual / Codama)

Zero-copy doesn't read sequentially — it reads fields at known byte offsets directly from a `ByteData` view. This is faster (no cumulative offset tracking) and matches the `repr(C)` memory layout that Quasar programs use on-chain.

#### How It Works

For an account type like:

```json
{
  "name": "Counter",
  "type": {
    "kind": "struct",
    "fields": [
      { "name": "authority", "type": "pubkey" },
      { "name": "count", "type": "u64" }
    ]
  }
}
```

With a 1-byte discriminator `[0]`, the wire layout is:

```
Offset 0:   discriminator (1 byte)
Offset 1:   authority (32 bytes — publicKey)
Offset 33:  count (8 bytes — u64, little-endian)
Total: 41 bytes
```

`ZeroCopyAccountsCoder` computes these offsets from the type definition and reads each field using `ByteData.getUint8()`, `getUint64()`, etc.

#### Type Return Differences

| Type | Borsh returns | Zero-copy returns |
|------|--------------|------------------|
| `u8`–`u32`, `i8`–`i32` | `int` | `int` |
| `u64`, `i64` | `int` | `BigInt` |
| `u128`, `i128` | not supported | `BigInt` |
| `f32`, `f64` | `double` | `double` |
| `publicKey` | `PublicKey` | `Uint8List` (32 bytes) |
| `string`, `dynString` | `String` | `String` |
| `vec`, `dynVec` | `List` | `List` |
| `option` | `T?` | `T?` |
| `coption` | not supported | `T?` (4-byte tag) |
| `tail` | not supported | `Uint8List` |

> **WHY THIS MATTERS**: The `BigInt` vs `int` difference for `u64` is the most common surprise when working with Quasar programs. If your code does `final count = data['count'] as int`, it works for Anchor but throws `TypeError` for Quasar. Defensive pattern:
>
> ```dart
> final raw = data['count'];
> final count = raw is BigInt ? raw.toInt() : raw as int;
> ```

#### Quasar-Specific Types

Zero-copy supports three types that Borsh doesn't:

**`dynString(maxLength)`** — A string with a maximum byte allocation. Wire format: 4-byte LE length prefix + UTF-8 bytes. The `maxLength` sets the maximum allocation in the account, but the actual bytes read are determined by the length prefix.

**`dynVec(items, maxLength)`** — A vector with a maximum element count. Wire format: 4-byte LE count prefix + elements.

**`tail(element)`** — Consumes all remaining bytes in the buffer and returns them as a `Uint8List`. This is used for variable-length trailing data.

**`coption(T)`** — C-style option with a 4-byte tag instead of Borsh's 1-byte tag:

- `0x00000000` → `null`
- `0x01000000` → value follows

### Instruction Encoding — Same for All Frameworks

Regardless of IDL format, instruction encoding always uses `BorshInstructionCoder`. The framework difference is only in the discriminator:

```dart
final encoded = coder.instructions.encode('initialize', {'value': 42});

// For Anchor IDL:   [8 SHA256 bytes] + [Borsh-encoded args]
// For Quasar IDL:   [1-7 explicit bytes] + [Borsh-encoded args]
```

The coder looks up the IDL instruction's discriminator field. If it's an explicit list of < 8 bytes, it uses those directly. Otherwise, it computes the SHA256 hash.

### Instruction Decoding

`BorshInstructionCoder.decode()` can identify which instruction raw bytes represent:

```dart
final instruction = coder.instructions.decode(rawInstructionData);
if (instruction != null) {
  print(instruction.name);    // 'deposit'
  print(instruction.data);    // {'amount': 1000000000}
}
```

It tries every instruction layout's discriminator until one matches, then Borsh-decodes the remaining args.

---

## Patterns & Recipes

### Encoding Custom Types

For types not in the IDL (or for manual encoding):

```dart
final serializer = BorshSerializer();

// Struct: encode fields in order
serializer.writeString('Alice');
serializer.writeU64(BigInt.from(1000));

// Vec: write length, then elements
serializer.writeU32(3);
serializer.writeU8(1);
serializer.writeU8(2);
serializer.writeU8(3);

// Option<T>: 0x00 for null, 0x01 + value for Some
serializer.writeOption<int>(
  42,
  (s, v) => s.writeU32(v),
);
```

### Debugging Byte Layouts

When account data doesn't decode correctly:

```dart
// 1. Get raw bytes
final accountInfo = await connection.getAccountInfo(address);
final data = accountInfo!.data;

// 2. Check the discriminator
final disc = data.sublist(0, 8);
print('Discriminator: $disc');

// 3. Check what the coder expects
final expected = coder.accounts.accountDiscriminator('Counter');
print('Expected: $expected');

// 4. Check format
print('IDL format: ${idl.format}');
print('Coder type: ${coder.accounts.runtimeType}');
```

### Checking Account Size

```dart
// Get the expected byte size of an account type (including discriminator)
final size = program.account['Counter']!.size;
print('Counter accounts should be $size bytes');

// This is useful for computing rent-exemption:
final rent = await connection.getMinimumBalanceForRentExemption(size);
```

---

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| All fields after the first are wrong | Borsh sequential read went off-track — one field was the wrong size | Hex-dump the data, count bytes manually against the IDL fields |
| `u64` value is negative or overflowed | Borsh `readU64()` returns signed `int` | Use zero-copy coder for programs with large u64 values, or handle `BigInt` explicitly |
| `RangeError: Not enough data` | Account data is shorter than expected — wrong IDL or account not initialized | Check account data length vs `coder.accounts.size(accountName)` |
| `coption` field always null | Borsh coder doesn't support `coption` (4-byte tag) — reads 1-byte tag | Ensure IDL format is detected as `quasar` or `manual` so zero-copy coder is used |
| `defined` type throws during deserialization | Borsh `readIdlType()` can't resolve `defined` types without full IDL context | Use the coder's `decode(accountName, data)` instead of raw deserializer |

---

## Related

- [IDL Deep Dive](idl-basics) — Type system, format detection
- [Account Resolution](account-resolution) — How decoded data gets to your app
- [coral_xyz Overview](.) — Architecture and quick start
