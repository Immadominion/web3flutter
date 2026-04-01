# SPL Tokens — Mints, ATAs, and the Full Instruction Set

> The `solana` package's built-in token layer: 25 Token Program instructions, Token-2022 extensions (indices 25–41), ATA derivation, `SolanaClient` extension methods, and the account-per-token model that makes all of it necessary.

## Overview

On Ethereum, a token is a contract with a `mapping(address => uint256)`. On Solana, **your wallet doesn't hold tokens**. Instead:

- The **Token Program** owns Token Accounts
- Your wallet is the *authority* over those Token Accounts
- Each Token Account holds a balance for exactly one mint

```
Your Wallet (System-owned, holds SOL)
  │
  ├── authority → ATA for USDC (Token Program-owned) → 100 USDC
  ├── authority → ATA for RAY  (Token Program-owned) → 50 RAY
  └── authority → ATA for NFT  (Token Program-owned) → 1 NFT
```

This parallelizes: multiple token transfers execute simultaneously without contending on the same storage slot.

The `solana` package provides three layers:

1. **Low-level**: `TokenInstruction` factory methods (indices 0–24, plus 25–41 for Token-2022)
2. **Mid-level**: `AssociatedTokenAccountInstruction` and helpers like `findAssociatedTokenAddress`
3. **High-level**: `SolanaClient` extensions (`transferSplToken`, `createAssociatedTokenAccount`, `getMint`, etc.)

---

## Quick Start

```dart
import 'package:solana/solana.dart';

final client = SolanaClient(
  rpcUrl: Uri.parse('https://api.devnet.solana.com'),
  websocketUrl: Uri.parse('wss://api.devnet.solana.com'),
);

// Create a new token mint (9 decimals, like SOL)
final mint = await client.initializeMint(
  mintAuthority: authority,
  decimals: 9,
);

// Create the recipient's ATA
final ata = await client.createAssociatedTokenAccount(
  mint: mint.address,
  funder: authority,
);

// Mint tokens to the ATA
await client.mintTo(
  mint: mint.address,
  destination: Ed25519HDPublicKey.fromBase58(ata.pubkey),
  amount: 1000000000, // 1 token (9 decimals)
  authority: authority,
);

// Transfer tokens
await client.transferSplToken(
  mint: mint.address,
  destination: recipientWallet, // wallet pubkey, NOT the ATA
  amount: 500000000,            // 0.5 tokens
  owner: authority,
);
```

---

## Core Concepts

### Associated Token Accounts (ATAs)

For any (wallet, mint) pair, there's exactly one deterministic ATA address. The derivation:

```dart
final ata = await findAssociatedTokenAddress(
  owner: walletPubkey,
  mint: tokenMint,
  tokenProgramType: TokenProgramType.tokenProgram, // or .token2022Program
);
// Seeds: [owner_bytes, token_program_id_bytes, mint_bytes]
// Program: ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
```

Creating an ATA costs ~0.00203 SOL (rent-exempt minimum for a 165-byte token account). Someone must pay this. The instruction:

```dart
AssociatedTokenAccountInstruction.createAccount(
  funder: payer,           // pays rent
  address: derivedAta,     // the PDA
  owner: walletPubkey,     // who controls it
  mint: tokenMint,
  tokenProgramId: TokenProgram.id, // or Token2022Program.id
)
```

> **WHY THIS MATTERS**: When you send tokens to someone who's never held that token, their ATA doesn't exist yet. `transferSplToken` will throw `NoAssociatedTokenAccountException` if the recipient's ATA is missing. You must create it first (and pay the rent) — or combine both instructions in one transaction.

### SolanaClient Extension Methods

High-level flows that handle ATA lookup, instruction building, and transaction sending:

| Method | What It Does |
|--------|-------------|
| `getMint(address)` | Fetches on-chain mint data → `Mint` (supply, decimals, authorities) |
| `initializeMint(authority, decimals, ...)` | Creates new keypair + SystemProgram.createAccount + initializeMint |
| `mintTo(mint, destination, amount, authority)` | Mints tokens into a token account |
| `transferSplToken(mint, destination, amount, owner, ...)` | Resolves both ATAs → transfers (+ optional memo) |
| `hasAssociatedTokenAccount(owner, mint)` | Quick existence check |
| `getAssociatedTokenAccount(owner, mint)` | Returns `ProgramAccount?` (null if not found) |
| `createAssociatedTokenAccount(mint, funder, ...)` | Derives ATA → creates on-chain → returns `ProgramAccount` |
| `createTokenAccount(mint, account, creator)` | Creates a non-ATA token account (rare) |
| `getTokenBalance(owner, mint)` | Derives ATA → `getTokenAccountBalance` → `TokenAmount` |

`transferSplToken` especially is worth understanding. Its flow:

1. Calls `getAssociatedTokenAccount` for the sender
2. Calls `getAssociatedTokenAccount` for the recipient
3. Throws `NoAssociatedTokenAccountException` if either is missing
4. Builds `TokenInstruction.transfer(sourceAta, destAta, owner, amount)`
5. Optionally appends `MemoInstruction` if a memo string is provided
6. `sendAndConfirmTransaction` with the owner as signer

### Mint Data Model

```dart
// High-level model (from SolanaClient.getMint)
@freezed class Mint {
  Ed25519HDPublicKey address;
  BigInt supply;              // total tokens in existence
  int decimals;               // 0-9, typically 6 (USDC) or 9 (SOL-like)
  Ed25519HDPublicKey? mintAuthority;     // can mint more (null = capped supply)
  bool isInitialized;
  Ed25519HDPublicKey? freezeAuthority;   // can freeze accounts (null = unfreezing)
}

// On-chain binary layout (deserialized via Borsh)
@BorshSerializable() class RawMint {
  @BU32() int mintAuthorityOption;         // 0=None, 1=Some (NOT BOption — SPL style)
  @BPublicKey() Ed25519HDPublicKey mintAuthority;
  @BU64() BigInt supply;
  @BU8() int decimals;
  @BBool() bool isInitialized;
  @BU32() int freezeAuthorityOption;
  @BPublicKey() Ed25519HDPublicKey freezeAuthority;
}
```

> **GOTCHA**: `RawMint` uses `@BU32()` for the option flag, not `@BOption()`. SPL Token's on-chain layout puts a `u32` flag + full 32-byte pubkey (zeroed when None) — it doesn't use Borsh's standard `Option<T>` encoding. The `getMint()` extension method handles the translation for you.

---

### TokenInstruction — The Full Instruction Set

Every factory on `TokenInstruction` accepts an optional `TokenProgramType tokenProgram` parameter (defaults to `tokenProgram`). Pass `tokenProgram: TokenProgramType.token2022Program` for Token-2022 tokens.

#### Core Operations (indices 0–11)

```dart
// Create a mint (usually paired with SystemInstruction.createAccount)
TokenInstruction.initializeMint(
  mint: mintKeypair.publicKey, decimals: 9,
  mintAuthority: authority, freezeAuthority: freezeAuth,
);

// Create a token account
TokenInstruction.initializeAccount(
  account: accountKeypair.publicKey, mint: tokenMint, owner: walletPubkey,
);

// Transfer tokens between token accounts
TokenInstruction.transfer(
  source: senderAta, destination: receiverAta,
  amount: 1000000, owner: senderWallet,
);

// Approve a delegate to spend up to `amount`
TokenInstruction.approve(
  source: myAta, delegate: delegatePubkey,
  amount: 500000, sourceOwner: myWallet,
);

// Revoke a delegate's approval
TokenInstruction.revoke(source: myAta, sourceOwner: myWallet);

// Change an authority (mint, freeze, owner, close)
TokenInstruction.setAuthority(
  mintOrAccount: mintPubkey,
  currentAuthority: oldAuth,
  authorityType: AuthorityType.mintTokens, // .freezeAccount, .accountOwner, .closeAccount
  newAuthority: newAuth, // null = remove authority permanently
);

// Mint new tokens (only mintAuthority can do this)
TokenInstruction.mintTo(
  mint: tokenMint, destination: ata, amount: 1000000, authority: mintAuth,
);

// Burn tokens (reduces supply)
TokenInstruction.burn(
  accountToBurnFrom: myAta, mint: tokenMint, amount: 500000, owner: myWallet,
);

// Close a token account (reclaim rent SOL)
TokenInstruction.closeAccount(
  accountToClose: emptyAta, destination: myWallet, owner: myWallet,
);

// Freeze/thaw accounts (only freezeAuthority)
TokenInstruction.freezeAccount(account: ata, mint: mint, freezeAuthority: auth);
TokenInstruction.thawAccount(account: ata, mint: mint, freezeAuthority: auth);
```

#### Checked Variants (indices 12–15)

These verify the mint and decimals match expectations — safer for user-facing transfers:

```dart
TokenInstruction.transferChecked(
  source: senderAta, mint: tokenMint, destination: receiverAta,
  amount: 1000000, decimals: 9, owner: senderWallet,
);

TokenInstruction.mintToChecked(
  mint: tokenMint, destination: ata, amount: 1000000,
  decimals: 9, authority: mintAuth,
);

TokenInstruction.burnChecked(
  accountToBurnFrom: myAta, mint: tokenMint, amount: 500000,
  decimals: 9, owner: myWallet,
);

TokenInstruction.approveChecked(
  source: myAta, mint: tokenMint, delegate: delegatePubkey,
  amount: 500000, decimals: 9, sourceOwner: myWallet,
);
```

> **CRITICAL**: For Token-2022, use the checked variants. Some Token-2022 extensions (transfer fees, transfer hooks) only work with `transferChecked`, not plain `transfer`.

#### Account Init Variants (indices 16–24)

```dart
// InitializeAccount2/3 — owner in instruction data, not account list
TokenInstruction.initializeAccount2(pubKey: account, mint: mint, owner: wallet);
TokenInstruction.initializeAccount3(pubKey: account, mint: mint, owner: wallet);
// v3 doesn't require the Rent sysvar account

// InitializeMint2 — no Rent sysvar needed
TokenInstruction.initializeMint2(mint: mint, decimals: 9, mintAuthority: auth);

// SyncNative — update wrapped SOL balance after a SOL transfer
TokenInstruction.syncNative(nativeTokenAccount: wrappedSolAta);

// Utility conversions
TokenInstruction.getAccountDataSize(mint: tokenMint);
TokenInstruction.amountToUiAmount(mint: tokenMint, amount: 1000000000);
TokenInstruction.uiAmountToAmount(mint: tokenMint, amount: '1.0');
```

#### Multi-Instruction Helpers

```dart
// Create account + initialize mint in one go
final instructions = TokenInstruction.createAccountAndInitializeMint(
  mint: mintKeypair.publicKey, mintAuthority: auth,
  rent: rentExemptBalance, space: TokenProgram.neededMintAccountSpace,
  decimals: 9,
);
// Returns [SystemInstruction.createAccount, TokenInstruction.initializeMint]
```

---

### Token-2022 Extensions (indices 25–41)

```dart
// Close authority — allow closing the mint account itself
TokenInstruction.initializeMintCloseAuthority(
  mint: mint, closeAuthority: authority,
);

// Non-transferable (soulbound tokens)
TokenInstruction.initializeNonTransferableMint(mint: mint);

// Permanent delegate — a delegate that can never be revoked
TokenInstruction.initializePermanentDelegate(mint: mint, delegate: delegatePubkey);

// Reallocate — add extensions to an existing account
TokenInstruction.reallocate(
  account: ata, payer: payer, owner: owner,
  extensionTypes: [ExtensionType.memoTransfer, ExtensionType.cpiGuard],
);

// Create native mint (wrapped SOL) for Token-2022
TokenInstruction.createNativeMint(payer: payer);
```

**ExtensionType enum**: `transferFeeConfig`(1), `transferFeeAmount`(2), `mintCloseAuthority`(3), `confidentialTransferMint`(4), `defaultAccountState`(6), `immutableOwner`(7), `memoTransfer`(8), `nonTransferable`(9), `interestBearingConfig`(10), `cpiGuard`(11), `permanentDelegate`(12), `transferHook`(14), `metadataPointer`(18), `tokenMetadata`(19), `groupPointer`(20), `groupMemberPointer`(22).

---

## Patterns & Recipes

### Create ATA + Transfer in One Transaction

```dart
final recipientAta = await findAssociatedTokenAddress(
  owner: recipientWallet, mint: tokenMint,
);

final hasAta = await client.hasAssociatedTokenAccount(
  owner: recipientWallet, mint: tokenMint,
);

final instructions = <Instruction>[
  if (!hasAta)
    AssociatedTokenAccountInstruction.createAccount(
      funder: senderWallet.publicKey,
      address: recipientAta,
      owner: recipientWallet,
      mint: tokenMint,
    ),
  TokenInstruction.transfer(
    source: senderAta,
    destination: recipientAta,
    amount: amount,
    owner: senderWallet.publicKey,
  ),
];

final message = Message(instructions: instructions);
await client.sendAndConfirmTransaction(
  message: message,
  signers: [senderWallet],
  commitment: Commitment.confirmed,
);
```

### Close Empty Token Accounts (Reclaim Rent)

```dart
final tokenAccounts = await client.rpcClient.getTokenAccountsByOwner(
  walletPubkey.toBase58(),
  filter: TokenAccountsFilter.byProgramId(TokenProgram.programId),
);

for (final account in tokenAccounts.value) {
  final info = account.account.data as SplTokenProgramAccountData;
  final tokenInfo = (info as TokenAccountData).parsed.info;
  if (tokenInfo.tokenAmount.amount == '0') {
    // Account is empty — close it to reclaim rent
    final message = Message(instructions: [
      TokenInstruction.closeAccount(
        accountToClose: Ed25519HDPublicKey.fromBase58(account.pubkey),
        destination: walletPubkey,
        owner: walletPubkey,
      ),
    ]);
    await client.sendAndConfirmTransaction(
      message: message,
      signers: [wallet],
      commitment: Commitment.confirmed,
    );
  }
}
```

---

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| `NoAssociatedTokenAccountException` | Recipient never held this token — ATA doesn't exist | Create the ATA first (you pay ~0.00203 SOL rent) |
| Tokens sent to wallet address instead of ATA | Passed wallet pubkey as destination to `TokenInstruction.transfer` | Derive the ATA with `findAssociatedTokenAddress` first |
| Wrong program ID for Token-2022 | Used `TokenProgram.id` for a Token-2022 mint | Check which program owns the mint, pass correct `TokenProgramType` |
| `transferChecked` decimal mismatch | Passed wrong decimals (e.g., 9 for a 6-decimal USDC) | Fetch mint data first with `getMint()` to read actual decimals |
| Amount off by factor of 10^N | Used human amount instead of raw amount | Raw amount = `humanAmount * 10^decimals` (e.g., 1 USDC = 1000000) |
| Closing account with balance | Tried `closeAccount` on non-zero balance | Transfer or burn remaining tokens first |
| Mint authority removed permanently | Called `setAuthority(newAuthority: null)` on mintTokens | This is irreversible — supply is permanently capped |

---

## API Quick Reference

| Type | Purpose |
|------|---------|
| `TokenProgram.id` | SPL Token program (`Tokenkeg...`) — 82-byte mints, 165-byte accounts |
| `Token2022Program.id` | Token Extensions program (`Tokenz...`) — variable-size accounts |
| `AssociatedTokenAccountProgram.id` | ATA derivation and creation |
| `TokenInstruction` | 25 factory methods (indices 0–24) + 5 Token-2022 (25–41) |
| `AssociatedTokenAccountInstruction` | Create ATA instruction |
| `findAssociatedTokenAddress` | Derive the deterministic ATA PDA |
| `AuthorityType` | Enum: `mintTokens`, `freezeAccount`, `accountOwner`, `closeAccount` |
| `ExtensionType` | Enum: 22 Token-2022 extension identifiers |
| `Mint` | High-level mint model (address, supply, decimals, authorities) |
| `RawMint` | Borsh-serialized on-chain mint layout |
| `TokenAmount` | Parsed balance: amount string + decimals + UI string |

---

## Related

- [The solana Package](solana-package) — Core SDK, `SolanaClient`, `RpcClient`
- [Borsh Serialization](borsh) — How `RawMint` is deserialized from on-chain bytes
- [DeFi Patterns](defi-patterns) — Token swaps via Jupiter
- [NFT Development](nft-dev) — NFTs are tokens with supply=1
