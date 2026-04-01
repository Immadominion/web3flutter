# State & Deserialization — Reading Raw Bytes From the Chain

> Every AllDomains account is raw bytes on Solana. This page maps out the byte layout of NameRecordHeader, MainDomain, and NftRecord — the three account types the SDK deserializes — and explains how each field is read.

## Overview

When the SDK calls `rpcClient.getAccountInfo(...)`, Solana returns raw binary data. The SDK's state models in `lib/src/state/` know how to turn those bytes into Dart objects. Understanding the byte layouts matters for three reasons:

1. **Debugging** — When deserialization fails, knowing the layout tells you which bytes are wrong
2. **Efficiency** — You can use `memcmp` filters in `getProgramAccounts` to query by specific fields at known offsets
3. **Independence** — You can deserialize accounts yourself without the SDK if you know the layout

All three account types follow the same pattern: an 8-byte discriminator, then fixed-size fields, then optional variable-length data.

## Discriminators

Every Anchor-derived account starts with an 8-byte discriminator. It's the first 8 bytes of `SHA256("account:<AccountName>")`. The SDK checks this before reading any other field.

```dart
// From constants.dart
const List<int> nameRecordHeaderDiscriminator = [68, 72, 88, 44, 15, 167, 103, 243];
const List<int> mainDomainDiscriminator = [109, 239, 227, 199, 98, 226, 66, 175];
const List<int> nftRecordDiscriminator = [174, 190, 114, 100, 177, 14, 90, 254];
const List<int> tldHouseDiscriminator = [247, 144, 135, 1, 238, 173, 19, 249];
```

If the discriminator doesn't match, the SDK throws `InvalidDiscriminatorException`. This is a hard failure — it means you're reading the wrong account type, not a corrupted account.

> **WHY THIS MATTERS**: Discriminators are how Solana programs distinguish account types. If you're building a `getProgramAccounts` filter and want only NameRecordHeader accounts, you can filter by `memcmp(offset: 0, bytes: [68, 72, 88, 44, 15, 167, 103, 243])`. The SDK does this internally for domain listing operations.

## NameRecordHeader — The Core Domain Account

This is the most important account type. Every domain, subdomain, TLD, record, and reverse lookup account is a NameRecordHeader. The header is 200 bytes, with optional data appended after.

### Byte Layout

```
Offset  Size    Field               Type        Description
─────────────────────────────────────────────────────────────────
0       8       discriminator       [u8; 8]     SHA256("account:NameRecordHeader")[0:8]
8       32      parentName          Pubkey      Parent name account in the hierarchy
40      32      owner               Pubkey      Owner (wallet or NftRecord PDA)
72      32      nclass              Pubkey      Name class (usually Pubkey::default)
104     8       expiresAt           u64 LE      Expiry timestamp (0 = never)
112     8       createdAt           u64 LE      Creation timestamp
120     1       nonTransferable     bool        Whether domain can be transferred
121     79      _padding            [u8; 79]    Reserved/padding bytes
─────────────────────────────────────────────────────────────────
200     ...     data                [u8]        Optional — record value, reverse lookup name
```

**Total header: 200 bytes.** The `data` section is variable-length and only present for record accounts (Twitter handle, ETH address, etc.) and reverse lookup accounts (the domain name string).

### Deserialization Code

Here's what the SDK does, field by field:

```dart
static NameRecordHeader deserialize(Uint8List accountData) {
  if (accountData.length < 200) {
    throw DeserializationException(
      'NameRecordHeader data too short: ${accountData.length} bytes, expected at least 200',
    );
  }

  // Verify discriminator (bytes 0-7)
  final disc = accountData.sublist(0, 8);
  if (!const ListEquality<int>().equals(disc.toList(), discriminator)) {
    throw const InvalidDiscriminatorException('NameRecordHeader');
  }

  var offset = 8;

  // Parent name (bytes 8-39): 32-byte public key
  final parentName = Ed25519HDPublicKey(
    accountData.sublist(offset, offset + 32).toList(),
  );
  offset += 32;

  // Owner (bytes 40-71): 32-byte public key
  final owner = Ed25519HDPublicKey(
    accountData.sublist(offset, offset + 32).toList(),
  );
  offset += 32;

  // Name class (bytes 72-103): 32-byte public key
  final nclass = Ed25519HDPublicKey(
    accountData.sublist(offset, offset + 32).toList(),
  );
  offset += 32;

  // Expires at (bytes 104-111): little-endian u64
  final expiresAt = _readU64LE(accountData.sublist(offset, offset + 8));
  offset += 8;

  // Created at (bytes 112-119): little-endian u64
  final createdAt = _readU64LE(accountData.sublist(offset, offset + 8));
  offset += 8;

  // Non-transferable (byte 120): boolean
  final nonTransferable = accountData[offset] == 1;
  // offset += 1, then skip 79 bytes of padding

  // Validity check based on expiration
  final isValid = expiresAt == 0 || isWithinGracePeriod(expiresAt);

  // Data section (bytes 200+)
  Uint8List? data;
  if (accountData.length > 200) {
    data = accountData.sublist(200);
  }

  return NameRecordHeader(
    parentName: parentName,
    owner: isValid ? owner : null,  // Expired domains return null owner
    nclass: nclass,
    expiresAt: expiresAt,
    createdAt: createdAt,
    nonTransferable: nonTransferable,
    isValid: isValid,
    data: data,
  );
}
```

### Key Fields Explained

**`parentName` (offset 8)**: Points to this account's parent in the hierarchy. For a domain like `miester.abc`, the parent is the `.abc` TLD account. For the `.abc` TLD account, the parent is the Origin TLD Key. This field is how `getProgramAccounts` filters work — you can find all domains under a TLD by filtering for a specific parent at offset 8.

**`owner` (offset 40)**: The owner of this name account. For directly-owned domains, this is the user's wallet. For NFT-wrapped domains, this is the NftRecord PDA. The SDK sets owner to `null` when the domain is expired past its grace period.

**`expiresAt` (offset 104)**: Unix timestamp in seconds. A value of `0` means the domain never expires. The SDK checks this against the current time plus a 45-day grace period:

```dart
const int gracePeriodSeconds = 45 * 24 * 60 * 60; // 3,888,000 seconds

bool isWithinGracePeriod(int expiresAtSeconds) {
  if (expiresAtSeconds == 0) return true;  // Never expires
  final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
  return now < (expiresAtSeconds + gracePeriodSeconds);
}
```

> **GOTCHA**: Expired domains don't disappear from the chain. The account still exists, still has data, still has an owner field. The SDK just treats them as invalid by returning `owner: null` and `isValid: false`. If you deserialize without the SDK, you need to implement this check yourself.

### Reading Record Data

For record accounts (Twitter, ETH, email, etc.), the data after the 200-byte header contains the record value as a UTF-8 string. The SDK reads it like this:

```dart
static String? deserializeDataString(Uint8List accountData) {
  if (accountData.length <= 200) return null;

  final dataSection = accountData.sublist(200);

  // Trim trailing null bytes (common in on-chain strings)
  final nullIdx = dataSection.indexOf(0x00);
  final trimmed = nullIdx >= 0 ? dataSection.sublist(0, nullIdx) : dataSection;

  if (trimmed.isEmpty) return null;

  return utf8.decode(trimmed, allowMalformed: true);
}
```

For reverse lookup accounts, the data is the domain name string (without length prefix):

```dart
static String? deserializeReverseLookupDomainName(Uint8List accountData) {
  if (accountData.length <= 200) return null;
  final dataSection = accountData.sublist(200);
  return utf8.decode(dataSection, allowMalformed: true).replaceAll('\x00', '');
}
```

### Using memcmp Filters

Because the layout has fixed offsets, you can filter NameRecordHeader accounts by field without fetching all data:

```dart
// Find all domains owned by a specific wallet
final accounts = await rpcClient.getProgramAccounts(
  'ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK',
  encoding: Encoding.base64,
  filters: [
    // owner at offset 40
    ProgramDataFilter.memcmpBase58(offset: 40, bytes: userPubkey.toBase58()),
  ],
);

// Find all domains under a specific TLD
final tldDomains = await rpcClient.getProgramAccounts(
  'ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK',
  encoding: Encoding.base64,
  filters: [
    // parentName at offset 8 = the TLD account
    ProgramDataFilter.memcmpBase58(offset: 8, bytes: tldAccount.toBase58()),
    // owner at offset 40 = the user's wallet
    ProgramDataFilter.memcmpBase58(offset: 40, bytes: userPubkey.toBase58()),
  ],
);
```

The SDK's `getAllUserDomains()` and `getAllUserDomainsFromTld()` methods use exactly these filters.

## MainDomain — The Reverse Lookup Account

MainDomain accounts store which domain a user has set as their primary identity. They're variable-length because they contain strings.

### Byte Layout

```
Offset  Size    Field               Type        Description
─────────────────────────────────────────────────────────────────
0       8       discriminator       [u8; 8]     SHA256("account:MainDomain")[0:8]
8       32      nameAccount         Pubkey      The domain's name account address
40      4       tldLength           u32 LE      Length of TLD string
44      N       tld                 String      TLD string (e.g., ".abc")
44+N    4       domainLength        u32 LE      Length of domain string
48+N    M       domain              String      Domain label (e.g., "miester")
```

### Deserialization Code

```dart
static MainDomain deserialize(Uint8List accountData) {
  if (accountData.length < 48) {
    throw DeserializationException(
      'MainDomain data too short: ${accountData.length} bytes',
    );
  }

  // Verify discriminator (bytes 0-7)
  final disc = accountData.sublist(0, 8);
  if (!const ListEquality<int>().equals(disc.toList(), discriminator)) {
    throw const InvalidDiscriminatorException('MainDomain');
  }

  var offset = 8;

  // Name account (bytes 8-39): 32-byte public key
  final nameAccount = Ed25519HDPublicKey(
    accountData.sublist(offset, offset + 32).toList(),
  );
  offset += 32;

  // TLD string (length-prefixed)
  final tldLength = _readU32LE(accountData.sublist(offset, offset + 4));
  offset += 4;
  final tld = utf8.decode(accountData.sublist(offset, offset + tldLength));
  offset += tldLength;

  // Domain string (length-prefixed)
  final domainLength = _readU32LE(accountData.sublist(offset, offset + 4));
  offset += 4;
  final domain = utf8.decode(accountData.sublist(offset, offset + domainLength));

  return MainDomain(nameAccount: nameAccount, tld: tld, domain: domain);
}
```

### Key Fields Explained

**`nameAccount`**: The PDA of the domain's NameRecordHeader. This is what links the MainDomain to the actual domain data.

**`tld` and `domain`**: Stored as length-prefixed strings (4-byte little-endian length, then UTF-8 bytes). The `fullDomain` getter combines them:

```dart
String get fullDomain => '$domain$tld';
// If domain = "miester" and tld = ".abc", fullDomain = "miester.abc"
```

> **GOTCHA**: The `tld` field usually includes the leading dot (e.g., `.abc`), but the `fullDomain` getter just concatenates without checking. If the TLD doesn't start with a dot, you get `miesterabc` instead of `miester.abc`. The on-chain program always stores the dot, but if you're constructing test data manually, include it.

## NftRecord — NFT-Wrapped Domain Tracking

NftRecord accounts track the relationship between a domain and its NFT representation. They exist only for domains that have been wrapped as NFTs.

### Byte Layout

```
Offset  Size    Field               Type        Description
─────────────────────────────────────────────────────────────────
0       8       discriminator       [u8; 8]     SHA256("account:NftRecord")[0:8]
8       1       tag                 u8          State: 0=uninitialized, 1=active, 2=inactive
9       1       bump                u8          PDA bump seed
10      32      nameAccount         Pubkey      The domain's name account
42      32      owner               Pubkey      Original owner who wrapped the domain
74      32      nftMintAccount      Pubkey      The NFT mint address
106     32      tldHouse            Pubkey      TLD House this belongs to
138     64      _padding            [u8; 64]    Reserved bytes
```

**Total: 202 bytes.**

### Deserialization Code

```dart
static NftRecord deserialize(Uint8List accountData) {
  if (accountData.length < 138) {
    throw DeserializationException(
      'NftRecord data too short: ${accountData.length} bytes',
    );
  }

  // Verify discriminator
  final disc = accountData.sublist(0, 8);
  if (!const ListEquality<int>().equals(disc.toList(), discriminator)) {
    throw const InvalidDiscriminatorException('NftRecord');
  }

  var offset = 8;

  // Tag (byte 8): NFT state
  final tag = Tag.fromValue(accountData[offset]);
  offset += 1;

  // Bump (byte 9): PDA bump seed
  final bump = accountData[offset];
  offset += 1;

  // Name account (bytes 10-41)
  final nameAccount = Ed25519HDPublicKey(
    accountData.sublist(offset, offset + 32).toList(),
  );
  offset += 32;

  // Owner (bytes 42-73)
  final owner = Ed25519HDPublicKey(
    accountData.sublist(offset, offset + 32).toList(),
  );
  offset += 32;

  // NFT mint account (bytes 74-105)
  final nftMintAccount = Ed25519HDPublicKey(
    accountData.sublist(offset, offset + 32).toList(),
  );
  offset += 32;

  // TLD House (bytes 106-137)
  final tldHouse = Ed25519HDPublicKey(
    accountData.sublist(offset, offset + 32).toList(),
  );

  return NftRecord(
    tag: tag, bump: bump, nameAccount: nameAccount,
    owner: owner, nftMintAccount: nftMintAccount, tldHouse: tldHouse,
  );
}
```

### The Tag Field

The `Tag` enum tracks NFT wrapping state:

```dart
enum Tag {
  uninitialized(0),   // Account exists but no active wrapping
  activeRecord(1),    // Domain is currently wrapped as an NFT
  inactiveRecord(2);  // Domain was unwrapped (NFT burned)
  
  const Tag(this.value);
  final int value;
}
```

The `isActive` getter checks if the domain is currently wrapped:

```dart
bool get isActive => tag == Tag.activeRecord;
```

> **WHY THIS MATTERS**: When the SDK resolves NFT-wrapped domain ownership, it first checks `nftRecord.isActive`. If the record is inactive, the domain is no longer wrapped, and the NameRecordHeader's owner field should have been updated back to the wallet address. If both are out of sync, the domain is in a broken state.

## Reading Integers From Bytes

All integer fields in ANS accounts are stored as little-endian. The SDK reads them with `ByteData`:

```dart
// u64 — 8 bytes, used for timestamps
int _readU64LE(Uint8List bytes) {
  if (bytes.length < 8) return 0;
  final view = ByteData.view(bytes.buffer, bytes.offsetInBytes, 8);
  return view.getUint64(0, Endian.little);
}

// u32 — 4 bytes, used for string lengths
int _readU32LE(Uint8List bytes) {
  if (bytes.length < 4) return 0;
  final view = ByteData.view(bytes.buffer, bytes.offsetInBytes, 4);
  return view.getUint32(0, Endian.little);
}
```

Dart's `int` is 64-bit, so `getUint64` works without overflow. On web builds, integers are backed by JavaScript `number` which maxes out at 2^53, but Unix timestamps fit comfortably within that range.

## Batch Deserialization

The SDK fetches multiple accounts in one RPC call using `getMultipleAccounts` and deserializes them in a loop:

```dart
static Future<List<NameRecordHeader?>> fromMultipleAccountAddresses(
  RpcClient rpcClient,
  List<Ed25519HDPublicKey> addresses,
) async {
  final pubkeys = addresses.map((a) => a.toBase58()).toList();
  final result = await rpcClient.getMultipleAccounts(
    pubkeys,
    encoding: Encoding.base64,
  );

  return result.value.map((accountInfo) {
    if (accountInfo == null) return null;
    final data = accountInfo.data;
    if (data is! BinaryAccountData) return null;

    try {
      return deserialize(Uint8List.fromList(data.data));
    } catch (_) {
      return null;    // Silently skip accounts that fail deserialization
    }
  }).toList();
}
```

Solana's `getMultipleAccounts` RPC method has a limit of 100 accounts per call. The SDK's `chunkList` utility handles batching:

```dart
List<List<T>> chunkList<T>(List<T> list, int chunkSize) {
  final chunks = <List<T>>[];
  for (var i = 0; i < list.length; i += chunkSize) {
    final end = (i + chunkSize < list.length) ? i + chunkSize : list.length;
    chunks.add(list.sublist(i, end));
  }
  return chunks;
}
```

The constant `multipleAccountInfoMax = 100` is used as the chunk size throughout the SDK.

## Account Type Detection

Given raw bytes from any ANS-related account, you can identify the type by checking the first 8 bytes:

```dart
import 'package:collection/collection.dart';

String identifyAccountType(Uint8List data) {
  if (data.length < 8) return 'unknown (too short)';
  
  final disc = data.sublist(0, 8).toList();
  const eq = ListEquality<int>();
  
  if (eq.equals(disc, [68, 72, 88, 44, 15, 167, 103, 243])) {
    return 'NameRecordHeader';
  }
  if (eq.equals(disc, [109, 239, 227, 199, 98, 226, 66, 175])) {
    return 'MainDomain';
  }
  if (eq.equals(disc, [174, 190, 114, 100, 177, 14, 90, 254])) {
    return 'NftRecord';
  }
  if (eq.equals(disc, [247, 144, 135, 1, 238, 173, 19, 249])) {
    return 'TldHouse';
  }
  return 'unknown';
}
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Reading owner as a string directly | Owner is 32 raw bytes, not a string | Use `Ed25519HDPublicKey(bytes).toBase58()` to convert |
| Assuming data section is always present | Root domains and subdomains usually have no data | Check `accountData.length > 200` before reading data |
| Not handling expired domains | Expired accounts still exist and have valid byte data | Check `isValid` or compare `expiresAt` against current time |
| Deserializing without checking discriminator | Leads to reading wrong fields at wrong offsets | Always verify the first 8 bytes match the expected discriminator |
| Using `Encoding.jsonParsed` for binary reads | `jsonParsed` only works for system-known programs | Use `Encoding.base64` for ANS program accounts |

## Related

- [On-Chain Architecture](on-chain-architecture.md) — What accounts contain these byte layouts
- [PDA Derivation](pda-derivation.md) — How to find the addresses where these accounts live
- [Resolution & Records](resolution-and-records.md) — Higher-level operations built on this deserialization
