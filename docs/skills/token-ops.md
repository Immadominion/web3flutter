# Token Operations — SPL Tokens in Flutter

> Create, transfer, and manage SPL tokens and Token-2022 extensions from Flutter apps.

## Overview

On Solana, tokens aren't balances on a contract — they're separate accounts owned by the Token Program. Understanding this model is essential for any Flutter app that works with tokens.

## Quick Start

```dart
import 'package:solana/solana.dart';

final client = RpcClient('https://api.devnet.solana.com');

// Get all tokens owned by a wallet
final tokenAccounts = await client.getTokenAccountsByOwner(
  owner: wallet.publicKey.toBase58(),
  programId: Ed25519HDPublicKey.fromBase58(
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ),
  encoding: Encoding.jsonParsed,
);
```

## Core Concepts

### The Token Account Model

```
┌──────────────┐    owns     ┌──────────────────┐
│ Your Wallet   │ ──────────→│ Token Account A    │ ← holds 100 USDC
│ (System-owned)│            │ (Token Prog-owned) │    mint: USDC mint
│               │ ──────────→│ Token Account B    │ ← holds 50 RAY 
│               │    owns    │ (Token Prog-owned) │    mint: RAY mint
└──────────────┘            └──────────────────┘
```

> **WHY THIS MATTERS**: Your wallet doesn't "hold" tokens. Instead, your wallet is the OWNER of Token Accounts, and THOSE accounts hold the token balance. Each token account is tied to exactly one mint (token type). This is why you need an Associated Token Account (ATA) for each new token.

### Associated Token Accounts (ATAs)

An ATA is the deterministic token account for a given wallet + mint pair:

```dart
// Derive the ATA address
final ata = await findAssociatedTokenAddress(
  owner: wallet.publicKey,
  mint: usdcMint,
);
// This address is the same every time for the same wallet + mint

// Create the ATA if it doesn't exist
final createAtaIx = AssociatedTokenAccountInstruction.createAccount(
  funder: wallet.publicKey,       // Pays for account rent
  address: ata,                    // The ATA address
  owner: wallet.publicKey,         // Who owns the tokens
  mint: usdcMint,                  // Which token type
);
```

> **GOTCHA**: Creating an ATA costs ~0.00203 SOL (rent-exempt minimum for a token account). If the user is receiving a token for the first time, someone has to pay this. Usually the sender or your dApp pays.

### Token Transfers

```dart
// Transfer SPL tokens between wallets
final transferIx = TokenInstruction.transfer(
  source: senderAta,      // Sender's ATA for this token
  destination: receiverAta, // Receiver's ATA for this token
  owner: wallet.publicKey,  // Sender's wallet (signer)
  amount: 1000000,          // Amount in smallest unit (depends on decimals)
);

final message = Message(instructions: [transferIx]);
await client.signAndSendTransaction(message, [wallet]);
```

### Token Decimals

Different tokens have different decimal places, much like currencies:

```dart
// USDC: 6 decimals → 1 USDC = 1,000,000 units
// SOL (wrapped): 9 decimals → 1 wSOL = 1,000,000,000 units
// Some NFTs: 0 decimals → 1 unit = 1 token

// Helper to convert display amount to raw amount
int toRawAmount(double displayAmount, int decimals) {
  return (displayAmount * pow(10, decimals)).toInt();
}

// And back
double toDisplayAmount(int rawAmount, int decimals) {
  return rawAmount / pow(10, decimals);
}
```

### Token-2022 (Token Extensions)

Token-2022 is the next-gen token program with extensions:

```dart
// Token-2022 program ID
final token2022ProgramId = Ed25519HDPublicKey.fromBase58(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);

// Extensions include:
// - Transfer fees (automatic fee on every transfer)
// - Interest-bearing tokens
// - Non-transferable tokens (soulbound)
// - Confidential transfers (encrypted amounts)
// - Transfer hooks (custom logic on transfer)
// - Permanent delegate (authority that can always transfer)

// When querying, check BOTH token programs
final standardTokens = await client.getTokenAccountsByOwner(
  owner: wallet.publicKey.toBase58(),
  programId: tokenProgramId,
  encoding: Encoding.jsonParsed,
);

final token2022Tokens = await client.getTokenAccountsByOwner(
  owner: wallet.publicKey.toBase58(),
  programId: token2022ProgramId,
  encoding: Encoding.jsonParsed,
);
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Sending to wallet address instead of ATA | Confusion between wallet and token account | Always derive ATA: `findAssociatedTokenAddress(owner, mint)` |
| Ignoring Token-2022 accounts | Only checking Token Program | Query both `TokenkegQ...` and `Tokenz...` program IDs |
| Displaying raw amounts | Forgetting decimals | Always divide by `10^decimals` for display |
| Not creating receiver's ATA | First-time token recipient | Include `createAccount` instruction before transfer |
| Assuming 6 decimals | USDC is 6, but others vary | Fetch mint info to get actual decimals: `client.getAccountInfo(mint)` |

## Related

- [Solana Package Deep Dive](./solana-package.md) — Transaction building basics
- [NFT Development](./nft-dev.md) — NFTs are technically SPL tokens with 0 decimals and supply of 1

---

*SPL Token Program: [Source](https://github.com/solana-labs/solana-program-library/tree/master/token)*
