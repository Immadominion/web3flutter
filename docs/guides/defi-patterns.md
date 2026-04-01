# DeFi Integration — Jupiter Swaps, Staking, and Price Feeds

> The `jupiter_aggregator` package for token swaps, the `solana` package's `StakeProgram` for native staking, and the patterns for building DeFi flows in Flutter.

## Overview

Solana has 20+ DEXs (Raydium, Orca, Meteora, Phoenix, etc.). Building direct integrations with each is a maintenance nightmare. Jupiter aggregates all of them — you give it an input and output token, it finds the best route (possibly splitting across multiple DEXs), and returns a pre-built transaction.

The `jupiter_aggregator` package (v0.0.5, internal) is a Retrofit/Dio client for Jupiter's v6 API. Two clients:

- `JupiterAggregatorClient` — token swaps (quote + execute)
- `JupiterPriceClient` — real-time USD prices

For staking, the `solana` package includes `StakeProgram` with 13 instruction types covering the full lifecycle: initialize, delegate, split, merge, withdraw, deactivate, and authority management.

---

## Quick Start — Token Swap

```dart
import 'package:jupiter_aggregator/jupiter_aggregator.dart';
import 'package:solana/solana.dart';

final jupiter = JupiterAggregatorClient();

// 1. Get a quote (SOL → USDC)
final quote = await jupiter.getQuote(
  QuoteRequestDto(
    inputMint: 'So11111111111111111111111111111111111111112',   // Wrapped SOL
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    amount: 1000000000,  // 1 SOL in lamports
    slippageBps: 50,     // 0.5% slippage tolerance
  ),
);

print('Output: ${quote.outAmount} USDC base units');
print('Price impact: ${quote.priceImpactPct}%');
print('Route: ${quote.routePlan.map((r) => r.swapInfo.label).join(' → ')}');

// 2. Get the swap transaction
final swapResponse = await jupiter.getSwapTransactions(
  JupiterSwapRequestDto(
    userPublicKey: wallet.publicKey.toBase58(),
    quoteResponse: quote,
    computeUnitPriceMicroLamports: 50000, // priority fee
  ),
);

// 3. Decode, sign, and send
final txBytes = base64Decode(swapResponse.swapTransaction);
// The swapTransaction is a fully constructed, unsigned transaction
// Sign it and send via your SolanaClient
```

---

## Core Concepts

### JupiterAggregatorClient

Base URL: `https://quote-api.jup.ag/v6` (overridable). Accepts an optional `apiKey` for higher rate limits (injected as `x-api-key` header).

Two methods:

| Method | HTTP | Purpose |
|--------|------|---------|
| `getQuote(QuoteRequestDto)` | GET `/quote` | Find the best swap route |
| `getSwapTransactions(JupiterSwapRequestDto)` | POST `/swap` | Get a serialized transaction to sign |

### QuoteRequestDto — The Full Parameter Set

```dart
QuoteRequestDto(
  inputMint: 'So111...',         // REQUIRED — input token mint
  outputMint: 'EPjFW...',       // REQUIRED — output token mint
  amount: 1000000000,           // REQUIRED — in smallest unit (lamports for SOL)
  slippageBps: 50,              // 0.5% — 1 bps = 0.01%
  swapMode: SwapMode.exactIn,   // or SwapMode.exactOut
  onlyDirectRoutes: false,       // true = single-hop only (less optimal but simpler)
  asLegacyTransaction: false,   // true = legacy format (no v0 lookup tables)
  maxAccounts: null,            // limit accounts in tx (for tight budgets)
  dexes: null,                  // whitelist: ['Raydium', 'Orca']
  excludeDexes: null,           // blacklist: ['Mercurial']
  platformFeeBps: null,         // your platform's fee (added to swap)
  autoSlippage: false,          // Jupiter calculates optimal slippage
  maxAutoSlippageBps: null,     // cap on auto-slippage
  restrictIntermediateTokens: false, // only use major tokens as intermediaries
)
```

> **WHY THIS MATTERS**: `SwapMode.exactIn` means "I want to give exactly this amount and get at least X back." `SwapMode.exactOut` means "I want to receive exactly this amount and give at most Y." Most apps use `exactIn`. `exactOut` is for "I need exactly 100 USDC" scenarios — it's less commonly supported across DEXs.

### QuoteResponseDto — Understanding the Response

```dart
final quote = await jupiter.getQuote(request);

quote.inputMint;           // mint address
quote.inAmount;            // "1000000000" (string)
quote.outputMint;
quote.outAmount;           // "142500000" — best-case output
quote.otherAmountThreshold; // "141787500" — minimum output after slippage
quote.slippageBps;         // 50
quote.priceImpactPct;      // "0.12" — percentage
quote.routePlan;           // List<RoutePlan> — the route steps

// Route breakdown
for (final step in quote.routePlan) {
  step.percent;              // 100 (or split: 60/40, etc.)
  step.swapInfo.label;       // "Raydium", "Orca", etc.
  step.swapInfo.ammKey;      // pool address
  step.swapInfo.inputMint;   // step's input
  step.swapInfo.outputMint;  // step's output
  step.swapInfo.inAmount;    // amount entering this step
  step.swapInfo.outAmount;   // amount leaving this step
  step.swapInfo.feeAmount;   // DEX fee for this step
  step.swapInfo.feeMint;     // which token the fee is in
}
```

### JupiterSwapRequestDto — Building the Transaction

```dart
JupiterSwapRequestDto(
  userPublicKey: wallet.publicKey.toBase58(),  // REQUIRED
  quoteResponse: quote,                         // REQUIRED — the entire quote object
  wrapAndUnwrapSol: true,     // auto-wrap SOL → wSOL and unwrap back
  useSharedAccounts: true,     // use Jupiter's shared ATA (saves rent)
  feeAccount: null,           // your fee collection token account
  computeUnitPriceMicroLamports: 50000,  // priority fee
  asLegacyTransaction: false,
  destinationTokenAccount: null, // custom destination ATA (rare)
  dynamicComputeUnitLimit: true, // Jupiter optimizes the CU limit
  dynamicSlippage: DynamicSlippage(minBps: 10, maxBps: 300), // Jupiter adjusts
)
```

### JupiterSwapResponseDto

```dart
swapResponse.swapTransaction;          // base64-encoded serialized transaction
swapResponse.lastValidBlockHeight;      // block height deadline
swapResponse.prioritizationFeeLamports; // actual priority fee
swapResponse.dynamicSlippageReport;     // if dynamicSlippage was used
```

The `swapTransaction` is a complete, unsigned transaction. Decode it from base64, sign with the user's key, and submit.

### JupiterPriceClient — Token Prices

```dart
final priceClient = JupiterPriceClient();

final response = await priceClient.getPrice(
  PriceRequestDto(ids: [
    'So11111111111111111111111111111111111111112',   // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  ]),
);

final solPrice = response.data['So11111111111111111111111111111111111111112'];
print('SOL: \$${solPrice?.price}');  // e.g., "142.50"
```

Base URL: `https://api.jup.ag/price/v2`. Returns USD prices keyed by mint address.

---

### Native Staking — StakeProgram

The `solana` package includes `StakeProgram` for Solana's native proof-of-stake:

```dart
// Create and initialize a stake account
final stakeKeypair = await Ed25519HDKeyPair.random();
final instructions = StakeInstruction.createAndInitializeAccount(
  fundingAccount: wallet.publicKey,
  newAccount: stakeKeypair.publicKey,
  authorized: Authorized(
    staker: StakeAuthorize.staker(wallet.publicKey),
    withdrawer: StakeAuthorize.withdrawer(wallet.publicKey),
  ),
  lamports: 2000000000, // 2 SOL to stake
);

// Delegate to a validator
final delegateIx = StakeInstruction.delegateStake(
  stake: stakeKeypair.publicKey,
  vote: validatorVoteAccount,
  config: StakeConfigId.id,
  authority: wallet.publicKey,
);

// Deactivate (begins the cooldown — takes 2-3 epochs / 5-6 days)
StakeInstruction.deactivate(
  stake: stakeKeypair.publicKey,
  authority: wallet.publicKey,
);

// Withdraw (after cooldown completes)
StakeInstruction.withdraw(
  stake: stakeKeypair.publicKey,
  recipient: wallet.publicKey,
  authority: wallet.publicKey,
  lamports: 2000000000,
);
```

**Full instruction set**: `initialize`, `authorize`, `delegateStake`, `split`, `withdraw`, `deactivate`, `setLockup`, `merge`, `authorizeWithSeed`, `initializeChecked`, `authorizeChecked`, `authorizeCheckedWithSeed`, `setLockupChecked`.

Stake authority types:

- `StakeAuthorize.staker(pubkey)` — can delegate and deactivate
- `StakeAuthorize.withdrawer(pubkey)` — can withdraw and change authorities

Account space: 200 bytes (120 Meta + 72 Stake + padding).

> **GOTCHA**: Native staking takes 2-3 epochs (~5-6 days) to unstake. For better UX, consider liquid staking protocols (Marinade, Jito, Sanctum) — users deposit SOL, receive a receipt token (mSOL, jitoSOL), and can trade immediately without waiting for the unstaking cooldown.

---

## Patterns & Recipes

### Complete Swap Flow with UI Feedback

```dart
Future<String> executeSwap({
  required Ed25519HDKeyPair wallet,
  required SolanaClient solanaClient,
  required String inputMint,
  required String outputMint,
  required int amount,
  required int slippageBps,
  required void Function(String status) onStatus,
}) async {
  onStatus('Finding best route...');
  final jupiter = JupiterAggregatorClient();

  final quote = await jupiter.getQuote(
    QuoteRequestDto(
      inputMint: inputMint,
      outputMint: outputMint,
      amount: amount,
      slippageBps: slippageBps,
    ),
  );

  onStatus('Building transaction...');
  final swap = await jupiter.getSwapTransactions(
    JupiterSwapRequestDto(
      userPublicKey: wallet.publicKey.toBase58(),
      quoteResponse: quote,
      dynamicComputeUnitLimit: true,
    ),
  );

  onStatus('Signing...');
  final txBytes = base64Decode(swap.swapTransaction);
  // Sign the decoded transaction bytes with your wallet
  // Then submit via solanaClient.rpcClient.sendTransaction(...)

  onStatus('Confirming...');
  // Wait for confirmation

  return 'done';
}
```

### Slippage Guidelines

| Market Condition | Recommended Slippage | Notes |
|-----------------|---------------------|------|
| Stable pairs (USDC/USDT) | 5–10 bps (0.05–0.1%) | Very tight — these rarely move |
| Major pairs (SOL/USDC) | 50 bps (0.5%) | Standard default |
| Volatile / low liquidity | 100–300 bps (1–3%) | Higher to avoid failures |
| MEV-sensitive | Use `autoSlippage` | Jupiter calculates optimal |

### Price Impact and Route Display

Always show the user:

1. **Expected output**: `quote.outAmount` converted to human-readable
2. **Minimum received**: `quote.otherAmountThreshold` — worst case after slippage
3. **Price impact**: `quote.priceImpactPct` — warn if > 1%
4. **Route**: Which DEXs are used and how the amount splits

```dart
// Warning thresholds
final impact = double.parse(quote.priceImpactPct);
if (impact > 5.0) {
  showWarning('Severe price impact (${impact}%). Consider smaller amount.');
} else if (impact > 1.0) {
  showWarning('High price impact (${impact}%).');
}
```

---

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Stale quote → transaction fails | Quote is seconds old, price moved | Fetch quote immediately before building swap tx |
| Slippage too tight → frequent failures | 0.1% slippage in volatile market | Use 50 bps default, or `autoSlippage: true` |
| Slippage too loose → MEV sandwich | 5%+ slippage invites sandwich attacks | Cap at 300 bps max, use `dynamicSlippage` |
| Wrong amount unit | Passed human amount instead of base units | 1 SOL = 1,000,000,000 lamports; 1 USDC = 1,000,000 (6 decimals) |
| No priority fee → stuck transaction | Mainnet during high activity | Set `computeUnitPriceMicroLamports` or `prioritizationFeeLamports` |
| Staking withdrawal fails | Tryied to withdraw during cooldown | Wait for deactivation to complete (2-3 epochs) |
| Platform fee not collected | `feeAccount` not set or wrong token | The fee account must be an ATA for the output token |

---

## API Quick Reference

### jupiter_aggregator

| Type | Purpose |
|------|---------|
| `JupiterAggregatorClient` | Swap API — `getQuote` + `getSwapTransactions` |
| `JupiterPriceClient` | Price API — `getPrice` for USD values |
| `QuoteRequestDto` | Swap request params (mints, amount, slippage, mode) |
| `QuoteResponseDto` | Route, amounts, price impact, slippage |
| `JupiterSwapRequestDto` | Build transaction (user key + quote + options) |
| `JupiterSwapResponseDto` | Base64 serialized transaction to sign |
| `SwapMode` | `exactIn` / `exactOut` |
| `RoutePlan` | One leg of a multi-hop route |
| `PriceDto` | Token USD price |

### StakeProgram (from `solana`)

| Type | Purpose |
|------|---------|
| `StakeProgram.id` | Program ID (`Stake1111...`) |
| `StakeInstruction` | 13 factory constructors for all staking operations |
| `Authorized` | Staker + withdrawer authority pair |
| `StakeAuthorize` | `.staker(pubkey)` / `.withdrawer(pubkey)` |
| `Lockup` | Optional time/epoch lock with authority |

---

## Related

- [Token Operations](token-ops) — SPL token instructions, ATAs
- [The solana Package](solana-package) — `SolanaClient`, transaction building, priority fees
- [Wallet UX Patterns](wallet-ux) — Transaction approval and error handling
