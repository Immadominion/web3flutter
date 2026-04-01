# Mobile Integration — How Chumbucket Uses tld_parser in Production

> This page traces how the `tld_parser` SDK is integrated into a real Flutter app — from RPC initialization to cached domain resolution to the `ResolvedAddressText` widget that displays domain names across every screen.

## Overview

Chumbucket is a Flutter mobile app on Solana that uses `tld_parser` alongside Bonfida's `sns_sdk` to resolve domain names throughout its UI. Every wallet address you see in the app — challenge participants, transfer recipients, your own profile — goes through domain resolution. If the wallet has a domain name, that name is displayed instead of the raw Base58 address.

This isn't a thin integration. `tld_parser` touches authentication, wallet transfers, friend management, challenge display, and profile screens. The SDK is wrapped in a single service class — `AddressNameResolver` — that handles caching, deduplication, and fallback between AllDomains and SNS.

This page shows the real patterns used in production, not toy examples. If you're building a Flutter app that needs domain resolution, this is how it's actually done.

## The Service Layer: AddressNameResolver

All domain resolution in Chumbucket goes through one static class: `AddressNameResolver`. It lives in `lib/shared/services/address_name_resolver.dart` and wraps both `TldParser` and `SnsClient`.

### Initialization

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart' as solana;
import 'package:flutter_dotenv/flutter_dotenv.dart';

class AddressNameResolver {
  static TldParser? _tldParser;

  static TldParser _getTldParser() {
    if (_tldParser != null) return _tldParser!;
    final rpcClient = solana.RpcClient(_mainnetRpcUrl);
    _tldParser = TldParser(rpcClient);
    return _tldParser!;
  }

  static String get _mainnetRpcUrl {
    // Prefer Helius RPC if API key is available
    final heliusKey = dotenv.env['HELIUS_API_KEY'];
    if (heliusKey != null && heliusKey.isNotEmpty) {
      return 'https://mainnet.helius-rpc.com/?api-key=$heliusKey';
    }
    // Fallback to public RPC (rate limited)
    return 'https://api.mainnet-beta.solana.com';
  }
}
```

Two things to note:

1. **The RPC always points to mainnet.** Domain names live on mainnet even if the app is running on devnet for other features. This is a common pattern — your app might use devnet for testing token transfers, but domain resolution always hits mainnet because that's where the domains are registered.

2. **Lazy singleton initialization.** The `TldParser` is created once and reused. The `RpcClient` inside it maintains its own HTTP connection.

> **CRITICAL**: If your app targets devnet for testing, don't accidentally pass a devnet RPC URL to `TldParser`. AllDomains accounts don't exist on devnet. Your lookups will return `null` for every domain and you'll burn hours thinking there's a deserialization bug.

### Supported TLDs

Chumbucket explicitly lists which AllDomains TLDs it supports:

```dart
static const List<String> _allDomainsTldExtensions = [
  '.skr',       // Seeker/Solana Mobile
  '.bonk',      // Bonk token
  '.backpack',  // Backpack wallet
  '.blink',     // Blink action framework
  '.monke',     // Monke DAO
  '.ninja',     // Ninja
  '.solana',    // Official Solana
];
```

This list is a design choice. AllDomains supports many more TLDs (you can enumerate them with `parser.getAllTld()`), but the app explicitly declares which ones it recognizes. This matters for input validation — when a user types `bob.unknown` in the send-SOL field, the app needs to decide whether to try resolution or reject it as invalid.

### Domain Detection Helpers

The resolver provides static methods for identifying domain types:

```dart
// Is this string a base58 wallet address?
static bool isBase58Address(String value) =>
    value.length >= 32 && value.length <= 50 && _base58.hasMatch(value);

// Is this a .sol domain? (routes to SNS SDK)
static bool isSolDomain(String value) => value.toLowerCase().endsWith('.sol');

// Is this an AllDomains TLD? (routes to tld_parser)
static bool isAllDomainsTld(String value) {
  final lower = value.toLowerCase();
  return _allDomainsTldExtensions.any((ext) => lower.endsWith(ext));
}

// Is this ANY supported domain?
static bool isSnsDomain(String value) {
  final lower = value.toLowerCase();
  return _supportedDomainExtensions.any((ext) => lower.endsWith(ext));
}
```

These are called before any RPC work. If the input doesn't look like an address or a supported domain, the resolver short-circuits.

## Forward Resolution: Domain → Address

When a user types a domain name in the SOL transfer field (e.g., `miester.abc`), the app resolves it to a wallet address:

```dart
static Future<String?> resolveAddress(String input) async {
  final trimmed = input.trim();
  if (trimmed.isEmpty) return null;

  // Already a wallet address — return as-is
  if (isBase58Address(trimmed)) return trimmed;

  // Check cache
  if (_cache.containsKey('addr:$trimmed')) return _cache['addr:$trimmed'];

  // Route to the right resolver based on TLD
  if (isSolDomain(trimmed)) {
    return _resolveSolDomain(trimmed);    // → sns_sdk
  } else if (isAllDomainsTld(trimmed)) {
    return _resolveAllDomainsTld(trimmed); // → tld_parser
  }

  return null; // Unknown domain format
}
```

The AllDomains resolver:

```dart
static Future<String?> _resolveAllDomainsTld(String domain) async {
  try {
    final parser = _getTldParser();
    final normalizedDomain = domain.toLowerCase();
    final owner = await parser.getOwnerFromDomainTld(normalizedDomain);

    if (owner != null) {
      final ownerAddress = owner.toBase58();
      _cache['addr:$domain'] = ownerAddress;
      return ownerAddress;
    }
  } catch (e) {
    if (kDebugMode) {
      log('AddressNameResolver: TLD Parser resolution failed for $domain: $e');
    }
  }
  return null;
}
```

The pattern: normalize to lowercase, call `getOwnerFromDomainTld`, cache the result, return `null` on any failure. Failures are logged in debug mode but never surface to the user as exceptions.

## Reverse Resolution: Address → Domain

When the app needs to display a wallet address (in profile cards, challenge receipts, transfer results), it tries to resolve it to a domain name:

```dart
static Future<String> resolveDisplayName(String input) async {
  final trimmed = input.trim();
  if (trimmed.isEmpty) return 'Unknown';
  if (_looksLikeName(trimmed)) return trimmed; // Already a name

  // Check cache with expiry
  final cacheKey = 'name:$trimmed';
  if (_cache.containsKey(cacheKey)) {
    final timestamp = _cacheTimestamps[cacheKey];
    if (timestamp != null &&
        DateTime.now().difference(timestamp) < _cacheExpiry) {
      return _cache[cacheKey]!;
    }
    _cache.remove(cacheKey);
    _cacheTimestamps.remove(cacheKey);
  }

  // Only try lookup for base58 addresses
  if (!isBase58Address(trimmed)) {
    final fallback = _shorten(trimmed);
    _cache['name:$trimmed'] = fallback;
    return fallback;
  }

  // Deduplication: don't fire parallel lookups for the same address
  if (_pendingLookups.containsKey(cacheKey)) {
    return _pendingLookups[cacheKey]!;
  }

  final lookupFuture = _performDomainLookup(trimmed, cacheKey);
  _pendingLookups[cacheKey] = lookupFuture;

  try {
    return await lookupFuture;
  } finally {
    _pendingLookups.remove(cacheKey);
  }
}
```

### The Resolution Priority

The actual lookup function tries AllDomains first, then falls back to SNS:

```dart
static Future<String> _performDomainLookup(String address, String cacheKey) async {
  // 1. Try AllDomains main domain (tld_parser)
  try {
    final parser = _getTldParser();
    final userPubkey = solana.Ed25519HDPublicKey.fromBase58(address);
    final mainDomain = await parser.tryGetMainDomain(userPubkey);

    if (mainDomain != null && mainDomain.domain.isNotEmpty) {
      final domain = '${mainDomain.domain}${mainDomain.tld}';
      _cache[cacheKey] = domain;
      _cacheTimestamps[cacheKey] = DateTime.now();
      return domain;
    }
  } catch (e) {
    // Log and continue to SNS fallback
  }

  // 2. Try SNS primary domain (.sol)
  try {
    // ... sns_sdk calls ...
  } catch (e) {
    // Log and continue
  }

  // 3. Fallback: shortened address (e.g., "2EGGxj...2D67")
  final fallback = _shorten(address);
  _cache[cacheKey] = fallback;
  _cacheTimestamps[cacheKey] = DateTime.now();
  return fallback;
}
```

The priority is intentional: AllDomains first, then SNS, then a shortened address. This means if a user has both a `.abc` main domain and a `.sol` domain, the `.abc` domain wins. This is a product decision — AllDomains domains are preferred because the app's ecosystem is built around them.

> **WHY THIS MATTERS**: If your app needs different priority (e.g., `.sol` first), reverse the order of these try blocks. The resolution strategy is a UX decision, not a technical one.

## Caching Strategy

The resolver uses three caching mechanisms:

### 1. Result Cache (1 Hour Expiry)

```dart
static final Map<String, String> _cache = {};
static final Map<String, DateTime> _cacheTimestamps = {};
static const Duration _cacheExpiry = Duration(hours: 1);
```

Every resolution result (domain name or shortened address) is cached with a timestamp. On the next lookup, if the cache entry is less than 1 hour old, it's returned immediately.

### 2. Lookup Deduplication

```dart
static final Map<String, Future<String>> _pendingLookups = {};
```

If two widgets request resolution for the same address simultaneously (common when a screen loads and multiple `ResolvedAddressText` widgets fire), only one RPC call is made. Subsequent requests await the same `Future`.

### 3. Short-Circuit for Non-Addresses

```dart
static bool _looksLikeName(String value) {
  if (value.contains(' ') || value.contains('@')) return true;
  if (isSnsDomain(value)) return true;
  if (value.length < 32 || !_base58.hasMatch(value)) return true;
  return false;
}
```

If the input already looks like a name (contains spaces, is a domain, or is too short to be an address), it's returned immediately without any RPC call.

## The Display Widget: ResolvedAddressText

The most reused component is `ResolvedAddressText`, a widget that asynchronously resolves and displays a domain name:

```dart
class ResolvedAddressText extends StatelessWidget {
  final String addressOrLabel;
  final TextStyle? style;
  final String prefix;
  final int maxLines;
  final String? currentUserAddress;
  final String youLabel;

  const ResolvedAddressText({
    super.key,
    required this.addressOrLabel,
    this.style,
    this.prefix = '',
    this.maxLines = 1,
    this.currentUserAddress,
    this.youLabel = 'You',
  });

  @override
  Widget build(BuildContext context) {
    // Special case: show "You" for the current user's address
    if (currentUserAddress != null && addressOrLabel == currentUserAddress) {
      return Text('$prefix$youLabel', style: style, maxLines: maxLines,
        overflow: TextOverflow.ellipsis);
    }

    return FutureBuilder<String>(
      future: AddressNameResolver.resolveDisplayName(addressOrLabel),
      builder: (context, snapshot) {
        final resolved = snapshot.data;
        final text = (resolved == null || resolved.isEmpty)
            ? addressOrLabel
            : resolved;
        return Text('$prefix$text', style: style, maxLines: maxLines,
          overflow: TextOverflow.ellipsis);
      },
    );
  }
}
```

This widget appears in **9 screens** across the app:

- Profile wallet cards
- Challenge cards (witness names)
- Challenge receipt screens
- SOL transfer result screens
- Wallet modals
- Friend management sheets

### Usage Example

```dart
// In a challenge card — show witness name as resolved domain
Expanded(
  child: ResolvedAddressText(
    addressOrLabel: witnessWalletAddress,
    prefix: 'Witness: ',
    style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w500),
    maxLines: 1,
  ),
)

// In a wallet card — show "You" if it's the current user
ResolvedAddressText(
  addressOrLabel: walletProvider.walletAddress!,
  currentUserAddress: walletProvider.walletAddress,
  style: TextStyle(fontSize: 14.sp),
  maxLines: 1,
)
```

> **GOTCHA**: `FutureBuilder` rebuilds on every parent rebuild. The deduplication cache prevents duplicate RPC calls, but the widget still flashes between loading and resolved states if the parent rebuilds frequently. For lists with many addresses (like a leaderboard), consider resolving all addresses in bulk before building the list, rather than using `ResolvedAddressText` per item.

## Authentication Integration

Domain resolution is woven into the authentication flow. When a user connects via Mobile Wallet Adapter (MWA), the app immediately tries to resolve their domain:

```dart
// In MwaAuthProvider, after successful wallet connection
String? snsDomain;
try {
  final domainName = await AddressNameResolver.resolveDisplayName(walletAddress);
  // Only treat it as a domain if it's not a shortened address
  if (!domainName.contains('...') && domainName != walletAddress) {
    snsDomain = domainName;
  }
} catch (e) {
  // Non-critical — domain lookup failure doesn't block auth
}
```

The resolved domain is stored in the `MwaAuthResult` and synced to the backend database. This means the server knows your domain name without doing its own resolution.

The auth provider also has a specific getter for `.skr` domains (Seeker wallet domains):

```dart
bool get hasSeekerDomain => snsDomain?.endsWith('.skr') ?? false;
```

This is used to show Seeker-specific UI features.

## SOL Transfer with Domain Input

The send-SOL sheet demonstrates the full cycle — input validation, domain resolution, and transfer:

```dart
// 1. Validate input as you type
bool _isValidAddress() {
  final address = _addressController.text.trim();
  if (address.isEmpty) return false;
  return AddressNameResolver.isBase58Address(address) ||
      AddressNameResolver.isSolDomain(address);
}

// 2. Resolve domain to address before sending
Future<void> _sendSol() async {
  String destinationAddress = addressInput;

  if (AddressNameResolver.isSolDomain(addressInput)) {
    destinationAddress = await AddressNameResolver.resolveAddress(addressInput)
        ?? throw Exception('Could not resolve domain name: $addressInput');
  }

  // Now destinationAddress is always a Base58 wallet address
  await walletProvider.sendSol(destinationAddress, amount);
}
```

### Friend Management with Debounced Resolution

The add-friend sheet shows a more sophisticated pattern — debounced domain resolution as the user types:

```dart
Timer? _debounceTimer;

void _validateAddress(String value) {
  final trimmed = value.trim();
  _debounceTimer?.cancel();

  if (AddressNameResolver.isBase58Address(trimmed)) {
    // Immediate validation for raw addresses
    setState(() {
      _addressValidation = AddressValidationState.valid;
      _resolvedAddress = trimmed;
    });
  } else if (!AddressNameResolver.isSnsDomain(trimmed)) {
    // Not a valid address or domain
    setState(() {
      _addressValidation = AddressValidationState.invalid;
    });
  } else {
    // Domain — debounce the resolution
    _debounceTimer = Timer(Duration(milliseconds: 600), () async {
      final resolved = await AddressNameResolver.resolveAddress(trimmed);
      if (resolved != null && mounted) {
        setState(() {
          _addressValidation = AddressValidationState.valid;
          _resolvedAddress = resolved;
        });
      } else if (mounted) {
        setState(() {
          _addressValidation = AddressValidationState.invalid;
        });
      }
    });
  }
}
```

The 600ms debounce prevents firing RPC calls on every keystroke. Resolution only starts once the user stops typing.

## Architecture Patterns Summary

| Pattern | How Chumbucket Does It | Why |
|---------|----------------------|-----|
| **Service wrapper** | Static `AddressNameResolver` class wraps `TldParser` | Single point of control for caching, logging, fallback |
| **Mainnet RPC** | Always mainnet, even if app is on devnet | Domains only exist on mainnet |
| **Lazy init** | `TldParser` created on first use | Avoids initialization cost if domain resolution isn't needed |
| **AllDomains-first** | `tryGetMainDomain` before SNS lookups | Product decision — AllDomains preferred in this ecosystem |
| **Cache + dedup** | 1-hour cache + pending lookup deduplication | Prevents RPC rate limiting from concurrent widget builds |
| **Non-blocking auth** | Domain lookup failure doesn't block wallet connection | Domain is cosmetic; auth must succeed even offline |
| **Debounced input** | 600ms debounce on domain resolution input | Prevents RPC spam during typing |
| **Widget layer** | `ResolvedAddressText` with `FutureBuilder` | Plug-and-play domain display anywhere in the UI |

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Creating a new `TldParser` per resolution call | Copying example code without singleton pattern | Use a singleton or lazy-initialized instance |
| Not caching resolution results | Causes repeated RPC calls for the same address | Add a `Map<String, String>` cache with time-based expiry |
| Blocking UI on domain resolution | Calling `await resolve()` in build methods | Use `FutureBuilder` or resolve in `initState` with `mounted` check |
| Using devnet RPC for domain resolution | App configured for devnet testing | Always use mainnet RPC for `TldParser` |
| Not handling null from `resolveAddress` | Some domains don't resolve (expired, typo) | Show the raw address as fallback, never show an empty string |

## Related

- [Resolution & Records](resolution-and-records.md) — The SDK methods being called under the hood
- [On-Chain Architecture](on-chain-architecture.md) — Why resolution requires multiple RPC calls
- [solana-mobile guide](../solana-mobile.md) — MWA authentication flow used alongside domain resolution
- [wallet-ux guide](../wallet-ux.md) — UX patterns for wallet and address display
