# tld_parser — Understanding the AllDomains Name Service SDK

> A Dart SDK that resolves human-readable domain names to Solana wallet addresses — and back — for every TLD on the AllDomains protocol.

## Overview

Every Solana wallet address is a 32-byte Ed25519 public key encoded in Base58. That gives you strings like `2EGGxj2qbNAJNgLCPKca8sxZYetyTjnoRspTPjzN2D67`. Nobody remembers that. Nobody pastes that correctly on the first try.

Name services fix this by mapping human-readable names to those addresses. On Solana, there are two competing name services:

- **SNS (Solana Name Service)** — Built by Bonfida. Only supports `.sol` domains. One program, one TLD.
- **ANS (AllDomains Name Service)** — Supports arbitrary TLDs: `.abc`, `.skr`, `.bonk`, `.backpack`, `.blink`, `.monke`, `.ninja`, `.solana`, and any new TLD that gets registered.

`tld_parser` is the Dart SDK for ANS. It lets you resolve `miester.abc` to a wallet address, look up which domain a wallet has set as their identity, fetch social records attached to domains, and enumerate all domains a user owns — including domains wrapped as NFTs.

If you only want to resolve `.sol` domains, use `sns_sdk`. If you need everything else — or you want one interface that can handle multi-TLD resolution alongside SNS — `tld_parser` is what you reach for.

## Quick Start

```dart
import 'package:solana/solana.dart';
import 'package:tld_parser/tld_parser.dart';

Future<void> main() async {
  final rpcClient = RpcClient('https://api.mainnet-beta.solana.com');
  final parser = TldParser(rpcClient);

  // Forward resolution: domain → wallet address
  final owner = await parser.getOwnerFromDomainTld('miester.abc');
  print('Owner: ${owner?.toBase58()}');

  // Reverse resolution: wallet address → domain
  final userPubkey = Ed25519HDPublicKey.fromBase58(
    '2EGGxj2qbNAJNgLCPKca8sxZYetyTjnoRspTPjzN2D67',
  );
  final mainDomain = await parser.tryGetMainDomain(userPubkey);
  print('Main domain: ${mainDomain?.fullDomain}');

  // Fetch social records
  final twitter = await parser.getRecord('miester.abc', Record.twitter);
  print('Twitter: $twitter');
}
```

That's the surface. The rest of this guide set explains the machinery underneath.

## Why This Guide Exists

The README tells you *how to call the functions*. This guide tells you *what those functions are actually doing* — what on-chain accounts they read, how addresses are derived, what byte layouts they parse, and why the protocol is structured the way it is.

If you want to:

- Understand why resolving a domain requires three PDA derivations
- Know what the `ALT Name Service` hash prefix does and why it's different from SNS
- Debug why a domain shows the wrong owner (hint: it's probably NFT-wrapped)
- Build your own domain resolution service that doesn't use this SDK

...this is the guide.

## The Difference Between ANS and SNS

This matters because both are Solana name services, both store data in accounts derived from hashed names, and both use a similar on-chain model. The differences are structural:

| Aspect | SNS (Bonfida) | ANS (AllDomains) |
|--------|--------------|-----------------|
| TLDs | `.sol` only | Any registered TLD |
| Hash prefix | `SPL Name Service` | `ALT Name Service` |
| Programs | 1 program | 3 programs (ANS, TLD House, Name House) |
| NFT wrapping | Built-in to program | Separate Name House program |
| TLD governance | Centralized (Bonfida) | Per-TLD house authorities |
| Domain hierarchy | 2 levels (domain.sol) | 4 levels (record.sub.domain.tld) |

> **WHY THIS MATTERS**: If you use `SPL Name Service` as your hash prefix when deriving ANS domain keys, you'll get a valid PDA — but it will be the *wrong* PDA. Your domain lookups will silently return no results. The hash prefix is the single most important constant in the SDK.

## Package Structure

The SDK is organized into logical layers:

```
tld_parser/
├── lib/
│   ├── tld_parser.dart            # Barrel file — public API
│   └── src/
│       ├── tld_parser.dart        # TldParser class — main entry point
│       ├── constants.dart         # Program IDs, prefixes, discriminators
│       ├── exceptions.dart        # Typed exception hierarchy
│       ├── name_record_handler.dart # Domain key derivation algorithm
│       ├── pda.dart               # PDA derivation functions
│       ├── utils.dart             # Hashing, seed generation, helpers
│       ├── state/
│       │   ├── name_record_header.dart  # Domain account data (200 bytes)
│       │   ├── main_domain.dart         # User's primary domain
│       │   └── nft_record.dart          # NFT-wrapped domain tracking
│       └── types/
│           ├── domain_key_result.dart   # Derivation result type
│           ├── records.dart             # 27 record type definitions
│           └── tag.dart                 # NFT record state
```

Each layer has a page in this guide:

| Page | What it covers |
|------|---------------|
| [On-Chain Architecture](on-chain-architecture.md) | The three programs, account hierarchy, and how TLDs are organized |
| [PDA Derivation](pda-derivation.md) | How every address is computed from seeds, the hashing algorithm, domain key derivation |
| [State & Deserialization](state-and-deserialization.md) | Byte layouts for NameRecordHeader, MainDomain, NftRecord — how raw bytes become Dart objects |
| [Resolution & Records](resolution-and-records.md) | Forward/reverse lookup, record fetching, NFT ownership resolution, batching |
| [Mobile Integration](mobile-integration.md) | How Chumbucket integrates `tld_parser` alongside SNS, caching strategies, Flutter widgets |

## Dependencies

```yaml
# pubspec.yaml (v0.1.0)
dependencies:
  collection: ^1.18.0   # ListEquality for discriminator comparison
  crypto: ^3.0.3         # SHA256 hashing for name derivation
  solana: ^0.31.0        # RPC client, Ed25519HDPublicKey, transaction types
```

Three dependencies. `solana` does the heavy lifting — RPC calls and public key operations. `crypto` provides SHA256 for the name hashing algorithm. `collection` is there for one thing: byte-by-byte discriminator comparison.

## Related

- [solana package deep dive](../solana-package.md) — The underlying RPC and public key types
- [Borsh serialization](../borsh.md) — How Solana programs serialize account data
- [AllDomains website](https://alldomains.id) — The protocol behind this SDK
- [`tld_parser` on pub.dev](https://pub.dev/packages/tld_parser) — Package page
