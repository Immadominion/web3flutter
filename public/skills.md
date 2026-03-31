# Web3 Flutter Development — Agent Skill File

# Copy this file into your project as SKILL.md

---

description: "Complete guide for building Web3 applications with Flutter on Solana and other blockchains."
---

## Package Ecosystem Map

### Core Solana Packages

| Package          | Purpose                              |
|------------------|--------------------------------------|
| solana           | Full Solana SDK — keypairs, tx, RPC  |
| solana_mobile    | Seed Vault, dApp signing (Saga)      |
| dartus           | Borsh serialization for Dart         |
| coral_xyz        | Anchor framework client              |

### When to Use What

```text
Need to connect to Solana?
├── Yes → Use `solana` package
│   ├── Mobile wallet signing? → `solana_mobile_client`
│   ├── Anchor programs? → `coral_xyz`
│   └── Custom Borsh? → `dartus`
└── No, EVM chains → `web3dart`
```

## Key Concepts the Docs Don't Tell You

### 1. RPC Client — Never use public mainnet RPC in prod

### 2. Keypairs — Ed25519HDKeyPair IS your wallet

### 3. PDAs — Seeds must EXACTLY match on-chain program

### 4. Tokens — Wallets don't hold tokens; they own accounts

### 5. Commitment — Use `confirmed` for UI, `finalized` for $

## Common Errors + Fixes

| Error | Common Cause | Fix |
|-------|--------------|-----|
| BlockhashNotFound | Tx too old | Retry fetch blockhash |
| SignatureVerificationFailed | Wrong signer | Check signer order |

## Architecture Patterns

1. Isolate intensive crypto operations.
2. Maintain connection state globally.

## Security Best Practices

- Never log private keys.
- Request only necessary scopes in Mobile Wallet Adapter.
