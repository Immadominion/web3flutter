# Web3 Flutter — Agent Skill File

> Copy this file into your project root as `SKILL.md`, `.instructions.md`, or `.cursorrules`.
> Your AI agent will use it as the authoritative reference for building Web3 apps with Flutter on Solana.

---

description: "Index skill file for Web3 Flutter development on Solana. References deep-dive skill files for each package and pattern."

globs: "**/*.dart"

---

## How This Works

This is the **index skill**. It gives you the big picture — which packages exist, when to use them, and how they fit together. For deep implementation details, fetch the specific skill file you need from the URLs below. Only fetch what's relevant to the current task.

## Deep-Dive Skill Files

Each skill file below covers one topic in exhaustive detail — API usage, gotchas, code examples, and common mistakes.

| Skill | What It Covers | URL |
|-------|---------------|-----|
| Solana Package | RPC client, keypairs, transactions, programs | `https://web3flutter.dev/api/skills/solana-package` |
| Borsh | Binary serialization & deserialization | `https://web3flutter.dev/api/skills/borsh` |
| coral_xyz | Universal Dart client for Solana programs | `https://web3flutter.dev/api/skills/coral-xyz` |
| Solana Mobile | MWA, Seed Vault, dApp Store (Android) | `https://web3flutter.dev/api/skills/solana-mobile` |
| Token Operations | SPL tokens, ATAs, Token-2022, transfers | `https://web3flutter.dev/api/skills/token-ops` |
| NFT Development | Metaplex, cNFTs, metadata, display | `https://web3flutter.dev/api/skills/nft-dev` |
| DeFi Patterns | Swaps, staking, liquidity, Jupiter | `https://web3flutter.dev/api/skills/defi-patterns` |
| Wallet UX | Connection flows, signing UI, errors | `https://web3flutter.dev/api/skills/wallet-ux` |

> **AGENT INSTRUCTION**: When the user's task involves a specific topic above, fetch that skill URL to get full implementation details. You do NOT need to fetch all of them — only the ones relevant to the current task.

## Package Ecosystem Map

### Core Packages

| Package | Purpose | Pub.dev |
|---------|---------|---------|
| `solana` | Full Solana SDK — keypairs, transactions, RPC | solana ^0.31.0 |
| `solana_mobile_client` | MWA, Seed Vault, dApp signing (Saga/Seeker) | solana_mobile_client ^0.3.0 |
| `borsh` / `borsh_annotation` | Borsh serialization code generator + runtime types | borsh ^0.3.0 / borsh_annotation ^0.3.1 |
| `coral_xyz` | Universal Solana program client (IDL-driven) | coral_xyz ^0.1.0 |

### Decision Tree

```
What are you building?
├── Any Solana Flutter app → `solana` (always needed)
│   ├── Interacting with an Anchor program? → also `coral_xyz`
│   ├── Interacting with a raw/Pinocchio program? → also `borsh` + `borsh_annotation`
│   ├── Mobile wallet signing on Android? → also `solana_mobile_client`
│   ├── SPL token transfers or balances? → `solana` has it built-in
│   └── NFT display? → `solana` + HTTP calls to DAS API (Helius)
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

---

*Maintained by [web3flutterhq](https://x.com/web3flutterhq). Last updated: 2026-04.*
