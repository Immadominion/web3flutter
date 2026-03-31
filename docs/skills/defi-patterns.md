# DeFi Patterns — Swaps, Staking & Liquidity in Flutter

> Integrate decentralized finance operations into Flutter apps on Solana.

## Overview

DeFi on Solana moves fast. This guide covers the patterns for integrating the most common DeFi operations: token swaps, staking, and liquidity provision. Most DeFi protocols provide APIs or SDKs, but from Flutter you'll often interact through their program instructions directly or via aggregator APIs.

## Token Swaps

### Using Jupiter Aggregator API

Jupiter is Solana's dominant swap aggregator. Using their API is the recommended approach rather than integrating individual DEXs:

```dart
// 1. Get a swap quote
final quoteResponse = await http.get(
  Uri.parse('https://quote-api.jup.ag/v6/quote'
    '?inputMint=So11111111111111111111111111111111111111112'  // wSOL
    '&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC
    '&amount=1000000000'  // 1 SOL in lamports
    '&slippageBps=50'     // 0.5% slippage tolerance
  ),
);

final quote = jsonDecode(quoteResponse.body);
print('You get: ${quote['outAmount']} USDC (raw)');
print('Price impact: ${quote['priceImpactPct']}%');

// 2. Get the swap transaction
final swapResponse = await http.post(
  Uri.parse('https://quote-api.jup.ag/v6/swap'),
  headers: {'Content-Type': 'application/json'},
  body: jsonEncode({
    'quoteResponse': quote,
    'userPublicKey': wallet.publicKey.toBase58(),
    'wrapAndUnwrapSol': true,
  }),
);

final swapData = jsonDecode(swapResponse.body);
final transactionBytes = base64Decode(swapData['swapTransaction']);

// 3. Sign and send
// The transaction is already built — just sign it
// ... deserialize, sign with wallet, send
```

> **WHY THIS MATTERS**: Jupiter aggregates 20+ DEXs and finds the best route. Building direct DEX integration is significantly more work for worse prices. Always use an aggregator unless you have a specific reason not to.

### Slippage Protection

```dart
// Calculate acceptable output based on slippage
int calculateMinOutput(int expectedOutput, int slippageBps) {
  // slippageBps: 50 = 0.5%, 100 = 1%, 300 = 3%
  return expectedOutput * (10000 - slippageBps) ~/ 10000;
}

// ALWAYS show the user:
// 1. Expected output
// 2. Minimum output (after slippage)
// 3. Price impact percentage
// 4. Route (which DEXs are being used)
```

## SOL Staking

### Native Staking

```dart
// Create a stake account
final stakeAccount = await Ed25519HDKeyPair.random();

final createStakeAccountIx = StakeInstruction.createAccount(
  fromPubkey: wallet.publicKey,
  stakePubkey: stakeAccount.publicKey,
  authorized: Authorized(
    staker: wallet.publicKey,
    withdrawer: wallet.publicKey,
  ),
  lamports: 2000000000, // 2 SOL to stake
);

// Delegate to a validator
final delegateIx = StakeInstruction.delegate(
  stakePubkey: stakeAccount.publicKey,
  authorizedPubkey: wallet.publicKey,
  votePubkey: validatorVoteAccount, // Choose a validator
);

// Both in one transaction
final message = Message(instructions: [createStakeAccountIx, delegateIx]);
await client.signAndSendTransaction(message, [wallet, stakeAccount]);
```

### Liquid Staking (Marinade, Jito, etc.)

```dart
// Liquid staking gives you a receipt token (mSOL, jitoSOL, etc.)
// that earns staking rewards while remaining liquid

// Example: Marinade stake SOL → receive mSOL
// Use Marinade's program instruction or their API
// The receipt token auto-appreciates relative to SOL
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| No slippage protection | Thinking quoted price is guaranteed | Always set `slippageBps` and show min output to user |
| Stale quotes | Using old quote for swap | Re-quote immediately before sending; quotes expire (~30s) |
| Not wrapping SOL | DEXs work with wrapped SOL (wSOL) | Use Jupiter's `wrapAndUnwrapSol: true` or handle manually |
| Ignoring priority fees | Transactions competing for block space | Include priority fee instructions during high-demand periods |
| Staking below minimum | Some validators have minimums | Check minimum delegation (usually 1 SOL for native staking) |

## Related

- [Solana Package Deep Dive](./solana-package.md) — Transaction building
- [Token Operations](./token-ops.md) — Understanding token accounts for swap outputs

---

*Jupiter: [jup.ag](https://jup.ag) — Marinade: [marinade.finance](https://marinade.finance)*
