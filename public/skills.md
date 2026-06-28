# Web3 Flutter — Agent Skill File

> Copy this file into your project root as `SKILL.md`, `.instructions.md`, or `.cursorrules`.
> Your AI agent will use it as the authoritative reference for building Web3 apps with Flutter on Solana.

---

description: "Index skill file for Web3 Flutter development on Solana. References 16 deep-dive skill files covering every package and pattern in the ecosystem."

globs: "**/*.dart"

---

## How This Works

This is the **index skill**. It gives you the big picture — which packages exist, when to use them, and how they fit together. For deep implementation details, fetch the specific skill file you need from the URLs below. Only fetch what's relevant to the current task.

## Installable Agent Skill (Claude Code, Codex)

This whole skill set is also packaged as an installable agent skill in the standard kit shape: a `skill/SKILL.md` router that progressively loads focused topic files, so an agent reads only what the task needs.

- Repo: https://github.com/Immadominion/solana-flutter-skill
- Install: `git clone https://github.com/Immadominion/solana-flutter-skill && cd solana-flutter-skill && ./install.sh`
- Submitted to the Solana AI Kit skill bounty: https://github.com/solanabr/skill-bounty/pull/86

## Deep-Dive Skill Files

Each skill file below covers one topic in exhaustive detail — API usage, gotchas, code examples, and common mistakes.

### Core SDK

| Skill | What It Covers | URL |
|-------|---------------|-----|
| Solana Core SDK | RPC client, keypairs, transactions, programs | `https://web3flutter.dev/api/skills/solana-core` |
| Solana Package | High-level SDK wrapper, convenience APIs | `https://web3flutter.dev/api/skills/solana-package` |
| Borsh | Binary serialization & deserialization | `https://web3flutter.dev/api/skills/borsh` |
| coral_xyz | Universal Dart client for Anchor/Quasar/Pinocchio programs via IDL | `https://web3flutter.dev/api/skills/coral-xyz` |
| Transaction Building | Construct, sign, simulate, and send transactions | `https://web3flutter.dev/api/skills/transaction-building` |

### Mobile

| Skill | What It Covers | URL |
|-------|---------------|-----|
| Solana Mobile Client | Mobile Wallet Adapter for dApps (authorize, sign, send) | `https://web3flutter.dev/api/skills/solana-mobile-client` |
| Solana Mobile Wallet | Build a wallet app with MWA support | `https://web3flutter.dev/api/skills/solana-mobile-wallet` |
| Solana Seed Vault | Hardware key management on Saga/Seeker devices | `https://web3flutter.dev/api/skills/solana-seed-vault` |

### Tokens & NFTs

| Skill | What It Covers | URL |
|-------|---------------|-----|
| SPL Token | Token operations — mint, transfer, ATAs, Token-2022 | `https://web3flutter.dev/api/skills/spl-token` |
| Token Operations | High-level patterns for SPL tokens and Token-2022 extensions | `https://web3flutter.dev/api/skills/token-ops` |
| Metaplex NFT | Token Metadata, Master Editions, cNFTs, display | `https://web3flutter.dev/api/skills/metaplex-nft` |
| NFT Development | End-to-end NFT workflows — mint, transfer, display | `https://web3flutter.dev/api/skills/nft-dev` |

### DeFi & Staking

| Skill | What It Covers | URL |
|-------|---------------|-----|
| DeFi Patterns | Swaps, staking, liquidity provision patterns | `https://web3flutter.dev/api/skills/defi-patterns` |
| Jupiter Aggregator | DEX swap & price API integration | `https://web3flutter.dev/api/skills/jupiter-aggregator` |
| Stake Program | Native SOL staking — delegate, deactivate, withdraw | `https://web3flutter.dev/api/skills/stake-program` |

### UX & Security

| Skill | What It Covers | URL |
|-------|---------------|-----|
| Wallet UX | Connection flows, signing UI, error handling | `https://web3flutter.dev/api/skills/wallet-ux` |
| Security | Mobile wallet & dApp security best practices | `https://web3flutter.dev/api/skills/flutter-web3-security` |

### Storage & Naming

| Skill | What It Covers | URL |
|-------|---------------|-----|
| Dartus (Walrus) | Walrus decentralized storage SDK — upload, read, certify | `https://web3flutter.dev/api/skills/dartus` |
| bls_dart | Native BLS12-381 signatures for Walrus certification | `https://web3flutter.dev/api/skills/bls-dart` |
| light_sdk | ZK Compression — compressed accounts at 1/1000th cost | `https://web3flutter.dev/api/skills/light-sdk` |
| tld_parser | AllDomains ANS — resolve .sol/.abc domains to wallets | `https://web3flutter.dev/api/skills/tld-parser` |

> **AGENT INSTRUCTION**: When the user's task involves a specific topic above, fetch that skill URL to get full implementation details. You do NOT need to fetch all of them — only the ones relevant to the current task.

## Package Ecosystem Map

### Core Packages

| Package | Purpose | Pub.dev |
|---------|---------|---------|
| `solana` | Full Solana SDK — keypairs, transactions, RPC | solana ^0.31.0 |
| `solana_mobile_client` | MWA, Seed Vault, dApp signing (Saga/Seeker) | solana_mobile_client ^0.3.0 |
| `solana_mobile_wallet` | Build MWA-compatible wallet apps | solana_mobile_wallet ^0.1.0 |
| `borsh` / `borsh_annotation` | Borsh serialization code generator + runtime types | borsh ^0.3.0 / borsh_annotation ^0.3.1 |
| `coral_xyz` | Universal Solana program client (IDL-driven) | coral_xyz ^0.1.0 |
| `dartus` | Walrus decentralized storage SDK | dartus ^0.1.0 |
| `bls_dart` | BLS12-381 for Walrus blob certification | bls_dart ^0.1.0 |
| `light_sdk` | ZK Compression — compressed accounts & state trees | light_sdk ^0.1.0 |
| `tld_parser` | AllDomains ANS domain resolution | tld_parser ^0.1.0 |

### Decision Tree

```
What are you building?
├── Any Solana Flutter app → `solana` (always needed)
│   ├── Interacting with an Anchor/Quasar program? → also `coral_xyz`
│   ├── Interacting with a raw/Pinocchio program? → also `borsh` + `borsh_annotation`
│   ├── Mobile wallet signing on Android? → also `solana_mobile_client`
│   ├── Building a wallet app? → also `solana_mobile_wallet`
│   ├── SPL token transfers or balances? → `solana` has it built-in (or `spl-token` skill for advanced)
│   ├── NFT display? → `solana` + HTTP calls to DAS API (Helius)
│   ├── DEX swaps? → Jupiter Aggregator REST API
│   ├── Native SOL staking? → Stake Program instructions
│   ├── ZK Compression? → `light_sdk`
│   ├── Domain name resolution? → `tld_parser`
│   └── Decentralized storage (Walrus)? → `dartus` + `bls_dart`
└── EVM chains (Ethereum, Polygon) → `web3dart` (not covered here)
```

## Critical Rules

### 1. Never use public RPC in production

```dart
// BAD — will get rate-limited immediately
final client = RpcClient('https://api.mainnet-beta.solana.com');

// GOOD — use a dedicated provider
final client = RpcClient('https://your-provider.com/api-key');
```

Providers: Helius, QuickNode, Triton, Alchemy. Budget ~$50/month for a production app.

### 2. Keypairs — Ed25519HDKeyPair IS your wallet

The derivation path `m/44'/501'/0'/0'` is Solana's standard. If a user imports their Phantom mnemonic, you MUST use this path or you'll derive a different address.

### 3. PDAs — Seeds must EXACTLY match the on-chain program

If the Rust program uses `b"vault"` and the user's pubkey as seeds, your Dart code must use the identical bytes in the identical order. One byte off = different PDA = transaction fails.

### 4. Tokens — Wallets don't hold tokens; they own token accounts

Each token type (mint) needs a separate Associated Token Account (ATA). Creating an ATA costs ~0.00203 SOL.

### 5. Commitment levels matter

- `processed` — Seen by the node, might be dropped
- `confirmed` — Voted on by supermajority (use for UI updates)
- `finalized` — Irreversible (use for money movement)

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `BlockhashNotFound` | Transaction took too long | Refetch blockhash, retry |
| `SignatureVerificationFailed` | Wrong signer or signer order | Check instruction's signer requirements |
| `InsufficientFunds` | Not enough SOL for tx + rent | Check balance before sending |
| `AccountNotFound` | Trying to read a non-existent account | Create the account first (e.g., ATA) |
| `Simulation failed` | Program not deployed, or wrong program ID | Verify program exists on-chain |
| `InvalidPDA` (0x4) | Seeds or program ID mismatch | Ensure Dart seeds match Rust program exactly |

## Architecture Patterns

1. **Isolate crypto** — Run keypair generation and signing in a Dart isolate to avoid blocking the UI thread
2. **Global RPC client** — Create one `RpcClient` instance and share it (via Riverpod provider or similar)
3. **Optimistic UI** — Update the UI immediately after sending a transaction, then confirm via websocket subscription
4. **Retry with backoff** — RPC calls can fail transiently. Retry 2-3 times with exponential backoff before showing an error

## Security

- Never log or print private keys
- Use `flutter_secure_storage` with biometric protection for mnemonics
- Request only necessary scopes in MWA authorization
- Validate all on-chain data — accounts can be spoofed if you don't check the owner program
- See the [Security skill file](https://web3flutter.dev/api/skills/flutter-web3-security) for a comprehensive checklist

## Quick Reference

| Value | Amount |
|-------|--------|
| 1 SOL | 1,000,000,000 lamports |
| ATA rent | ~0.00203 SOL |
| Minimum tx fee | 5,000 lamports (0.000005 SOL) |
| Priority fee (typical) | 10,000-100,000 lamports |

### Program IDs You'll Use

| Program | ID |
|---------|-----|
| System Program | `11111111111111111111111111111111` |
| Token Program | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| Associated Token | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |
| Memo Program | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| Metaplex Metadata | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` |
| Bubblegum (cNFTs) | `BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY` |
| Stake Program | `Stake11111111111111111111111111111111111111` |

---

*Maintained by [web3flutterhq](https://x.com/web3flutterhq). Last updated: 2026-04.*
