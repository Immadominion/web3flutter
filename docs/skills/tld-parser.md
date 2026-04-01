# tld_parser — AllDomains ANS Protocol SDK for Dart

> Resolve any AllDomains TLD (`.skr`, `.abc`, `.bonk`, `.backpack`, `.solana`, etc.) on Solana. Forward lookup, reverse lookup, records, NFT domains, batch operations. This is NOT the same as the Bonfida SNS SDK — different protocol, different hash prefix, different programs.

## Overview

`tld_parser` is the Dart SDK for the AllDomains Alternative Name Service (ANS) protocol on Solana. It resolves domains with **any TLD** — unlike the Bonfida SNS SDK which only handles `.sol`.

Three on-chain Solana programs power AllDomains:

| Program | ID | Role |
|---------|------------|------|
| **ANS** (Name Service) | `ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK` | Name registry — stores domain → owner mappings |
| **TLD House** | `TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S` | TLD governance — manages which TLDs exist |
| **Name House** | `NH3uX6FtVE2fNREAioP7hm5RaozotZxeL6khU1EHx51` | NFT wrapping — handles domain-as-NFT ownership |

If you need `.sol` resolution, use `sns_sdk`. If you need `.skr`, `.bonk`, `.backpack`, `.solana`, or any other custom TLD, use `tld_parser`. In production, most apps use both side-by-side.

**Package link:** [pub.dev/packages/tld_parser](https://pub.dev/packages/tld_parser) / [GitHub](https://github.com/onsol-labs/tld-parser-dart) / [AllDomains](https://alldomains.id)

## Quick Start

```yaml
dependencies:
  tld_parser: ^0.1.0
  solana: ^0.31.0
```

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart';

void main() async {
  final rpcClient = RpcClient('https://api.mainnet-beta.solana.com');
  final parser = TldParser(rpcClient);

  // Forward: domain → owner wallet address
  final owner = await parser.getOwnerFromDomainTld('miester.abc');
  if (owner != null) {
    print('Owner: ${owner.toBase58()}');
  }

  // Reverse: wallet address → main domain
  final pubkey = Ed25519HDPublicKey.fromBase58('2EGGxj...');
  final mainDomain = await parser.tryGetMainDomain(pubkey);
  if (mainDomain != null) {
    print('Main domain: ${mainDomain.domain}${mainDomain.tld}');
  }
}
```

> **CRITICAL**: `TldParser` takes `RpcClient`, not `SolanaClient`. The constructor expects `package:solana/solana.dart`'s `RpcClient` directly. Do NOT pass `SolanaClient` or `HttpRpcClient` (which is from `sns_sdk`). This is the most common initialization mistake.

## Core Concepts

### Initialization

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart' as solana;

// Correct: pass RpcClient directly
final rpcClient = solana.RpcClient('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY');
final parser = TldParser(rpcClient);
```

```dart
// WRONG: Do NOT pass SolanaClient
final client = solana.SolanaClient(
  rpcUrl: Uri.parse('https://mainnet.helius-rpc.com/?api-key=KEY'),
  websocketUrl: Uri.parse('wss://mainnet.helius-rpc.com/?api-key=KEY'),
);
// final parser = TldParser(client); // ERROR — wrong type
```

> **CRITICAL**: AllDomains domains live on **mainnet only**. If your app uses devnet for testing other features, you still need a mainnet RPC URL for `TldParser`. Domains do not exist on devnet — every lookup will return `null` and you'll think there's a deserialization bug.

**Production singleton pattern (recommended):**

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart' as solana;
import 'package:flutter_dotenv/flutter_dotenv.dart';

class DomainService {
  static TldParser? _parser;

  static TldParser get parser {
    if (_parser != null) return _parser!;
    final heliusKey = dotenv.env['HELIUS_API_KEY'];
    final rpcUrl = (heliusKey != null && heliusKey.isNotEmpty)
        ? 'https://mainnet.helius-rpc.com/?api-key=$heliusKey'
        : 'https://api.mainnet-beta.solana.com';
    final rpcClient = solana.RpcClient(rpcUrl);
    _parser = TldParser(rpcClient);
    return _parser!;
  }
}
```

### Forward Resolution: Domain → Owner Address

Resolve a domain string to its owner's `Ed25519HDPublicKey`:

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart';

// Pass the FULL domain including TLD
final owner = await parser.getOwnerFromDomainTld('miester.abc');
// Returns Ed25519HDPublicKey? — null if domain doesn't exist

if (owner != null) {
  final address = owner.toBase58(); // e.g., "2EGGxj..."
}
```

**Subdomains work the same way:**

```dart
// Subdomain: sub.domain.tld
final owner = await parser.getOwnerFromDomainTld('vault.miester.abc');
```

The method handles NFT-wrapped domains automatically. If a domain is wrapped as an NFT, it traces through the NFT mint to find the actual token holder.

> **GOTCHA**: The domain string must INCLUDE the TLD (e.g., `'miester.abc'`, not `'miester'`). If you pass just `'miester'`, it can't determine which TLD's namespace to search and will throw.

> **GOTCHA**: Always lowercase the input before passing it. The on-chain hash is computed from lowercase bytes. `'Miester.abc'` and `'miester.abc'` hash to different PDAs. The SDK does NOT auto-lowercase.

```dart
// ALWAYS normalize
final owner = await parser.getOwnerFromDomainTld(input.toLowerCase());
```

### Reverse Resolution: Address → Main Domain

Look up a wallet's "main domain" (the domain the user has set as primary):

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart';

final userPubkey = Ed25519HDPublicKey.fromBase58('2EGGxj...');

// Throws if no main domain is set
final mainDomain = await parser.getMainDomain(userPubkey);
print('${mainDomain.domain}${mainDomain.tld}'); // "miester.abc"

// Preferred: returns null instead of throwing
final mainDomain = await parser.tryGetMainDomain(userPubkey);
if (mainDomain != null) {
  print('${mainDomain.domain}${mainDomain.tld}');
}
```

> **WHY THIS MATTERS**: Use `tryGetMainDomain` in production, not `getMainDomain`. Most wallets don't have a main domain set, so the throwing version creates noisy error logs. `tryGetMainDomain` is the safe default.

The `MainDomain` object:

```dart
class MainDomain {
  final String domain; // e.g., "miester"
  final String tld;    // e.g., ".abc"
  // ...
}
// Full domain: '${mainDomain.domain}${mainDomain.tld}' → "miester.abc"
```

> **GOTCHA**: `mainDomain.tld` already includes the leading dot (`.abc`, not `abc`). Don't add another one: `'${mainDomain.domain}.${mainDomain.tld}'` produces `miester..abc`.

### Listing User Domains

Get all domains owned by a wallet:

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart';

final userPubkey = Ed25519HDPublicKey.fromBase58('2EGGxj...');

// Option 1: Just the name account public keys (fast, minimal RPC)
final domainKeys = await parser.getAllUserDomains(userPubkey);
// Returns List<Ed25519HDPublicKey>

// Option 2: Parsed with domain names (more RPC calls)
final domains = await parser.getParsedAllUserDomains(userPubkey);
for (final d in domains) {
  print('${d.domainName} → ${d.nameAccount.toBase58()}');
}
```

**Scoped to a specific TLD:**

```dart
// Only .skr domains
final skrDomains = await parser.getAllUserDomainsFromTld(
  userPubkey,
  Ed25519HDPublicKey.fromBase58('...'), // .skr parent account
);
```

**Including NFT-wrapped domains:**

```dart
// Includes both directly-owned and NFT-wrapped domains
final allDomains = await parser.getParsedAllUserDomainsUnwrapped(userPubkey);

// Scoped to TLD + NFTs
final allSkr = await parser.getParsedAllUserDomainsFromTldUnwrapped(
  userPubkey,
  Ed25519HDPublicKey.fromBase58('...'), // .skr parent account
);
```

The `Unwrapped` variants perform extra RPC calls to check for NFT ownership. Use the non-unwrapped versions when you only need directly-owned domains.

| Method | Returns | Includes NFTs | RPC Cost |
|--------|---------|---------------|----------|
| `getAllUserDomains` | `List<Ed25519HDPublicKey>` | No | 1 call |
| `getAllUserDomainsFromTld` | `List<Ed25519HDPublicKey>` | No | 1 call |
| `getParsedAllUserDomains` | `List<NameAccountAndDomain>` | No | 1 + N calls |
| `getParsedAllUserDomainsUnwrapped` | `List<NameAccountAndDomain>` | **Yes** | 1 + N + M calls |
| `getParsedAllUserDomainsFromTld` | `List<NameAccountAndDomain>` | No | 1 + N calls |
| `getParsedAllUserDomainsFromTldUnwrapped` | `List<NameAccountAndDomain>` | **Yes** | 1 + N + M calls |

### Records

Domains can store key-value records (Twitter handle, avatar URL, crypto addresses, etc.):

```dart
import 'package:tld_parser/tld_parser.dart';

// Single record
final twitter = await parser.getRecord('miester.abc', Record.twitter);
// Returns String? — null if not set
if (twitter != null) print('Twitter: $twitter');

// Multiple specific records
final result = await parser.getRecords('miester.abc', [
  Record.twitter,
  Record.discord,
  Record.avatar,
]);
// result.records is Map<Record, String?>

// ALL records at once
final all = await parser.getAllRecords('miester.abc');
// Fetches all 27 record types — use sparingly
```

**Available record types (27 total):**

| Category | Records |
|----------|---------|
| **Content** | `url`, `ipfs`, `arweave`, `avatar`, `background` |
| **Crypto** | `sol`, `eth`, `btc`, `ltc`, `doge`, `injective`, `bsc`, `apt` |
| **Social** | `twitter`, `discord`, `github`, `reddit`, `telegram`, `backpack`, `email`, `pic` |
| **Profile** | `displayName`, `about`, `keywords` |

### Avatar Resolution

Get a user's avatar URL with protocol detection (IPFS, Arweave, NFT, or direct URL):

```dart
import 'package:tld_parser/tld_parser.dart';

final avatarUrl = await parser.getAvatar('miester.abc');
if (avatarUrl != null) {
  // Already resolved — IPFS hashes become gateway URLs, etc.
  print('Avatar: $avatarUrl');
}
```

The method handles:

- IPFS hashes → `https://ipfs.io/ipfs/{hash}`
- Arweave IDs → `https://arweave.net/{id}`
- `data:` URIs → returned as-is
- NFT references → fetches NFT metadata image
- Direct URLs → returned as-is

### TLD Discovery

List all available TLDs in the AllDomains protocol:

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart';

// Get all TLDs with their parent accounts
final tlds = await parser.getAllTld();
for (final entry in tlds) {
  print('TLD: ${entry.tld}, Parent: ${entry.parentAccount.toBase58()}');
}
// Example output:
// TLD: .abc, Parent: E5mPnN2o...
// TLD: .bonk, Parent: AKkiTS4p...
// TLD: .skr, Parent: 7M3RL9Tn...
```

> **WHY THIS MATTERS**: You need the parent account for TLD-scoped queries like `getAllUserDomainsFromTld`. Don't hardcode parent accounts — discover them dynamically with `getAllTld()` and cache the result.

### Name Record Header

Get the raw account data for a domain:

```dart
import 'package:tld_parser/tld_parser.dart';

// From domain string
final header = await parser.getNameRecordFromDomainTld('miester.abc');
if (header != null) {
  print('Owner: ${header.owner?.toBase58()}');
  print('Parent: ${header.parentName?.toBase58()}');
  print('Data: ${header.data}');
}

// From a known name account pubkey
final header = await parser.getNameRecordFromNameAccount(nameAccountPubkey);
```

The `NameRecordHeader` has a 200-byte fixed layout:

| Offset | Size | Field |
|--------|------|-------|
| 0-31 | 32 bytes | Parent name (Ed25519HDPublicKey) |
| 32-63 | 32 bytes | Owner (Ed25519HDPublicKey) |
| 64-95 | 32 bytes | NFT owner (Ed25519HDPublicKey) |
| 96-103 | 8 bytes | Expiry (u64 Unix timestamp, LE) |
| 104-135 | 32 bytes | Is valid (all 0x01 if valid) |
| 136-199 | 64 bytes | Reserved padding |
| 200+ | variable | Data (domain content/record value) |

### Error Handling

```dart
import 'package:tld_parser/tld_parser.dart';

try {
  final owner = await parser.getOwnerFromDomainTld('nonexistent.abc');
  // Returns null for non-existent domains — does NOT throw
} on TldParserException catch (e) {
  // Thrown for structural errors (invalid account data, bad PDA)
  print('TLD Parser error: ${e.message}');
} on AccountNotFoundException catch (e) {
  // Account doesn't exist on-chain
  print('Account not found: ${e.message}');
} on InvalidAccountDataException catch (e) {
  // Account exists but data doesn't match expected format
  print('Bad data: ${e.message}');
}
```

Exception hierarchy:

| Exception | When |
|-----------|------|
| `TldParserException` | Base class for all tld_parser errors |
| `AccountNotFoundException` | Account pubkey doesn't exist on-chain |
| `InvalidAccountDataException` | Account data doesn't match expected layout |
| `InvalidDomainException` | Domain string format is invalid |
| `InvalidTldException` | TLD doesn't exist in AllDomains |
| `MainDomainNotFoundException` | `getMainDomain()` called but no main domain set |
| `NftOwnerNotFoundException` | NFT-wrapped domain but can't find token holder |
| `RecordNotFoundException` | Specific record not set on the domain |

> **GOTCHA**: `getOwnerFromDomainTld` returns `null` for missing domains — it does NOT throw `AccountNotFoundException`. But `getMainDomain` DOES throw `MainDomainNotFoundException`. Use `tryGetMainDomain` to get null-return behavior.

## Patterns & Recipes

### Production Domain Resolver (AllDomains + SNS Fallback)

This is the pattern used in Chumbucket's `AddressNameResolver`:

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart' as solana;

class DomainResolver {
  static TldParser? _tldParser;
  static final Map<String, String> _cache = {};
  static final Map<String, DateTime> _timestamps = {};
  static final Map<String, Future<String>> _pending = {};
  static const Duration _cacheExpiry = Duration(hours: 1);

  static const List<String> _allDomainsTlds = [
    '.skr', '.bonk', '.backpack', '.blink', '.monke', '.ninja', '.solana',
  ];

  static TldParser _getParser() {
    return _tldParser ??= TldParser(
      solana.RpcClient('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY'),
    );
  }

  /// Forward: domain → address
  static Future<String?> resolveDomainToAddress(String domain) async {
    final normalized = domain.trim().toLowerCase();
    if (normalized.isEmpty) return null;

    final cacheKey = 'addr:$normalized';
    if (_cache.containsKey(cacheKey)) return _cache[cacheKey];

    if (!_allDomainsTlds.any((ext) => normalized.endsWith(ext))) return null;

    try {
      final owner = await _getParser().getOwnerFromDomainTld(normalized);
      if (owner != null) {
        final address = owner.toBase58();
        _cache[cacheKey] = address;
        return address;
      }
    } catch (e) {
      // Log but don't throw — domain resolution is never critical path
    }
    return null;
  }

  /// Reverse: address → display name (with deduplication)
  static Future<String> resolveAddressToName(String address) async {
    final cacheKey = 'name:$address';

    // Check cache with expiry
    if (_cache.containsKey(cacheKey)) {
      final ts = _timestamps[cacheKey];
      if (ts != null && DateTime.now().difference(ts) < _cacheExpiry) {
        return _cache[cacheKey]!;
      }
      _cache.remove(cacheKey);
      _timestamps.remove(cacheKey);
    }

    // Deduplicate concurrent lookups for the same address
    if (_pending.containsKey(cacheKey)) return _pending[cacheKey]!;

    final future = _doReverseLookup(address, cacheKey);
    _pending[cacheKey] = future;
    try {
      return await future;
    } finally {
      _pending.remove(cacheKey);
    }
  }

  static Future<String> _doReverseLookup(String address, String cacheKey) async {
    try {
      final pubkey = solana.Ed25519HDPublicKey.fromBase58(address);
      final main = await _getParser().tryGetMainDomain(pubkey);
      if (main != null && main.domain.isNotEmpty) {
        final name = '${main.domain}${main.tld}';
        _cache[cacheKey] = name;
        _timestamps[cacheKey] = DateTime.now();
        return name;
      }
    } catch (_) {}

    // Fallback: shortened address
    final short = '${address.substring(0, 6)}...${address.substring(address.length - 4)}';
    _cache[cacheKey] = short;
    _timestamps[cacheKey] = DateTime.now();
    return short;
  }
}
```

### Flutter Widget for Domain Display

```dart
import 'package:flutter/material.dart';

class ResolvedAddressText extends StatelessWidget {
  final String address;
  final TextStyle? style;
  final String? currentUserAddress;

  const ResolvedAddressText({
    super.key,
    required this.address,
    this.style,
    this.currentUserAddress,
  });

  @override
  Widget build(BuildContext context) {
    if (currentUserAddress != null && address == currentUserAddress) {
      return Text('You', style: style);
    }

    return FutureBuilder<String>(
      future: DomainResolver.resolveAddressToName(address),
      builder: (context, snapshot) {
        return Text(
          snapshot.data ?? address,
          style: style,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        );
      },
    );
  }
}
```

> **GOTCHA**: `FutureBuilder` rebuilds on every parent rebuild. The cache prevents duplicate RPC calls, but the widget still flashes between states. For lists with many addresses (leaderboards, transaction histories), resolve all addresses in bulk before building:

```dart
// Pre-resolve a batch before building list
final names = await Future.wait(
  addresses.map((a) => DomainResolver.resolveAddressToName(a)),
);
// Then pass resolved names directly to widgets — no FutureBuilder needed
```

### Domain Input Validation with Debounce

For text fields where users type domain names (send-SOL, add-friend):

```dart
import 'dart:async';

Timer? _debounce;
String? _resolvedAddress;

void onDomainInputChanged(String value) {
  _debounce?.cancel();

  final trimmed = value.trim();

  // Immediate: raw base58 address
  if (_isBase58(trimmed)) {
    setState(() => _resolvedAddress = trimmed);
    return;
  }

  // Not a recognized TLD format
  if (!_isSupportedDomain(trimmed)) {
    setState(() => _resolvedAddress = null);
    return;
  }

  // Debounce domain resolution (600ms after last keystroke)
  _debounce = Timer(const Duration(milliseconds: 600), () async {
    final resolved = await DomainResolver.resolveDomainToAddress(trimmed);
    if (mounted) {
      setState(() => _resolvedAddress = resolved);
    }
  });
}

bool _isSupportedDomain(String value) {
  final lower = value.toLowerCase();
  return ['.skr', '.bonk', '.backpack', '.blink', '.monke', '.ninja', '.solana']
      .any((ext) => lower.endsWith(ext));
}

bool _isBase58(String value) =>
    value.length >= 32 && value.length <= 50 &&
    RegExp(r'^[1-9A-HJ-NP-Za-km-z]+$').hasMatch(value);
```

### Batch Reverse Lookup

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart';

// Get main domains for multiple addresses at once
final addresses = ['2EGGxj...', '7M3RL9...', 'AKkiTS...'];
final pubkeys = addresses.map(Ed25519HDPublicKey.fromBase58).toList();

final mainDomains = await parser.getMainDomains(pubkeys);
// Returns List<String?> — null for addresses without a main domain
// mainDomains[0] = "miester.abc"
// mainDomains[1] = null
// mainDomains[2] = "chad.bonk"
```

### Using Records with Reverse Lookup

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart';

// Step 1: Find user's main domain
final pubkey = Ed25519HDPublicKey.fromBase58('2EGGxj...');
final mainDomain = await parser.tryGetMainDomain(pubkey);
if (mainDomain == null) return;

final fullDomain = '${mainDomain.domain}${mainDomain.tld}';

// Step 2: Fetch their profile records
final records = await parser.getRecords(fullDomain, [
  Record.twitter,
  Record.discord,
  Record.avatar,
  Record.displayName,
]);

final twitter = records.records[Record.twitter];
final avatar = records.records[Record.avatar];
```

## ANS vs SNS — Key Differences for Agents

If you've generated code for Bonfida SNS (`.sol` domains), these are the differences that will break AllDomains code:

| Aspect | SNS (Bonfida, `.sol`) | ANS (AllDomains, any TLD) |
|--------|----------------------|--------------------------|
| **Hash prefix** | `"SPL Name Service"` | `"ALT Name Service"` |
| **Program ID** | `namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX` | `ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK` |
| **SDK package** | `sns_sdk` | `tld_parser` |
| **Client type** | `SnsClient(HttpRpcClient(...))` | `TldParser(RpcClient(...))` |
| **Resolve fn** | `resolve(client, 'name.sol')` | `parser.getOwnerFromDomainTld('name.abc')` |
| **Reverse** | `getPrimaryDomain(GetPrimaryDomainParams(...))` | `parser.tryGetMainDomain(pubkey)` |
| **Returns** | `String` (base58 address) | `Ed25519HDPublicKey?` |

> **CRITICAL**: The hash prefix difference (`"ALT Name Service"` vs `"SPL Name Service"`) means every PDA derivation is different. You cannot mix the two. An SNS domain name resolved through tld_parser (or vice versa) will compute the wrong PDA and return `null` or garbage data.

## PDA Derivation (Reference)

If you need to compute AllDomains PDAs manually (rare — the SDK handles this):

```dart
import 'package:tld_parser/tld_parser.dart';

// The SDK exposes these helpers:
// getDomainKey('domain.tld') — resolves domain string to its on-chain PDA
// getHashedNameSync(name) — SHA256 with "ALT Name Service" prefix

// For a domain "miester.abc":
// 1. Hash the TLD: SHA256("ALT Name Service" + "\0" + "abc")
// 2. Derive TLD account: PDA([hash], ANS_PROGRAM_ID)
// 3. Hash the domain name: SHA256("ALT Name Service" + "\0" + "miester")
// 4. Derive domain account: PDA([hash, tldAccount, originTldKey], ANS_PROGRAM_ID)
//
// The prefix \x00 is for subdomains, \x01 is for records
```

The origin TLD key is a fixed address: `3mX9b4AZaQehNoQGfckVhKMNQiGF7XbGYWkWAsiJMTV5`

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Passing `SolanaClient` to `TldParser()` | Confusion with other Solana packages | Pass `RpcClient` directly: `TldParser(RpcClient(url))` |
| Using devnet RPC for domain lookups | App configured for devnet testing | Always use mainnet RPC for `TldParser` — domains only exist on mainnet |
| Not lowercasing domain input | User types `Miester.abc` | Always `.toLowerCase()` before passing to any parser method |
| Using `getMainDomain` in production | It throws when no domain is set (most wallets) | Use `tryGetMainDomain` — returns `null` instead of throwing |
| Adding extra dot to TLD | `'${mainDomain.domain}.${mainDomain.tld}'` | `mainDomain.tld` already includes the dot: `'${mainDomain.domain}${mainDomain.tld}'` |
| Creating new `TldParser` per call | Following snippet examples literally | Use singleton pattern — reuse one instance |
| Treating return as `String` | SNS SDK returns `String` addresses | `tld_parser` returns `Ed25519HDPublicKey?` — call `.toBase58()` |
| Using SNS hash prefix logic | Copy-pasting from SNS code | ANS uses `"ALT Name Service"`, not `"SPL Name Service"` |
| Not handling `null` from `getOwnerFromDomainTld` | Assuming domain always resolves | Method returns `null` for non-existent domains — always null-check |
| Calling `getOwnerFromDomainTld('miester')` without TLD | Forgetting to include `.abc` | Always pass the full `domain.tld` string including the TLD extension |

## Related

- [solana-core.md](solana-core.md) — The `solana` package that `tld_parser` depends on
- [solana-mobile-client.md](solana-mobile-client.md) — MWA auth flow where domain lookup happens post-connect
- [flutter-web3-security.md](flutter-web3-security.md) — Security patterns for wallet apps
- [AllDomains website](https://alldomains.id)
- [AllDomains docs](https://docs.alldomains.id)
- [tld_parser on pub.dev](https://pub.dev/packages/tld_parser)
- [tld_parser on GitHub](https://github.com/onsol-labs/tld-parser-dart)
