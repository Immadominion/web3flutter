# Resolution & Records — Forward Lookups, Reverse Lookups, and Domain Data

> This page covers what happens when you call `getOwnerFromDomainTld()`, `getMainDomain()`, `getRecord()`, and every other high-level method on the `TldParser` class. Each method is a choreographed sequence of PDA derivations, RPC calls, and deserialization steps.

## Overview

The `TldParser` class is the public API for the SDK. It wraps an `RpcClient` and provides methods grouped into five categories:

| Category | Methods | What they do |
|----------|---------|-------------|
| Owner resolution | `getOwnerFromDomainTld()` | Domain string → wallet address |
| Name record access | `getNameRecordFromDomainTld()`, `getNameRecordFromNameAccount()` | Domain → full account data |
| Main domain / reverse | `getMainDomain()`, `tryGetMainDomain()` | Wallet address → domain string |
| Domain listing | `getAllUserDomains()`, `getAllUserDomainsFromTld()`, `getParsedAllUserDomainsFromTld()` | Wallet → list of owned domains |
| Records | `getRecord()`, `getRecords()`, `getAllRecords()`, `getAvatar()` | Domain → attached data (social, crypto, content) |

Every method follows the same pattern: derive the right PDA, fetch the account, deserialize, return. The complexity comes from NFT-wrapped domains, batching, and the different ways the on-chain data needs to be interpreted.

## Forward Resolution: Domain → Owner

### `getOwnerFromDomainTld(String domainTld)`

This is the most-used method. Given `'miester.abc'`, it returns the wallet address that owns the domain.

**The full sequence:**

```dart
final owner = await parser.getOwnerFromDomainTld('miester.abc');
```

Internally:

```
1. Split: domain = 'miester', tld = '.abc'

2. Derive TLD parent account:
   parentAccount = PDA(hash('.abc'), originTldKey) → ANS program

3. Derive domain account:
   domainAccount = PDA(hash('miester'), parentAccount) → ANS program

4. Fetch NameRecordHeader at domainAccount
   → RPC call: getAccountInfo(domainAccount)

5. If account is null or expired → return null

6. Read nameRecord.owner

7. Derive NFT infrastructure:
   tldHouse = PDA(["tld_house", ".abc"]) → TLD House program
   nameHouse = PDA(["name_house", tldHouse]) → Name House program
   nftRecord = PDA(["nft_record", nameHouse, domainAccount]) → Name House program

8. Compare: owner == nftRecord?
   → YES: Domain is NFT-wrapped. Trace to token holder.
   → NO:  Domain is directly owned. Return owner.
```

### NFT Ownership Tracing

When the NameRecordHeader's owner field equals the NftRecord PDA, the domain is wrapped as an NFT. The actual owner is whoever holds the NFT token. The SDK traces this:

```dart
Future<Ed25519HDPublicKey?> _getMintOwner(
  Ed25519HDPublicKey nftRecordAddress,
) async {
  // Step 1: Fetch the NftRecord to get the mint address
  final nftRecord = await NftRecord.tryFromAccountAddress(
    rpcClient, nftRecordAddress,
  );
  if (nftRecord == null || !nftRecord.isActive) return null;

  // Step 2: Find the largest token holder for this mint
  // For NFTs (supply = 1), there's exactly one holder
  final largestAccounts = await rpcClient.getTokenLargestAccounts(
    nftRecord.nftMintAccount.toBase58(),
  );
  if (largestAccounts.value.isEmpty) return null;

  // Step 3: Fetch the token account to read the owner field
  final tokenAccountAddress = largestAccounts.value.first.address;
  final tokenAccountInfo = await rpcClient.getAccountInfo(
    tokenAccountAddress,
    encoding: Encoding.jsonParsed,  // SPL Token accounts support jsonParsed
  );

  // Step 4: Extract owner from parsed token account data
  final data = tokenAccountInfo.value!.data;
  if (data is ParsedSplTokenProgramAccountData) {
    final parsed = data.parsed;
    if (parsed is TokenAccountData) {
      return Ed25519HDPublicKey.fromBase58(parsed.info.owner);
    }
  }
  return null;
}
```

The key insight: NFTs are SPL tokens with decimals = 0 and supply = 1. The "owner" of the NFT is the wallet that owns the token account holding that 1 unit. `getTokenLargestAccounts` finds the token account, and `getAccountInfo` with `jsonParsed` encoding reads the owner from it.

> **WHY THIS MATTERS**: This is why resolving an NFT-wrapped domain costs 3+ extra RPC calls compared to a directly-owned domain. The SDK doesn't cache NftRecord data between calls, so if you're resolving the same domain repeatedly, consider caching the result.

## Reverse Resolution: Owner → Domain

### `getMainDomain(Ed25519HDPublicKey userAddress)`

Given a wallet address, returns the domain the user has set as their primary identity.

```dart
final mainDomain = await parser.getMainDomain(userPubkey);
print(mainDomain.fullDomain); // "miester.abc"
```

**The sequence:**

```
1. Derive MainDomain PDA:
   mainDomainAddress = PDA(["main_domain", userPubkey.bytes]) → TLD House program

2. Fetch MainDomain account at that address
   → RPC call: getAccountInfo(mainDomainAddress)

3. Deserialize variable-length data:
   - nameAccount (32 bytes)
   - tld (length-prefixed string)
   - domain (length-prefixed string)

4. Return MainDomain with fullDomain = domain + tld
```

Throws `AccountNotFoundException` if the user hasn't set a main domain. Use `tryGetMainDomain()` for a null-returning version.

### `reverseLookupNameAccount()`

For reverse lookup of a specific name account (not using the MainDomain shortcut):

```dart
final domainName = await parser.reverseLookupNameAccount(
  nameAccount: domainPubkey,
  parentAccountOwner: tldHousePubkey,
);
```

This works differently from MainDomain. It derives a reverse lookup account where the name is the Base58 encoding of the name account's public key, and the name class is the TLD House:

```
reverseLookupHash = SHA256("ALT Name Service" + domainPubkey.toBase58())
reverseLookupAccount = PDA([reverseLookupHash, tldHouse, zeros]) → ANS program
```

The data stored in that account is the domain name string (without TLD).

### Batched Main Domain Resolution

For resolving main domains for many wallets at once:

```dart
final mainDomains = await parser.getMainDomains([
  Ed25519HDPublicKey.fromBase58('...'),
  Ed25519HDPublicKey.fromBase58('...'),
  Ed25519HDPublicKey.fromBase58('...'),
]);
// Returns: ['miester.abc', null, 'heisjoel.skr']
```

This method:

1. Derives all MainDomain PDAs in parallel
2. Batch-fetches them in one `getMultipleAccounts` call
3. Deserializes valid MainDomain accounts
4. Batch-fetches the corresponding name accounts to verify ownership
5. For each, checks if the domain is still owned by the wallet (direct or NFT)
6. Returns names only for valid, verified domains

The ownership verification step is important — a user might transfer a domain after setting it as their main domain, leaving a stale MainDomain account pointing at a domain they no longer own.

## Domain Listing

### Finding All Domains a User Owns

```dart
// All domains across all TLDs (public key list only)
final allDomains = await parser.getAllUserDomains(userPubkey);

// Domains in a specific TLD
final abcDomains = await parser.getAllUserDomainsFromTld(userPubkey, 'abc');
```

These use `getProgramAccounts` with `memcmp` filters:

```dart
// getAllUserDomains: filter by owner at offset 40
filters: [
  ProgramDataFilter.memcmpBase58(offset: 40, bytes: userPubkey.toBase58()),
]

// getAllUserDomainsFromTld: filter by parent at offset 8 AND owner at offset 40
filters: [
  ProgramDataFilter.memcmpBase58(offset: 8, bytes: tldAccount.toBase58()),
  ProgramDataFilter.memcmpBase58(offset: 40, bytes: userPubkey.toBase58()),
]
```

> **GOTCHA**: `getAllUserDomains()` only finds directly-owned domains. If a domain is NFT-wrapped, the owner field in the NameRecordHeader is the NftRecord PDA, not the user's wallet. So the `memcmp` filter misses it. Use `getParsedAllUserDomainsFromTld()` to include NFT-wrapped domains.

### Parsed Domain Listing (With Names)

```dart
// Including NFT-wrapped domains
final domains = await parser.getParsedAllUserDomainsFromTld(userPubkey, 'abc');
for (final d in domains) {
  print('${d.domain} → ${d.nameAccount.toBase58()}');
}
```

This method does two separate queries:

1. **Direct domains**: `getProgramAccounts` filter by owner → batch reverse lookup to get names
2. **NFT-wrapped domains**: Scan user's SPL token accounts → filter NFTs (decimals=0, amount=1) → check Metaplex metadata for Name House as verified creator → extract domain name from metadata

The NFT scanning is the expensive part. For each NFT the user holds, the SDK:

- Derives the Metaplex metadata address
- Fetches the metadata account
- Checks byte offset 326 for the verified creator (Name House address)
- Extracts the domain name from bytes 66–101 of the metadata

```dart
// Check if an NFT belongs to this Name House
const creatorOffset = 326;
final creatorBytes = metadataBytes.sublist(creatorOffset, creatorOffset + 32);
final creator = Ed25519HDPublicKey(creatorBytes.toList());

if (creator.toBase58() == nameHouse.toBase58()) {
  // This NFT is a wrapped domain from this TLD
  final domainBytes = metadataBytes.sublist(66, 101);
  final domainName = String.fromCharCodes(domainBytes)
      .replaceAll('\x00', '')
      .trim();
}
```

### Batched Reverse Lookups

The SDK chunks reverse lookups into batches of 100 (the `getMultipleAccounts` limit):

```dart
Future<List<String?>> reverseLookupBatched({
  required List<Ed25519HDPublicKey> nameAccounts,
  required Ed25519HDPublicKey tldHouse,
}) async {
  // Derive all reverse lookup addresses in parallel
  final reverseLookupAddresses = await Future.wait(
    nameAccounts.map((account) async {
      final hashedName = getHashedName(account.toBase58());
      final (address, _) = await findNameAccountFromHashedName(
        hashedName: hashedName,
        nameClass: tldHouse,
      );
      return address;
    }),
  );

  // Batch fetch all accounts in one RPC call
  final results = await rpcClient.getMultipleAccounts(
    reverseLookupAddresses.map((a) => a.toBase58()).toList(),
    encoding: Encoding.base64,
  );

  // Deserialize each reverse lookup to get the domain name string
  return results.value.map((accountInfo) {
    if (accountInfo == null) return null;
    final bytes = _extractBinaryData(accountInfo.data);
    if (bytes == null) return null;
    return NameRecordHeader.deserializeReverseLookupDomainName(bytes);
  }).toList();
}
```

## Records

### The Record System

Records are key-value pairs attached to domains. They're stored as NameRecordHeader accounts where the data section (bytes 200+) contains the value.

The 27 available record types:

| Category | Records |
|----------|---------|
| Content/Storage | `IPFS`, `ARWV`, `Url`, `SHDW` |
| Crypto Addresses | `SOL`, `ETH`, `BTC`, `APTOS`, `NEAR`, `STACKS`, `BASE`, `SUI`, `Lattica`, `LTC`, `DOGE`, `POINT` |
| Social | `Twitter`, `Discord`, `Github`, `Reddit`, `Telegram` |
| Profile | `Pic`, `Email` |

### Fetching a Single Record

```dart
final twitter = await parser.getRecord('miester.abc', Record.twitter);
```

This:

1. Builds the record domain: `'Twitter.miester.abc'`
2. Calls `getDomainKey('Twitter.miester.abc', record: true)` — which hashes `\x01Twitter` and derives the PDA with the domain account as parent
3. Fetches the account at that PDA
4. Deserializes the data section as a UTF-8 string

### Fetching Multiple Records

```dart
final records = await parser.getRecords('miester.abc', [
  Record.twitter,
  Record.discord,
  Record.email,
  Record.eth,
]);
// Returns: {Record.twitter: '@miester', Record.discord: null, ...}
```

This batches: derives all record PDAs in parallel, then fetches them in one `getMultipleAccounts` call.

### Fetching All Records

```dart
final allRecords = await parser.getAllRecords('miester.abc');
// Fetches all 27 record types, returns only those with values
```

This calls `getRecords()` with the full `allRecords` list. Unset records return `null`.

### Avatar Resolution

The `getAvatar()` method fetches the `Pic` record and resolves storage URLs to HTTP:

```dart
final avatarUrl = await parser.getAvatar('miester.abc');
// If Pic record = "ipfs://QmXyz...", returns "https://ipfs.io/ipfs/QmXyz..."
```

The URL resolution handles multiple protocols:

```dart
String? resolveAvatarUrl(String record, {AvatarOptions options}) {
  if (record.startsWith('http://') || record.startsWith('https://')) return record;
  if (record.startsWith('ipfs://'))  return '${options.ipfsGateway}/ipfs/${record.substring(7)}';
  if (record.startsWith('Qm') || record.startsWith('bafy'))
    return '${options.ipfsGateway}/ipfs/$record';
  if (record.startsWith('ar://'))    return '${options.arweaveGateway}/${record.substring(5)}';
  if (record.startsWith('arwv://'))  return '${options.arweaveGateway}/${record.substring(7)}';
  if (record.startsWith('mpl:'))     return '${options.nftGateway}/nft/mpl/${record.substring(4)}';
  if (record.startsWith('core:'))    return '${options.nftGateway}/nft/core/${record.substring(5)}';
  if (record.startsWith('eip155:'))  return '${options.nftGateway}/nft/evm/${Uri.encodeComponent(record)}';
  if (record.startsWith('data:'))    return record;
  return record;
}
```

Custom gateways can be provided:

```dart
final avatarUrl = await parser.getAvatar(
  'miester.abc',
  options: AvatarOptions(
    ipfsGateway: 'https://gateway.pinata.cloud',
    arweaveGateway: 'https://arweave.net',
    nftGateway: 'https://alldomains.id/api',
  ),
);
```

## TLD Discovery

### Getting All Available TLDs

```dart
final tlds = await parser.getAllTld();
for (final entry in tlds) {
  print('${entry.tld} → parent: ${entry.parentAccount.toBase58()}');
}
```

This queries the TLD House program for all TLD House accounts by filtering on the TLD House discriminator:

```dart
final accounts = await rpcClient.getProgramAccounts(
  tldHouseProgramIdString,
  encoding: Encoding.base64,
  filters: [
    ProgramDataFilter.memcmp(offset: 0, bytes: tldHouseDiscriminator),
  ],
);
```

For each TLD House account, the SDK parses:

- **TLD string at offset 104**: 4-byte length prefix + UTF-8 string
- **Parent account at offset 72**: 32-byte pubkey

## The Exception Hierarchy

The SDK uses typed exceptions so you can catch specific failure modes:

```dart
try {
  final owner = await parser.getOwnerFromDomainTld('nonexistent.abc');
} on DomainNotFoundException catch (e) {
  print('Domain not found: ${e.domain}');
} on DomainExpiredException catch (e) {
  print('Domain expired: ${e.message}');
} on RpcException catch (e) {
  print('RPC error: ${e.message}');
} on TldParserException catch (e) {
  // Catch-all for any SDK error
  print('Error [${e.code}]: ${e.message}');
}
```

| Exception | Code | When it's thrown |
|-----------|------|-----------------|
| `DomainNotFoundException` | `DOMAIN_NOT_FOUND` | Domain account doesn't exist on-chain |
| `AccountNotFoundException` | `ACCOUNT_NOT_FOUND` | Any expected account is missing |
| `DeserializationException` | `DESERIALIZATION_ERROR` | Account data is malformed or too short |
| `InvalidDiscriminatorException` | `INVALID_DISCRIMINATOR` | Wrong account type at the expected address |
| `DomainExpiredException` | `DOMAIN_EXPIRED` | Domain is past expiration + grace period |
| `InvalidDomainFormatException` | `INVALID_DOMAIN_FORMAT` | Input string can't be parsed as a domain |
| `DerivationException` | `DERIVATION_ERROR` | Domain has too many levels (>4) |
| `RpcException` | `RPC_ERROR` | Solana RPC call failed |

## RPC Call Costs

Each method has a different RPC footprint. Knowing this helps with rate limiting and performance:

| Method | RPC Calls | Notes |
|--------|-----------|-------|
| `getOwnerFromDomainTld()` | 1–4 | 1 for direct ownership, +3 for NFT resolution |
| `getNameRecordFromDomainTld()` | 1 | Single `getAccountInfo` |
| `getMainDomain()` | 1 | Single `getAccountInfo` |
| `tryGetMainDomain()` | 1 | Same, returns null on failure |
| `getRecord()` | 1 | Single `getAccountInfo` |
| `getRecords()` | 1 | Single `getMultipleAccounts` |
| `getAllRecords()` | 1 | `getMultipleAccounts` for all 27 records |
| `getAllUserDomains()` | 1 | Single `getProgramAccounts` |
| `getAllUserDomainsFromTld()` | 1 | Single `getProgramAccounts` |
| `getParsedAllUserDomainsFromTld()` | 3+ | `getProgramAccounts` + `getMultipleAccounts` for reverse lookups + token scanning for NFTs |
| `getMainDomains()` | 3+ | Batch PDAs + batch fetch + ownership verification |
| `getAllTld()` | 1 | Single `getProgramAccounts` |

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Not handling null from `getOwnerFromDomainTld` | Domain might not exist or might be expired | Always check for null before using the result |
| Using `getAllUserDomains` and expecting wrapped domains | The `memcmp` filter on owner won't match NftRecord PDAs | Use `getParsedAllUserDomainsFromTld` for complete results |
| Calling `getRecord` with `Record.sol` expecting a SOL balance | The SOL record stores an alternative Solana address, not a balance | Use RPC `getBalance` for SOL balance |
| Building record domains manually with wrong casing | Record keys are case-specific: `'Twitter'` not `'twitter'` | Use `Record.twitter.key` which returns the correct casing |
| Assuming `getMainDomain` always returns a result | Users who never set a main domain have no MainDomain account | Use `tryGetMainDomain` which returns null instead of throwing |

## Related

- [On-Chain Architecture](on-chain-architecture.md) — The three programs these methods interact with
- [PDA Derivation](pda-derivation.md) — How each account address is computed
- [State & Deserialization](state-and-deserialization.md) — The byte layouts being deserialized
- [Mobile Integration](mobile-integration.md) — How Chumbucket uses these methods in production
