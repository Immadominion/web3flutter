# Account Resolution — PDAs, Auto-Resolution, and Account Decoding

> How `coral_xyz` derives program addresses, auto-resolves instruction accounts from IDL hints, and decodes on-chain data.

## Overview

Every Solana instruction requires the exact list of accounts it touches — right address, right mutability, right signer flag. The IDL tells you which accounts an instruction needs. But it doesn't always tell you where those accounts live on-chain. That's what account resolution solves.

`coral_xyz` has three layers:

1. **PDA derivation** — compute addresses from seeds and a program ID
2. **AccountsResolver** — automatically resolve accounts using IDL hints (fixed addresses, PDA specs, well-known programs, signer defaults)
3. **Account decoding** — fetch raw bytes from the chain and turn them into typed Dart maps

---

## Quick Start

```dart
import 'package:coral_xyz/coral_xyz.dart';

// PDA derivation — manual
final result = PdaDerivationEngine.findProgramAddress(
  [PdaUtils.string('vault'), PdaUtils.publicKey(userPubkey)],
  programId,
);
print(result.address);  // the derived PublicKey
print(result.bump);     // the bump seed (255 down to 0)

// Auto-resolution — let the builder figure it out from IDL
final sig = await program.methods['deposit']!([amount])
    .accounts({'user': userPubkey})     // provide what you know
    .rpc();                              // resolver fills in the rest
```

---

## Core Concepts

### PDA Derivation Engine

Program Derived Addresses (PDAs) are deterministic — given the same seeds and program ID, you always get the same address. The `PdaDerivationEngine` wraps the standard Solana PDA algorithm:

1. Concatenate all seed bytes
2. Append a bump byte (starts at 255, decrements until valid)
3. Append the program ID bytes
4. Append the `"ProgramDerivedAddress"` constant
5. SHA256 hash
6. Check the result is NOT on the Ed25519 curve (PDAs must not be valid public keys)

```dart
class PdaDerivationEngine {
  static PdaResult findProgramAddress(List<PdaSeed> seeds, PublicKey programId);
  static PublicKey createProgramAddress(List<PdaSeed> seeds, PublicKey programId);
  static bool validateProgramAddress(PublicKey address, List<PdaSeed> seeds, PublicKey programId);
  static List<PdaResult> findProgramAddressBatch(
    List<List<PdaSeed>> seedCombinations, PublicKey programId,
  );
}
```

`findProgramAddress` returns a `PdaResult` with both the `address` and the `bump` that made it valid. `createProgramAddress` takes an explicit bump (useful when you already know it from on-chain data). `findProgramAddressBatch` derives multiple PDAs efficiently.

#### Typed Seeds

Seeds aren't raw bytes — they're typed through the `PdaSeed` hierarchy:

| Seed class | Factory | Input → Bytes |
|-----------|---------|--------------|
| `StringSeed` | `PdaUtils.string('vault')` | UTF-8 encoded |
| `BytesSeed` | `PdaUtils.bytes(data)` | raw bytes (max 32) |
| `PublicKeySeed` | `PdaUtils.publicKey(key)` | 32 bytes of the public key |
| `NumberSeed` | `PdaUtils.number(42, byteLength: 4)` | 1/2/4/8 bytes, little-endian |

> **CRITICAL**: Seeds must match the exact bytes the Rust program uses. If the program has `seeds = [b"vault", user.key().as_ref()]`, your Dart code must use `PdaUtils.string('vault')` (UTF-8 bytes of "vault") and `PdaUtils.publicKey(userPubkey)` (32 bytes). Using `user.toBase58()` instead of the raw public key bytes is wrong — that's a 44-byte base58 string, not a 32-byte key.

---

### The AccountsResolver

When you call `.accounts()` on a `TypeSafeMethodBuilder`, you only need to provide the accounts you know. The `AccountsResolver` fills in the rest using IDL metadata.

Resolution happens in three phases:

#### Phase 1: Constant Accounts

For each account the instruction needs, the resolver checks (in priority order):

1. **Already provided** — you passed it in `.accounts()` → skip
2. **IDL-specified address** — the account has a fixed `address` field in the IDL → use it directly
3. **Well-known program** — the name matches a known program:
   - `systemProgram` / `system_program` → `SystemProgram.programId`
4. **Default signer** — account is marked as `signer` with no PDA spec → use `provider.publicKey` (the wallet)

#### Phase 2: Derived Accounts (PDA Resolution)

For accounts with a `pda` specification in the IDL, the resolver derives the address from seeds:

```dart
// IDL encodes PDA seeds like this:
{
  "name": "vault",
  "pda": {
    "seeds": [
      { "kind": "const", "value": [118, 97, 117, 108, 116] },  // "vault"
      { "kind": "account", "path": "user" }
    ]
  }
}
```

The resolver converts each seed:

- `IdlSeedConst` → literal bytes from `value`
- `IdlSeedAccount` → looks up the account in already-resolved accounts → 32-byte public key
- `IdlSeedArg` → looks up the value in instruction args → converts based on type:
  - `u8` → 1 byte, `u16`/`i16` → 2 bytes, `u32`/`i32` → 4 bytes, `u64`/`i64` → 8 bytes
  - `string`/`dynString` → UTF-8 bytes
  - `publicKey`/`pubkey` → 32 bytes
  - `bool` → 1 byte (`0x00` or `0x01`)

Then calls `PublicKeyUtils.findProgramAddress(seeds, programId)`.

> **WHY THIS MATTERS**: PDA resolution is iterative — up to 16 passes. A PDA might depend on another account that is itself a PDA. The resolver keeps looping until no new accounts are resolved or it hits the depth limit. This handles chains like: account A's seed references account B, and account B's seed references account C (which the user provided).

#### Phase 3: Relations

Some IDL accounts declare `relations` — they copy their address from another account:

```json
{ "name": "userTokenAccount", "relations": ["user"] }
```

If `user` was resolved in Phase 1 or 2, `userTokenAccount` gets the same address.

#### What Happens When Resolution Fails

If any **required** account (not marked `optional` in the IDL) remains unresolved after all three phases, the resolver throws a `StateError` listing the missing accounts. The fix is usually to provide more accounts explicitly in `.accounts()` or `.accountsPartial()`.

```dart
// accountsPartial allows null values — useful for partial resolution
await program.methods['transfer']!([amount])
    .accountsPartial({
      'from': fromAccount,
      'to': toAccount,
      // let resolver figure out systemProgram, authority, etc.
    })
    .rpc();
```

---

### Account Decoding

Once you have an address, fetching and decoding account data is handled by the `AccountNamespace`:

```dart
final counterClient = program.account['Counter']!;

// Fetch a single account — returns Map<String, dynamic> or null
final data = await counterClient.fetch(counterAddress);
// data == {'authority': PublicKey(...), 'count': BigInt.from(42)}

// Fetch multiple accounts in one RPC call
final results = await counterClient.fetchMultiple([addr1, addr2, addr3]);

// Fetch ALL accounts of this type
final all = await counterClient.all();
// Returns List<ProgramAccount> — each has .publicKey and .account

// Filter accounts using memcmp
final filtered = await counterClient.fetchAll(
  filters: [/* AccountFilter objects */],
);
```

#### Discriminator-Based Type Matching

When `AccountClient.fetch()` reads raw bytes, the coder checks the discriminator prefix:

- **Anchor**: first 8 bytes must match `SHA256("account:{AccountName}")[0..8]`
- **Quasar**: first N bytes must match the explicit discriminator from the IDL

If the discriminator doesn't match, the coder returns `null` (for `fetch`) or skips the account (for `all`). This is how the SDK distinguishes a `Counter` account from a `Vault` account — the byte prefix identifies the type.

#### `decodeAny` — Unknown Account Type

When you have raw bytes but don't know which account type they represent:

```dart
final decoded = program.coder.accounts.decodeAny<Map<String, dynamic>>(rawBytes);
```

This tries every known account discriminator until one matches. Useful for explorers or debugging tools.

#### Borsh vs Zero-Copy Decoding

The `AccountsCoderFactory` routes based on IDL format:

| Format | Coder | How it reads |
|--------|-------|-------------|
| `anchor` | `BorshAccountsCoder` | Sequential `BorshDeserializer` — reads field after field from a byte stream |
| `quasar` / `manual` / `codama` | `ZeroCopyAccountsCoder` | Direct `ByteData` reads at computed byte offsets |

**Borsh** reads sequentially: skip discriminator, read field 1, read field 2, etc. Each read advances an internal offset. If any field is the wrong size, every subsequent field is corrupt.

**Zero-copy** reads at fixed offsets: discriminator at offset 0, field 1 at offset N, field 2 at offset M. The offsets come from the type definition. This is faster and doesn't cascade errors, but requires the on-chain layout to use `repr(C)` (C struct alignment, no Borsh length prefixes for fixed-size fields).

> **GOTCHA**: Zero-copy returns `BigInt` for all 64-bit and 128-bit integer types (`u64`, `i64`, `u128`, `i128`). Borsh returns `int` for `u64` via `readU64()`. If you switch a program from Anchor to Quasar serialization, your Dart code that does `count as int` will throw a `TypeError`. Always check: `count is BigInt ? count.toInt() : count as int`.

#### Real-Time Account Subscriptions

`AccountClient` supports WebSocket subscriptions for live updates:

```dart
final stream = counterClient.subscribe(counterAddress);
await for (final updated in stream) {
  print('Count changed: ${updated['count']}');
}

// Or with manual listener management
counterClient.unsubscribe(counterAddress);
```

The subscription uses the `Connection.onAccountChange()` WebSocket method. Each update re-decodes the account data with the appropriate coder.

---

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| PDA doesn't match the on-chain address | Seed bytes don't match the Rust program — wrong encoding, wrong order, or wrong program ID | Print both the Dart PDA and the on-chain address. Compare seed bytes one by one |
| `StateError: Missing required accounts` | Resolver can't derive the account — seed dependency isn't resolved | Provide more accounts in `.accounts()`, or check the IDL's PDA seed definitions |
| Decoded account data is all zeros or wrong | Borsh coder used on zero-copy data or vice versa | Check `program.idl.format` — format detection may have failed |
| `TypeError: BigInt is not int` | Zero-copy decoded a u64 field as `BigInt`, code expects `int` | Use conditional: `value is BigInt ? value.toInt() : value as int` |
| `fetchMultiple` returns nulls for valid accounts | Discriminator mismatch — account was created by a different program version | Re-fetch the IDL or use `decodeUnchecked` to skip discriminator validation |

---

## Related

- [coral_xyz Overview](.) — Architecture and quick start
- [IDL Deep Dive](idl-basics) — Format detection, discriminator computation, type system
- [Serialization](serialization) — Borsh and zero-copy encoding details
