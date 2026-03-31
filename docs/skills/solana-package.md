# Solana Package — Deep Dive

> The foundational SDK for every Solana Flutter application. Handles keypairs, transactions, RPC communication, and program interaction.

## Overview

The `solana` package (published by the Espresso Cash team) is the most complete Dart SDK for Solana. It provides:

- Ed25519 keypair generation and management
- Transaction building, signing, and sending
- Full JSON-RPC client for all Solana RPC methods
- System Program instruction helpers
- SPL Token program support
- Memo program support
- BIP39 mnemonic derivation

If you're building anything on Solana with Flutter, this package is non-negotiable. Everything else builds on top of it.

## Quick Start

```yaml
# pubspec.yaml
dependencies:
  solana: ^0.31.0
```

```dart
import 'package:solana/solana.dart';

Future<void> main() async {
  // Connect to devnet
  final client = RpcClient('https://api.devnet.solana.com');
  
  // Create a wallet
  final wallet = await Ed25519HDKeyPair.random();
  
  // Airdrop 1 SOL (devnet only)
  await client.requestAirdrop(
    wallet.publicKey.toBase58(),
    lamportsPerSol,
  );
  
  // Check balance
  final balance = await client.getBalance(wallet.publicKey.toBase58());
  print('Balance: ${balance.value / lamportsPerSol} SOL');
}
```

## Core Concepts

### The RPC Client

The `RpcClient` is your connection to a Solana validator node. Every on-chain read or write goes through it.

```dart
// Development
final devnet = RpcClient('https://api.devnet.solana.com');

// Production — use a dedicated provider
final mainnet = RpcClient(
  'https://your-provider.com/api-key',
);

// With custom timeout
final client = RpcClient(
  'https://api.devnet.solana.com',
  timeout: const Duration(seconds: 30),
);
```

> **CRITICAL**: Public RPC endpoints (`api.mainnet-beta.solana.com`) have aggressive rate limits — 40 requests per 10 seconds. Production apps MUST use a dedicated provider (Helius, QuickNode, Triton, Alchemy). Your app will break in production without this.

### Keypairs and Wallets

Solana uses Ed25519 cryptography. A keypair is both your identity (public key) and your signing authority (private key).

```dart
// Generate random keypair
final wallet = await Ed25519HDKeyPair.random();

// From 12 or 24 word mnemonic (BIP39)
final wallet = await Ed25519HDKeyPair.fromMnemonic(
  'abandon abandon abandon ...',
  account: 0,  // Derivation path account index
  change: 0,   // Derivation path change index
);

// From seed bytes (advanced)
final wallet = await Ed25519HDKeyPair.fromSeedWithHdPath(
  seed: seedBytes,
  hdPath: "m/44'/501'/0'/0'",
);
```

> **WHY THIS MATTERS**: The derivation path `m/44'/501'/0'/0'` is Solana's standard (BIP44 with coin type 501). If a user imports their Phantom/Solflare mnemonic, you MUST use this path or you'll derive a different address. This is the #1 support ticket for wallet apps.

### Building Transactions

A transaction in Solana is a `Message` containing one or more `Instruction`s, signed by required parties.

```dart
// Simple SOL transfer
final instruction = SystemInstruction.transfer(
  fundingAccount: sender.publicKey,
  recipientAccount: Ed25519HDPublicKey.fromBase58(
    'RecipientAddressBase58...',
  ),
  lamports: 500000000, // 0.5 SOL
);

final message = Message(instructions: [instruction]);

// Sign and send in one call
final signature = await client.signAndSendTransaction(
  message,
  [sender], // All required signers
);

print('Transaction: $signature');
// Use on Solana Explorer: https://explorer.solana.com/tx/$signature?cluster=devnet
```

### Multi-Instruction Transactions

One of Solana's superpowers: multiple instructions in a single atomic transaction.

```dart
// Create token account + transfer tokens + add memo — all in one tx
final instructions = [
  AssociatedTokenAccountInstruction.createAccount(
    funder: wallet.publicKey,
    address: associatedTokenAddress,
    owner: recipientPublicKey,
    mint: tokenMintAddress,
  ),
  TokenInstruction.transfer(
    source: senderTokenAccount,
    destination: associatedTokenAddress,
    owner: wallet.publicKey,
    amount: 1000000, // Token amount in smallest unit
  ),
  MemoInstruction(
    signers: [wallet.publicKey],
    memo: 'Payment for services',
  ),
];

final message = Message(instructions: instructions);
final signature = await client.signAndSendTransaction(message, [wallet]);
```

> **WHY THIS MATTERS**: This atomicity is unique to Solana. If ANY instruction fails, the ENTIRE transaction reverts. Use this to your advantage — you never end up in half-complete states.

### Program Derived Addresses (PDAs)

PDAs are deterministic addresses derived from seeds + a program ID. They're how programs "own" accounts.

```dart
final programId = Ed25519HDPublicKey.fromBase58('YourProgramIdHere...');

// Simple PDA
final pda = await Ed25519HDPublicKey.findProgramAddress(
  seeds: [
    'config'.codeUnits,  // Static string seed
  ],
  programId: programId,
);

// PDA with user-specific seeds
final userVault = await Ed25519HDPublicKey.findProgramAddress(
  seeds: [
    'vault'.codeUnits,
    userPublicKey.bytes,  // 32-byte public key
  ],
  programId: programId,
);

// Access the address and bump
final vaultAddress = userVault.key;  // Ed25519HDPublicKey
final bump = userVault.bump;          // int (0-255)
```

> **GOTCHA**: PDA derivation is deterministic — same seeds + same program ID ALWAYS produces the same address. But if your Dart code uses a different program ID than what's deployed on-chain (common when `declare_id!()` in Rust doesn't match the deploy keypair), you'll get `InvalidPDA` errors. Always verify the program ID matches the deploy keypair.

### Account Data — Reading On-Chain State

```dart
final accountInfo = await client.getAccountInfo(
  pdaAddress.toBase58(),
  encoding: Encoding.base64,
);

if (accountInfo == null) {
  print('Account does not exist yet');
  return;
}

// accountInfo.owner — which program owns this account
// accountInfo.lamports — SOL balance
// accountInfo.data — the actual data bytes (base64 encoded)

final dataBytes = base64Decode(accountInfo.data as String);
// Now decode with dartus/borsh based on your program's schema
```

### WebSocket Subscriptions

For real-time updates instead of polling:

```dart
final subscriptionClient = SubscriptionClient(
  'wss://api.devnet.solana.com',
);

// Watch an account for changes
final subscription = subscriptionClient.accountSubscribe(
  accountAddress.toBase58(),
  encoding: Encoding.base64,
  commitment: Commitment.confirmed,
);

subscription.listen((event) {
  print('Account changed! New data: ${event.data}');
  // Update your UI
});

// Don't forget to cancel when done
subscription.cancel();
```

## Patterns & Recipes

### Retry with Fresh Blockhash

```dart
Future<String> sendWithRetry(
  Message message,
  List<Ed25519HDKeyPair> signers, {
  int maxRetries = 3,
}) async {
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await client.signAndSendTransaction(message, signers);
    } on RpcException catch (e) {
      if (e.message.contains('Blockhash') && attempt < maxRetries - 1) {
        await Future.delayed(Duration(milliseconds: 500));
        continue; // Will get fresh blockhash on next attempt
      }
      rethrow;
    }
  }
  throw Exception('Transaction failed after $maxRetries attempts');
}
```

### Balance Watcher Provider (Riverpod)

```dart
final balanceProvider = StreamProvider.family<int, String>((ref, address) async* {
  final client = ref.read(rpcClientProvider);
  
  while (true) {
    final balance = await client.getBalance(address);
    yield balance.value;
    await Future.delayed(const Duration(seconds: 10));
  }
});

// In your widget
final balance = ref.watch(balanceProvider(walletAddress));
balance.when(
  data: (lamports) => Text('${lamports / lamportsPerSol} SOL'),
  loading: () => CircularProgressIndicator(),
  error: (e, _) => Text('Error loading balance'),
);
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Using public RPC in production | Works fine in dev | Get a dedicated RPC endpoint from Helius/QuickNode/Triton |
| Hardcoding program IDs from Rust source | `declare_id!()` is often a placeholder | Use the pubkey from `target/deploy/<name>-keypair.json` |
| Forgetting rent exemption | Accounts need minimum SOL | Calculate rent with `getMinimumBalanceForRentExemption` |
| Not handling `null` from `getAccountInfo` | Account may not exist yet | Always null-check before decoding data |
| Using `processed` commitment for balances | Shows unconfirmed data | Use `confirmed` for UI, `finalized` for critical ops |
| Deriving PDA with wrong seed encoding | Strings vs bytes confusion | `'seed'.codeUnits` for strings, `.bytes` for pubkeys |

## Related

- [Dartus Borsh Serialization](./dartus-borsh.md) — Decoding the account data you read
- [Coral/Anchor Integration](./coral-anchor.md) — Higher-level Anchor program interaction
- [Solana Mobile Stack](./solana-mobile.md) — Hardware wallet signing on mobile
- [Token Operations](./token-ops.md) — SPL token specifics

---

*Package: [solana on pub.dev](https://pub.dev/packages/solana) — Source: [GitHub](https://github.com/espresso-cash/espresso-cash-public)*
