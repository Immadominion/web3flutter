---
name: solana-flutter
description: Flutter and Dart development on Solana. The first agent skill for the Solana mobile and Dart lane, covering Mobile Wallet Adapter, the coral_xyz Anchor client, the solana Dart SDK, transaction building, SPL tokens, Metaplex NFTs, Jupiter swaps, Light Protocol ZK compression, AllDomains ANS resolution, and wallet security. Use when building a Flutter or Dart app that talks to Solana. For TypeScript or Rust, defer to the core Solana skills.
license: MIT
user-invocable: true
---

# Solana Flutter Development Skill

> The Flutter and Dart lane of the Solana ecosystem. Every other Solana agent skill assumes TypeScript or Rust. This one is for the mobile and Dart builders, with code verified against pinned pub.dev versions.

## What This Skill Is For

Read the focused file that matches the task. Load only what you need, not the whole skill.

### Connect a wallet (Mobile Wallet Adapter)
A Flutter Android dApp that signs with Phantom, Solflare, or any MWA wallet.
Read [mobile-wallet-adapter.md](mobile-wallet-adapter.md)

### Call an on-chain program (Anchor)
Talk to an Anchor, Quasar, or Pinocchio program from Dart with a typed IDL client.
Read [anchor-coral-xyz.md](anchor-coral-xyz.md)

### Core SDK work
RPC, keypairs, PDAs, ATAs, building and signing transactions with the solana package.
Read [solana-dart-sdk.md](solana-dart-sdk.md)

### Build and send transactions
Compile legacy or V0 messages, priority fees, simulate, diagnose failures.
Read [transactions.md](transactions.md)

### Tokens
Create mints and ATAs, mint, transfer, burn, Token-2022.
Read [spl-token.md](spl-token.md)

### NFTs
Mint and read Metaplex NFTs, on-chain and off-chain metadata.
Read [metaplex-nft.md](metaplex-nft.md)

### Swaps
Quote and execute Jupiter swaps in app.
Read [jupiter-swaps.md](jupiter-swaps.md)

### ZK compression
Compress accounts and tokens with Light Protocol for about 1/1000th the rent.
Read [zk-compression.md](zk-compression.md)

### Domain resolution
Resolve AllDomains ANS names (.skr, .bonk, and more) to wallets.
Read [domain-resolution.md](domain-resolution.md)

### Wallet security
Encrypt keys at rest, biometric gates, salted Argon2id PINs, simulate before sending.
Read [wallet-security.md](wallet-security.md)

### Packages, versions, links
Read [resources.md](resources.md)

## Default Stack Decisions

- Flutter 3.x, Dart 3.x.
- solana ^0.31.2 (Espresso Cash) for core RPC, keypairs, transactions, SPL, and Metaplex.
- coral_xyz ^1.0.0-beta.9 for Anchor clients. It depends on solana ^0.32.0, so pin solana to ^0.32.0 in any app that uses coral_xyz.
- solana_mobile_client ^0.1.1 for Mobile Wallet Adapter (Android only).
- light_sdk ^0.1.0-beta.1 for ZK compression (Helius RPC required).
- tld_parser ^0.1.0 for AllDomains ANS resolution.
- flutter_secure_storage, local_auth, cryptography (Argon2id), and encrypt for security.

## Rules

- Code in every file compiles against the pinned versions. No pseudo-code, no placeholders.
- Mobile Wallet Adapter and Seed Vault are Android only. Gate with Platform.isAndroid.
- Never log private keys or seed phrases. Encrypt at rest, decrypt only at signing time.
- Always simulate a transaction before sending it.
