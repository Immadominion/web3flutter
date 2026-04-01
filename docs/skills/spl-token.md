# SPL Token — Token Operations for Dart/Flutter

> SPL Token Program instructions and high-level `SolanaClient` extensions for
> creating mints, managing token accounts, transferring, minting, burning,
> and authority management. Includes Token-2022 (Token Extensions) support.

| Package | Version | Pub |
|---------|---------|-----|
| `solana` | 0.31.2+ | [pub.dev](https://pub.dev/packages/solana) |

**SPL token support is built into the `solana` package** — no separate package
needed. Import via `package:solana/solana.dart` and `package:solana/encoder.dart`.

---

## Overview

The `solana` package provides two API layers for SPL tokens:

1. **Low-level `TokenInstruction`** — factory constructors that produce
   individual `Instruction` objects for every Token Program operation.
2. **High-level `SolanaClient` extensions** — convenience methods on
   `SolanaClient` that build, sign, and send complete transactions.

Both layers support the original Token Program and Token-2022 via the
`TokenProgramType` enum.

---

## Quick Start

```dart
import 'package:solana/solana.dart';

Future<void> tokenDemo() async {
  final client = SolanaClient(
    rpcUrl: Uri.parse('https://api.devnet.solana.com'),
    websocketUrl: Uri.parse('wss://api.devnet.solana.com'),
  );
  final authority = await Ed25519HDKeyPair.random();

  // 1. Create a new token mint (6 decimals)
  final mint = await client.initializeMint(
    mintAuthority: authority,
    decimals: 6,
  );

  // 2. Create associated token account for the authority
  final ata = await client.createAssociatedTokenAccount(
    mint: mint.address,
    funder: authority,
  );

  // 3. Mint 1000 tokens (amount in smallest units)
  await client.mintTo(
    mint: mint.address,
    destination: Ed25519HDPublicKey.fromBase58(ata.pubkey),
    amount: 1000 * 1000000, // 1000 tokens × 10^6 decimals
    authority: authority,
  );
}
```

---

## Core Concepts

### Program IDs

```dart
// Original Token Program
TokenProgram.programId;  // 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
TokenProgram.id;         // Ed25519HDPublicKey

// Token-2022
Token2022Program.programId;  // 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
Token2022Program.id;

// Associated Token Account Program
AssociatedTokenAccountProgram.programId;  // 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
AssociatedTokenAccountProgram.id;
```

### TokenProgramType Enum

Every instruction and extension method accepts an optional `TokenProgramType`
to target the original program or Token-2022:

```dart
enum TokenProgramType { tokenProgram, token2022Program }

// Usage — default is tokenProgram
TokenInstruction.transfer(
  ...,
  tokenProgram: TokenProgramType.token2022Program,
);

await client.createAssociatedTokenAccount(
  ...,
  tokenProgramType: TokenProgramType.token2022Program,
);
```

### Mint Type

```dart
class Mint {
  Ed25519HDPublicKey address;
  BigInt supply;
  int decimals;
  bool isInitialized;
  Ed25519HDPublicKey? mintAuthority;     // null = fixed supply
  Ed25519HDPublicKey? freezeAuthority;   // null = unfrozen
}
```

### Account Space Constants

```dart
TokenProgram.neededMintAccountSpace;     // 82 bytes
TokenProgram.neededAccountSpace;         // 165 bytes
```

---

## High-Level API (SolanaClient Extensions)

### Create a Mint

```dart
final mint = await client.initializeMint(
  mintAuthority: keypair,        // Ed25519HDKeyPair — signs + pays
  decimals: 9,
  freezeAuthority: freezePubKey, // Optional
  tokenProgramType: TokenProgramType.tokenProgram,
  commitment: Commitment.finalized,
);
// Returns Mint object with address, supply, decimals, etc.
```

### Get Mint Info

```dart
final mint = await client.getMint(
  address: mintPubKey,
  commitment: Commitment.finalized,
);
// Throws TokenAccountNotFoundException if not found
```

### Associated Token Accounts

```dart
// Check existence
final exists = await client.hasAssociatedTokenAccount(
  owner: walletPubKey,
  mint: mintPubKey,
);

// Get account (returns null if not found)
final account = await client.getAssociatedTokenAccount(
  owner: walletPubKey,
  mint: mintPubKey,
);

// Create ATA (idempotent if already exists on-chain, but will fail locally)
final ata = await client.createAssociatedTokenAccount(
  mint: mintPubKey,
  funder: walletKeypair,             // Pays rent + signs
  owner: recipientPubKey,            // Defaults to funder.publicKey
  tokenProgramType: TokenProgramType.tokenProgram,
);
```

### Derive ATA Address (Off-chain)

```dart
import 'package:solana/solana.dart';

final ataAddress = await findAssociatedTokenAddress(
  owner: ownerPubKey,
  mint: mintPubKey,
  tokenProgramType: TokenProgramType.tokenProgram,
);
// Returns Ed25519HDPublicKey — PDA derived from [owner, tokenProgram, mint]
```

### Mint Tokens

```dart
await client.mintTo(
  mint: mintPubKey,
  destination: ataPubKey,     // Must be an initialized token account
  amount: 5000000000,         // In smallest unit (lamports for 9-decimal token)
  authority: mintAuthority,   // Ed25519HDKeyPair
);
```

### Transfer SPL Tokens

```dart
await client.transferSplToken(
  mint: mintPubKey,
  destination: recipientWalletPubKey,   // Owner address, NOT ATA address
  amount: 1000000,
  owner: senderWallet,                  // Wallet (keypair)
  memo: 'Payment for order #123',       // Optional memo instruction
  tokenProgram: TokenProgramType.tokenProgram,
);
```

**Important:** `destination` is the **owner's wallet address**, not the ATA.
The method internally resolves both sender and recipient ATAs. Throws
`NoAssociatedTokenAccountException` if either ATA doesn't exist.

---

## Low-Level API (TokenInstruction)

Use these when building custom transactions or composing multiple
instructions. Each factory returns an `Instruction` for use in `Message`.

### Instruction Reference

| Factory | Purpose |
|---------|---------|
| `TokenInstruction.initializeMint(...)` | Initialize a new mint |
| `TokenInstruction.initializeMint2(...)` | Same, no Rent sysvar needed |
| `TokenInstruction.initializeAccount(...)` | Initialize a token account |
| `TokenInstruction.initializeAccount2(...)` | Owner via data, not accounts |
| `TokenInstruction.initializeAccount3(...)` | No Rent sysvar needed |
| `TokenInstruction.initializeMultisig(...)` | Initialize multisig account |
| `TokenInstruction.initializeMultisig2(...)` | No Rent sysvar needed |
| `TokenInstruction.transfer(...)` | Transfer tokens |
| `TokenInstruction.transferChecked(...)` | Transfer with decimal validation |
| `TokenInstruction.approve(...)` | Approve delegate |
| `TokenInstruction.approveChecked(...)` | Approve with decimal validation |
| `TokenInstruction.revoke(...)` | Revoke delegate |
| `TokenInstruction.setAuthority(...)` | Change mint/freeze/close authority |
| `TokenInstruction.mintTo(...)` | Mint tokens |
| `TokenInstruction.mintToChecked(...)` | Mint with decimal validation |
| `TokenInstruction.burn(...)` | Burn tokens |
| `TokenInstruction.burnChecked(...)` | Burn with decimal validation |
| `TokenInstruction.closeAccount(...)` | Close account, reclaim SOL |
| `TokenInstruction.freezeAccount(...)` | Freeze an account |
| `TokenInstruction.thawAccount(...)` | Thaw a frozen account |
| `TokenInstruction.syncNative(...)` | Sync wrapped SOL balance |
| `TokenInstruction.getAccountDataSize(...)` | Query account data size |

### Composite Helpers

```dart
// Create account + initialize mint in one transaction
final instructions = TokenInstruction.createAccountAndInitializeMint(
  mint: mintKeypair.publicKey,
  mintAuthority: authority.publicKey,
  rent: rentLamports,
  space: TokenProgram.neededMintAccountSpace,
  decimals: 6,
  freezeAuthority: freezePubKey,
);

// Create account + initialize token account in one transaction
final instructions = TokenInstruction.createAndInitializeAccount(
  mint: mintPubKey,
  address: accountKeypair.publicKey,
  owner: ownerPubKey,
  rent: rentLamports,
  space: TokenProgram.neededAccountSpace,
);

final message = Message(instructions: instructions);
```

### Authority Management

```dart
// Transfer mint authority
final ix = TokenInstruction.setAuthority(
  mintOrAccount: mintPubKey,
  currentAuthority: currentAuthority.publicKey,
  authorityType: AuthorityType.mintTokens,
  newAuthority: newAuthorityPubKey,  // null = revoke permanently
);

// AuthorityType variants:
// AuthorityType.mintTokens      — mint new tokens
// AuthorityType.freezeAccount   — freeze/thaw accounts
// AuthorityType.accountOwner    — change account owner
// AuthorityType.closeAccount    — close the account
```

---

## Token-2022 Extensions

Token-2022 extends the original Token Program with extensions. The
`Token2022Program` class provides instruction indexes:

```dart
Token2022Program.initializeMintCloseAuthorityInstructionIndex;
Token2022Program.transferFeeExtensionInstructionIndex;
Token2022Program.confidentialTransferExtensionInstructionIndex;
Token2022Program.defaultAccountStateExtensionInstructionIndex;
Token2022Program.memoTransferExtensionInstructionIndex;
Token2022Program.initializeNonTransferableMintInstructionIndex;
Token2022Program.interestBearingMintExtensionInstructionIndex;
Token2022Program.cpiGuardExtensionInstructionIndex;
Token2022Program.initializePermanentDelegateInstructionIndex;
Token2022Program.transferHookExtensionInstructionIndex;
Token2022Program.metadataPointerExtensionInstructionIndex;
// ...and more
```

**ExtensionType enum** — all supported extension types:

| Extension | Value | Purpose |
|-----------|-------|---------|
| `transferFeeConfig` | 1 | Automatic transfer fees |
| `mintCloseAuthority` | 3 | Allow mint account to be closed |
| `defaultAccountState` | 6 | Accounts start frozen |
| `immutableOwner` | 7 | Account owner cannot change |
| `memoTransfer` | 8 | Require memo on transfers |
| `nonTransferable` | 9 | Soulbound tokens |
| `interestBearingConfig` | 10 | Interest accrual |
| `permanentDelegate` | 12 | Permanent delegate authority |
| `transferHook` | 14 | Custom transfer logic |
| `metadataPointer` | 18 | Pointer to metadata account |
| `tokenMetadata` | 19 | On-chain metadata |

Use `TokenProgramType.token2022Program` when working with Token-2022 mints:

```dart
await client.createAssociatedTokenAccount(
  mint: token2022Mint,
  funder: wallet,
  tokenProgramType: TokenProgramType.token2022Program,
);
```

---

## RPC Token Queries

The `RpcClient` provides direct token query methods:

```dart
// All token accounts owned by a wallet
final accounts = await rpcClient.getTokenAccountsByOwner(
  walletAddress,
  TokenAccountsFilter.byMint(mintAddress),
  encoding: Encoding.jsonParsed,
);

// Parsed token account data
final info = accounts.first.account.data as ParsedSplTokenProgramAccountData;
final tokenInfo = info.parsed.info;
// tokenInfo.tokenAmount.amount    — raw amount string
// tokenInfo.tokenAmount.decimals  — decimal places
// tokenInfo.mint                  — mint address
// tokenInfo.owner                 — owner address
// tokenInfo.state                 — 'initialized', 'frozen', etc.
```

---

## Patterns & Recipes

### Create ATA If Missing, Then Transfer

```dart
Future<void> safeTransfer({
  required SolanaClient client,
  required Ed25519HDPublicKey mint,
  required Ed25519HDPublicKey recipient,
  required Wallet sender,
  required int amount,
}) async {
  // Ensure recipient has an ATA
  final hasAta = await client.hasAssociatedTokenAccount(
    owner: recipient,
    mint: mint,
  );
  if (!hasAta) {
    await client.createAssociatedTokenAccount(
      mint: mint,
      funder: sender,
      owner: recipient,
    );
  }

  await client.transferSplToken(
    mint: mint,
    destination: recipient,
    amount: amount,
    owner: sender,
  );
}
```

### Close Empty Token Account (Reclaim Rent)

```dart
final ix = TokenInstruction.closeAccount(
  accountToClose: emptyAtaPubKey,
  destination: walletPubKey,       // SOL goes here
  owner: walletPubKey,
);
final message = Message.only(ix);
await client.sendAndConfirmTransaction(
  message: message,
  signers: [wallet],
  onSigned: ignoreOnSigned,
);
```

### Wrapped SOL

```dart
// Native SOL mint
const nativeMint = 'So11111111111111111111111111111111111111112';

// After transferring SOL to a wrapped SOL account, sync the balance:
final ix = TokenInstruction.syncNative(
  nativeTokenAccount: wrappedSolAtaPubKey,
);
```

---

## Common Mistakes

| # | Mistake | Fix |
|---|---------|-----|
| 1 | Passing `amount` in token units instead of smallest unit | Multiply by `10^decimals` — for 6-decimal USDC, 1 USDC = `1000000` |
| 2 | Passing the ATA address as `destination` in `transferSplToken` | Pass the **owner wallet address** — the method resolves ATAs internally |
| 3 | Calling `mintTo` before creating the destination token account | Create ATA with `createAssociatedTokenAccount` first |
| 4 | Not checking if ATA exists before transfer — gets `NoAssociatedTokenAccountException` | Call `hasAssociatedTokenAccount` first, create if missing |
| 5 | Using `TokenProgramType.tokenProgram` for a Token-2022 mint | Check the mint's owning program and pass the correct `TokenProgramType` |
| 6 | Ignoring `TokenAccountNotFoundException` from `getMint` | Wrap in try/catch — the mint may not exist yet or address is wrong |
| 7 | Burning native SOL tokens — not supported | Use `closeAccount` instead to reclaim SOL from wrapped SOL accounts |
| 8 | Not reclaiming rent from empty token accounts | Call `closeAccount` on zero-balance ATAs to recover ~0.002 SOL each |

---

## Related

- [solana-core.md](solana-core.md) — RPC client, transaction signing, system instructions
- [borsh.md](borsh.md) — binary serialization used by token account data parsing
- [transaction-building.md](transaction-building.md) — composing multi-instruction transactions
- [coral-xyz.md](coral-xyz.md) — Anchor programs that interact with SPL tokens
