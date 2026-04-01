# PDA Derivation — How Every Address Is Computed

> Every account in AllDomains lives at a deterministic address derived from seeds and a program ID. This page explains the hashing algorithm, the seed structures, and the four-level domain key derivation that navigates the entire hierarchy.

## Overview

Solana programs don't store data at addresses they choose. They derive addresses deterministically using Program Derived Addresses (PDAs) — public keys that fall off the Ed25519 curve, ensuring no one holds the private key for them. Given the same seeds and program ID, anyone can compute the same address.

AllDomains uses PDAs extensively. Every domain account, every TLD house, every NFT record — they all live at addresses computed from specific seed combinations. The SDK's `pda.dart` and `utils.dart` files contain the derivation functions, and `name_record_handler.dart` ties them together into the domain key algorithm.

If you understand PDA derivation, you can find any AllDomains account from first principles. You don't need an indexer. You don't need the SDK. The chain is the database, and the seeds are the query.

## The Hashing Algorithm

At the core of every name account derivation is one hashing function:

```dart
import 'dart:convert';
import 'package:crypto/crypto.dart';

const String hashPrefix = 'ALT Name Service';

Uint8List getHashedName(String name) {
  final input = hashPrefix + name;       // "ALT Name Service" + name
  final hash = sha256.convert(utf8.encode(input));
  return Uint8List.fromList(hash.bytes);  // 32 bytes
}
```

This function takes a name string, prepends `ALT Name Service`, and returns the SHA256 hash. The result is always 32 bytes — the exact size of a Solana public key.

The hash is deterministic: `getHashedName('miester')` always produces the same 32 bytes. This is what makes the system work — anyone who knows the domain name can compute the hash and derive the account address.

### Why the Prefix Matters

The prefix `ALT Name Service` is not decoration. It's a namespace separator. SNS (Bonfida) uses `SPL Name Service` for the same purpose. Because the prefix is different, `SHA256("ALT Name Service" + "miester")` produces completely different bytes from `SHA256("SPL Name Service" + "miester")`. This means ANS and SNS PDAs can never collide, even for identical domain names.

> **CRITICAL**: If you port code from an SNS example and forget to change the hash prefix, every PDA you derive will be valid but wrong. Your `getAccountInfo` calls will return `null` for accounts that definitely exist, and you'll waste hours debugging before you spot the prefix.

## Seed Structures

After hashing the name, the SDK builds a seed list and calls `findProgramAddress` to derive the PDA. The seed structure is consistent across all name accounts:

```dart
List<Uint8List> getNameServiceSeeds({
  required Uint8List hashedName,
  Ed25519HDPublicKey? nameClass,
  Ed25519HDPublicKey? nameParent,
}) {
  // If nameClass or nameParent is null, use 32 zero bytes
  final classBytes = nameClass?.bytes ?? List.filled(32, 0);
  final parentBytes = nameParent?.bytes ?? List.filled(32, 0);

  return [
    hashedName,                         // 32 bytes — the hashed name
    Uint8List.fromList(classBytes),     // 32 bytes — name class (usually zero)
    Uint8List.fromList(parentBytes),    // 32 bytes — parent account
  ];
}
```

Three seeds, always 32 bytes each:

| Seed | Source | Purpose |
|------|--------|---------|
| Hashed name | `SHA256(hashPrefix + name)` | Identifies the specific name within its parent |
| Name class | Usually zero bytes | Reserved for namespacing (not commonly used in ANS) |
| Name parent | Parent account's public key, or zero bytes | Places this account in the hierarchy |

These seeds get passed to `Ed25519HDPublicKey.createProgramAddress` along with the ANS program ID to produce the final address.

### The Bump Seed

PDAs must be off the Ed25519 curve. The `findProgramAddressWithBump` function tries bump values from 255 down to 0, appending each as a single byte to the seeds until it finds a combination that produces an off-curve point:

```dart
Future<(Ed25519HDPublicKey, int)> findProgramAddressWithBump({
  required List<Iterable<int>> seeds,
  required Ed25519HDPublicKey programId,
}) async {
  for (var bump = 255; bump >= 0; bump--) {
    try {
      final seedsWithBump = [
        ...seeds.map((s) => s.toList()),
        [bump],
      ];
      final address = await Ed25519HDPublicKey.createProgramAddress(
        seeds: seedsWithBump.expand((s) => s),
        programId: programId,
      );
      return (address, bump);
    } catch (_) {
      // This bump puts us on the curve — try the next one
    }
  }
  throw Exception('Could not find valid program address');
}
```

The bump is usually 253–255. The SDK doesn't cache bumps — it re-derives them each time. For most operations this is fine because `findProgramAddress` is called once per domain resolution, not in a loop.

## Domain Key Derivation: The Algorithm

The `getDomainKey()` function in `name_record_handler.dart` is the central algorithm. Given a domain string like `vault.miester.abc`, it splits the string, walks the hierarchy, and returns the final account address.

### Two-Part Domains (domain.tld)

Input: `miester.abc`

```
Step 1: Hash the TLD
  hashedTld = SHA256("ALT Name Service" + ".abc")
  
Step 2: Derive TLD account (parent = Origin TLD Key)
  tldAccount = PDA([hashedTld, zeros, originTldKey], ANS_PROGRAM)
  
Step 3: Hash the domain name
  hashedDomain = SHA256("ALT Name Service" + "miester")
  
Step 4: Derive domain account (parent = TLD account)
  domainAccount = PDA([hashedDomain, zeros, tldAccount], ANS_PROGRAM)
```

The result is a `DomainKeyResult` with `isSub: false` and `parent: null`.

```dart
final result = await getDomainKey('miester.abc');
// result.pubkey  → The domain's on-chain address
// result.isSub   → false
// result.parent  → null
// result.hashed  → SHA256("ALT Name Service" + "miester")
```

### Three-Part Domains (sub.domain.tld)

Input: `vault.miester.abc` (subdomain, `record: false`)

```
Steps 1-4: Same as above — derive the domain account for miester.abc

Step 5: Build subdomain name with prefix
  subName = "\x00" + "vault"    // \x00 prefix = subdomain

Step 6: Hash the prefixed subdomain name
  hashedSub = SHA256("ALT Name Service" + "\x00vault")

Step 7: Derive subdomain account (parent = domain account)
  subAccount = PDA([hashedSub, zeros, domainAccount], ANS_PROGRAM)
```

Input: `Twitter.miester.abc` (record, `record: true`)

```
Steps 1-4: Same — derive domain account for miester.abc

Step 5: Build record name with prefix
  recordName = "\x01" + "Twitter"   // \x01 prefix = record

Step 6: Hash the prefixed record name
  hashedRecord = SHA256("ALT Name Service" + "\x01Twitter")

Step 7: Derive record account (parent = domain account)
  recordAccount = PDA([hashedRecord, zeros, domainAccount], ANS_PROGRAM)
```

> **WHY THIS MATTERS**: The only difference between a subdomain derivation and a record derivation is the prefix byte — `\x00` for subdomains, `\x01` for records. This single byte is what prevents `vault.miester.abc` (the subdomain) from colliding with a hypothetical record called `vault` on `miester.abc`.

### Four-Part Domains (record.sub.domain.tld)

Input: `Twitter.vault.miester.abc` (record on a subdomain, `record: true`)

```
Steps 1-4: Derive domain account for miester.abc
Steps 5-7: Derive subdomain account for vault.miester.abc (using \x00 prefix)

Step 8: Build sub-record name with record prefix
  subRecordName = "\x01" + "Twitter"

Step 9: Hash the prefixed sub-record name
  hashedSubRecord = SHA256("ALT Name Service" + "\x01Twitter")

Step 10: Derive sub-record account (parent = subdomain account)
  subRecordAccount = PDA([hashedSubRecord, zeros, subAccount], ANS_PROGRAM)
```

The `DomainKeyResult` for a four-part domain has `isSub: true`, `isSubRecord: true`, and `parent` pointing to the domain account (not the subdomain).

### The Full Decision Tree

```dart
Future<DomainKeyResult> getDomainKey(String domainTld, {bool record = false}) async {
  final parts = domainTld.split('.');

  if (parts.length < 2) throw InvalidDomainFormatException(domainTld);
  if (parts.length > 4) throw DerivationException('More than 4 levels not supported');

  // 2 parts: domain.tld
  if (parts.length == 2) return _handleTwoPartDomain(parts);

  // 3 parts: sub.domain.tld OR record.domain.tld
  if (parts.length == 3) return _handleThreePartDomain(parts, record);

  // 4 parts: record.sub.domain.tld (only valid with record=true)
  if (parts.length == 4 && record) return _handleFourPartDomain(parts);
}
```

Five or more levels are not supported. The protocol caps at four levels.

## PDA Derivation Functions Reference

The SDK provides focused derivation functions for each account type. All are `async` because they call `findProgramAddressWithBump`.

### ANS Program PDAs

These derive accounts owned by the ANS program (`ALTNSZ...`):

```dart
// Find any name account from a plain name string
final (domainPubkey, bump) = await findNameAccountFromName(
  name: 'miester',
  nameParent: tldAccount,              // Parent in the hierarchy
);

// Find any name account from a pre-computed hash
final hashed = getHashedName('miester');
final (domainPubkey, bump) = await findNameAccountFromHashedName(
  hashedName: hashed,
  nameParent: tldAccount,
);

// Get the TLD's parent account (derives the TLD account in one call)
final parentAccount = await getNameParentFromTld('.abc');
```

### TLD House Program PDAs

These derive accounts owned by the TLD House program (`TLDHky...`):

```dart
// TLD House for a specific TLD
final (tldHouse, bump) = await findTldHouse('abc');
// Seeds: ["tld_house", ".abc"]

// TLD House Treasury
final (treasury, bump) = await findTldHouseTreasury('abc');
// Seeds: ["tld_house", ".abc", "treasury"]

// Main Domain for a user (reverse lookup PDA)
final (mainDomainPda, bump) = await findMainDomain(userPubkey);
// Seeds: ["main_domain", userPubkey.bytes]

// Claimable domain
final (claimable, bump) = await findClaimableDomain(
  tldHouse: tldHousePubkey,
  domainAccount: domainPubkey,
);
// Seeds: ["claimable", tldHouse.bytes, domainAccount.bytes]

// Global TLD state
final (tldState, bump) = await findTldState();
// Seeds: ["tld_pda"]
```

### Name House Program PDAs

These derive accounts owned by the Name House program (`NH3uX6...`):

```dart
// Name House for a TLD House
final (nameHouse, bump) = await findNameHouse(tldHousePubkey);
// Seeds: ["name_house", tldHouse.bytes]

// NFT Record for a domain
final (nftRecord, bump) = await findNftRecord(
  nameAccount: domainPubkey,
  nameHouse: nameHousePubkey,
);
// Seeds: ["nft_record", nameHouse.bytes, nameAccount.bytes]

// NFT Mint address
final (mintAddress, bump) = await findMintAddress(
  nameAccount: domainPubkey,
  nameHouse: nameHousePubkey,
);
// Seeds: ["name_house", nameHouse.bytes, nameAccount.bytes]

// Renewable NFT Mint (includes expiration in derivation)
final (renewableMint, bump) = await findRenewableMintAddress(
  nameAccount: domainPubkey,
  nameHouse: nameHousePubkey,
  expiresAtBuffer: expiresAtBytes,       // 8-byte LE timestamp
);
// Seeds: ["name_house", nameHouse.bytes, nameAccount.bytes, expiresAt]

// Collection Mint for a TLD
final (collectionMint, bump) = await findCollectionMintAddress(tldHousePubkey);
// Seeds: ["name_collection", tldHouse.bytes]
```

### Metaplex PDA

One derivation uses the Metaplex Token Metadata program:

```dart
// Metadata account for an NFT mint
final metadataAddress = await findMetadataAddress(mintPubkey);
// Seeds: ["metadata", metadataProgramId.bytes, mint.bytes]
// Program: metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s
```

## Convenience Functions

The SDK provides shorthand functions for common derivation patterns:

```dart
// Instead of getDomainKey('Twitter.miester.abc', record: true)
final recordKey = await getRecordKey('Twitter.miester.abc');

// Instead of getDomainKey('vault.miester.abc', record: false)
final subKey = await getSubdomainKey('vault.miester.abc');

// Build a record domain string from components
final domain = buildRecordDomain(
  record: 'Twitter',
  domain: 'miester',
  tld: 'abc',
);
// Returns: 'Twitter.miester.abc'

// With subdomain
final subRecordDomain = buildRecordDomain(
  record: 'Twitter',
  domain: 'miester',
  tld: 'abc',
  subdomain: 'vault',
);
// Returns: 'Twitter.vault.miester.abc'
```

## Normalization Rules

Several derivation functions normalize their input. Know what they do:

| Function | Normalization |
|----------|--------------|
| `findTldHouse(tld)` | Lowercases, ensures leading dot (`.abc`) |
| `findTldHouseTreasury(tld)` | Same as `findTldHouse` |
| `getHashedName(name)` | None — case-sensitive, no dot handling |
| `splitDomainTld(domainTld)` | Splits on dots, last segment = TLD |
| `getDomainKey(domainTld)` | Splits on dots, derives through hierarchy |

> **GOTCHA**: `getHashedName` does no normalization. `getHashedName('ABC')` and `getHashedName('abc')` produce different hashes, which means different PDAs. The TldParser class lowercases domain names before hashing, but if you call `getHashedName` directly, you're responsible for case normalization.

## Derivation in Practice: Full Worked Example

Let's trace the complete derivation for resolving the owner of `miester.abc`:

```dart
import 'package:tld_parser/tld_parser.dart';

// Step 1: Derive the TLD parent account (.abc → name account)
final tldHash = getHashedName('.abc');
// tldHash = SHA256("ALT Name Serviceabc")  → 32 bytes

final (tldAccount, _) = await getNameAccountKey(
  hashedName: tldHash,
  nameParent: originTldKey,  // 3mX9b4AZaQehNoQGfckVcmgmA6bkBoFcbLj9RMmMyNcU
);
// tldAccount is now the .abc TLD account address

// Step 2: Derive the domain account (miester under .abc)
final domainHash = getHashedName('miester');
final (domainAccount, _) = await getNameAccountKey(
  hashedName: domainHash,
  nameParent: tldAccount,
);
// domainAccount is now miester.abc's account address

// Step 3: Fetch the NameRecordHeader at that address
final nameRecord = await NameRecordHeader.fromAccountAddress(
  rpcClient,
  domainAccount,
);
// nameRecord.owner could be a wallet address or an NftRecord PDA

// Step 4: Check if NFT-wrapped
final (tldHouse, _) = await findTldHouse('abc');
final (nameHouse, _) = await findNameHouse(tldHouse);
final (nftRecordPda, _) = await findNftRecord(
  nameAccount: domainAccount,
  nameHouse: nameHouse,
);

if (nameRecord!.owner!.toBase58() == nftRecordPda.toBase58()) {
  // NFT-wrapped — need to trace through to token holder
  // (see Resolution & Records page for the full NFT resolution flow)
} else {
  // Direct ownership — nameRecord.owner is the wallet
  print('Owner: ${nameRecord.owner!.toBase58()}');
}
```

Every line above corresponds to a real on-chain read or a deterministic computation. No magic. No indexer. Just seeds, hashes, and PDAs.

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Using `getHashedName` on the domain WITH the TLD | Passing `'miester.abc'` instead of `'miester'` | Split first: hash the domain label separately from the TLD |
| Forgetting the dot in TLD hashing | TLD accounts are derived from `'.abc'`, not `'abc'` | Always hash with the leading dot: `getHashedName('.abc')` |
| Assuming bump seeds are constant | Different seed combinations produce different bumps | Don't hardcode bumps — always use `findProgramAddressWithBump` |
| Caching derived addresses across sessions | Domain accounts never change address | Safe to cache — PDA addresses are deterministic and permanent |

## Related

- [On-Chain Architecture](on-chain-architecture.md) — What these derived accounts contain
- [State & Deserialization](state-and-deserialization.md) — How to read the data stored at these addresses
- [Resolution & Records](resolution-and-records.md) — High-level resolution that uses these derivations
