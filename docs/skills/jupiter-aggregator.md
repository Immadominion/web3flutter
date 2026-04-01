# Jupiter Aggregator — DEX Swap & Price API for Dart/Flutter

> Retrofit/Dio client wrapping the Jupiter v6 swap API and Price v2 API.
> Internal package (`publish_to: "none"`) from the Espresso Cash monorepo —
> copy the source or vendor it. No pub.dev package exists.

| Package | Version | Source |
|---------|---------|--------|
| `jupiter_aggregator` | 0.0.5 | [espresso-cash-public](https://github.com/niclas9/espresso-cash-public/tree/master/packages/jupiter_aggregator) |

**Depends on:** `dio` ^5.4.0, `freezed_annotation` ^2.2.0, `retrofit` ^4.0.3

---

## Overview

`jupiter_aggregator` provides two Retrofit-generated Dio clients:
`JupiterAggregatorClient` (swap API — quote and execute) and
`JupiterPriceClient` (token USD prices). Both use freezed DTOs for all
request/response models. The package talks to `quote-api.jup.ag/v6` and
`api.jup.ag` respectively.

There is **no pub.dev package** for Jupiter in Dart. You must vendor the source
from the Espresso Cash monorepo or rewrite the client using the same endpoint
contracts shown below.

---

## Quick Start

```dart
import 'package:jupiter_aggregator/jupiter_aggregator.dart';
import 'package:solana/solana.dart';

Future<void> swapSolToUsdc(Ed25519HDKeyPair wallet) async {
  final jupiter = JupiterAggregatorClient();
  final rpc = RpcClient('https://api.mainnet-beta.solana.com');

  // 1. Get quote
  final quote = await jupiter.getQuote(QuoteRequestDto(
    inputMint: 'So11111111111111111111111111111111111111112',  // wSOL
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    amount: 1000000000,  // 1 SOL in lamports
    slippageBps: 50,     // 0.5%
  ));

  // 2. Get swap transaction
  final swapResponse = await jupiter.getSwapTransactions(
    JupiterSwapRequestDto(
      userPublicKey: wallet.address,
      quoteResponse: quote,
    ),
  );

  // 3. Decode, sign, send
  final txBytes = base64Decode(swapResponse.swapTransaction);
  final signed = await wallet.sign(txBytes);
  final sig = await rpc.sendTransaction(
    signed.encode(),
    preflightCommitment: Commitment.confirmed,
  );
}
```

---

## Core Concepts

### Client Construction

```dart
// Default — hits quote-api.jup.ag/v6
final jupiter = JupiterAggregatorClient();

// With API key for higher rate limits
final jupiter = JupiterAggregatorClient(apiKey: 'your-jup-api-key');

// Custom base URL (testing, proxy, or self-hosted)
final jupiter = JupiterAggregatorClient(
  baseUrl: 'https://your-proxy.com/v6',
);

// Compile-time override via --dart-define
// flutter run --dart-define=QUOTE_API_BASE=https://proxy.example.com/v6
```

The API key is injected via an `x-api-key` Dio interceptor — optional but
recommended for production to avoid rate limits.

### Price Client

```dart
final priceClient = JupiterPriceClient();

// With API key
final priceClient = JupiterPriceClient(apiKey: 'your-key');

// Fetch prices for multiple tokens at once
final response = await priceClient.getPrice(PriceRequestDto(
  ids: [
    'So11111111111111111111111111111111111111112',   // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  ],
));

final solPrice = response.data['So11111111111111111111111111111111111111112']?.price;
// → "142.50" (string, parse to double)
```

The price client includes a response interceptor that handles Jupiter
sometimes returning JSON as a raw string instead of a parsed object.

---

## Quote API

### QuoteRequestDto — Full Parameters

```dart
const quote = QuoteRequestDto(
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: 1000000000,               // In smallest unit of input token
  slippageBps: 50,                   // 0.5% — use 1 bps = 0.01%
  swapMode: SwapMode.exactIn,        // or SwapMode.exactOut
  onlyDirectRoutes: false,           // true = single-hop only
  asLegacyTransaction: false,        // true = no versioned tx
  autoSlippage: true,                // Jupiter calculates optimal
  maxAutoSlippageBps: 300,           // Cap auto-slippage at 3%
  platformFeeBps: 25,               // Your platform's fee (0.25%)
  maxAccounts: 64,                   // Transaction account limit
  restrictIntermediateTokens: true,  // Only well-known intermediaries
  // dexes: ['Raydium', 'Orca'],    // Whitelist (optional)
  // excludeDexes: ['Serum'],        // Blacklist (optional)
);
```

**SwapMode:**

| Mode | amount means | Result |
|------|-------------|--------|
| `SwapMode.exactIn` | Exact input amount | Output varies (most common) |
| `SwapMode.exactOut` | Exact desired output | Input varies |

### QuoteResponseDto — Key Fields

```dart
final quote = await jupiter.getQuote(request);

quote.inputMint;              // Input token mint
quote.inAmount;               // String — actual input amount
quote.outputMint;             // Output token mint
quote.outAmount;              // String — best-case output
quote.otherAmountThreshold;   // String — minimum output after slippage
quote.slippageBps;            // Applied slippage
quote.priceImpactPct;         // String — e.g., "0.12" means 0.12%
quote.routePlan;              // List<RoutePlan> — multi-hop route
quote.platformFee;            // JupiterMarketFee? — your fee info
quote.timeTaken;              // double? — seconds for route computation
```

### Route Plan (Multi-Hop)

```dart
for (final step in quote.routePlan) {
  step.percent;              // Split percentage (100 or 60/40 etc.)
  step.swapInfo.label;       // "Raydium", "Orca", "Phoenix", etc.
  step.swapInfo.inputMint;
  step.swapInfo.outputMint;
  step.swapInfo.inAmount;
  step.swapInfo.outAmount;
  step.swapInfo.feeAmount;   // DEX fee for this hop
  step.swapInfo.feeMint;
  step.swapInfo.ammKey;      // Pool address
}
```

---

## Swap API

### JupiterSwapRequestDto

```dart
final swapRequest = JupiterSwapRequestDto(
  userPublicKey: walletAddress,
  quoteResponse: quote,                    // Pass the ENTIRE quote object
  wrapAndUnwrapSol: true,                  // Auto wrap/unwrap SOL ↔ wSOL
  useSharedAccounts: true,                 // Jupiter's shared ATAs (saves rent)
  computeUnitPriceMicroLamports: 50000,    // Priority fee
  dynamicComputeUnitLimit: true,           // Jupiter sets optimal CU
  dynamicSlippage: DynamicSlippage(        // Server-side slippage optimization
    minBps: 10,
    maxBps: 300,
  ),
  // feeAccount: 'YourFeeATA...',          // Platform fee recipient
  // destinationTokenAccount: 'custom...',  // Override output destination
  // asLegacyTransaction: false,
  // skipUserAccountsRpcCalls: false,
);
```

### JupiterSwapResponseDto

```dart
final swap = await jupiter.getSwapTransactions(swapRequest);

swap.swapTransaction;             // Base64-encoded unsigned transaction
swap.lastValidBlockHeight;        // Block height expiry for the tx
swap.prioritizationFeeLamports;   // Applied priority fee
swap.dynamicSlippageReport;       // Actual slippage details if dynamic
```

### Decode and Sign

The swap transaction comes as a base64-encoded versioned or legacy transaction.
Decode it, sign with the user's wallet, and send:

```dart
import 'dart:convert';

final txBytes = base64Decode(swap.swapTransaction);

// For MWA (mobile wallet adapter):
final signed = await mwaClient.signTransactions(
  authToken: token,
  transactions: [txBytes],
);

// For local keypair:
// Parse as SignedTx, add signature, re-serialize

await rpc.sendTransaction(
  base64Encode(signedBytes),
  preflightCommitment: Commitment.confirmed,
);
```

---

## Patterns & Recipes

### Cached Price Fetching (Production Pattern)

Espresso Cash adds Dio caching to prevent hammering Jupiter on fast UI
rebuilds:

```dart
@injectable
@RestApi(baseUrl: 'https://api.jup.ag')
abstract class CachedJupiterPriceClient {
  @factoryMethod
  factory CachedJupiterPriceClient(DioCacheClient client) =>
      _CachedJupiterPriceClient(client.dio);

  @GET('/price/v2')
  @Extra({maxAgeOption: Duration(minutes: 1)})
  Future<PriceResponseDto> getPrice(@Queries() PriceRequestDto request);
}
```

Key insight: batch token IDs into a single call (the `ids` param is
comma-joined) and cache for ≥1 minute.

### Backend-Proxied Swaps

For production apps, proxy swaps through your backend to:

- Keep API keys server-side
- Add platform fees without exposing fee logic
- Co-sign transactions (e.g., for gasless swaps)
- Rate-limit and audit swap requests

```dart
// Simplified backend proxy DTOs (from Espresso Cash)
@freezed
class SwapRouteRequestDto with _$SwapRouteRequestDto {
  const factory SwapRouteRequestDto({
    required String inputToken,
    required String outputToken,
    required String amount,
    required SwapSlippage slippage,    // Pre-defined tiers
    required String userAccount,
  }) = _SwapRouteRequestDto;
}

@freezed
class SwapRouteResponseDto with _$SwapRouteResponseDto {
  const factory SwapRouteResponseDto({
    required String inAmount,
    required String outAmount,
    required String encodedTx,        // Ready-to-sign transaction
    required int feeInUsdc,
  }) = _SwapRouteResponseDto;
}
```

### Slippage Guidelines

| Market Condition | Recommended `slippageBps` |
|------------------|---------------------------|
| Stable pairs (USDC/USDT) | 5–10 |
| Major tokens (SOL/USDC) | 30–50 |
| Mid-cap tokens | 50–100 |
| Low liquidity / memecoins | 100–300 |

Use `autoSlippage: true` with `maxAutoSlippageBps` to let Jupiter optimize.

### Price Impact Warnings

```dart
final impact = double.tryParse(quote.priceImpactPct) ?? 0;
if (impact > 1.0) {
  // Show yellow warning — significant impact
}
if (impact > 5.0) {
  // Show red warning — high impact, user may lose value
}
```

---

## DTO Quick Reference

| Type | Purpose |
|------|---------|
| `QuoteRequestDto` | GET /quote params — mints, amount, slippage, swap mode |
| `QuoteResponseDto` | Quote result — amounts, route plan, price impact |
| `RoutePlan` | Single hop in multi-hop route — percent split, swap info |
| `JupiterSwapInfo` | DEX-level detail — pool, amounts, fees, label |
| `JupiterMarketFee` | Platform fee info — amount, bps |
| `JupiterSwapRequestDto` | POST /swap body — user pubkey + full quote + options |
| `JupiterSwapResponseDto` | Swap result — base64 unsigned tx, block height deadline |
| `DynamicSlippage` | Min/max bps for server-side slippage optimization |
| `DynamicSlippageReport` | Actual slippage applied to the swap |
| `PriceRequestDto` | GET /price/v2 params — comma-joined mint addresses |
| `PriceResponseDto` | Price result — mint-keyed map of USD prices |
| `PriceDto` | Single token price — nullable string |
| `SwapMode` | `exactIn` (default) or `exactOut` |

---

## Common Mistakes

| # | Mistake | Fix |
|---|---------|-----|
| 1 | Passing `amount` in token units instead of smallest unit (lamports/decimals) | Always multiply by `10^decimals` — 1 SOL = `1000000000`, 1 USDC = `1000000` |
| 2 | Using a stale quote for the swap request — transaction fails with blockhash expired | Fetch a fresh quote immediately before calling `getSwapTransactions`, don't cache quotes |
| 3 | Not passing the entire `quoteResponse` object to `JupiterSwapRequestDto` | The swap endpoint requires the full `QuoteResponseDto` — don't extract fields manually |
| 4 | Ignoring `priceImpactPct` — user loses value on illiquid swaps | Parse the string to `double` and warn users above 1% impact |
| 5 | Hardcoding slippage for all pairs — fails on volatile tokens | Use `autoSlippage: true` with `maxAutoSlippageBps`, or adjust per token volatility |
| 6 | Not adding priority fees — swap transactions land slowly or fail | Set `computeUnitPriceMicroLamports` or `prioritizationFeeLamports` in swap request |
| 7 | Exposing Jupiter API key in client code | Move swap calls to a backend proxy — only price lookups should be direct from client |
| 8 | Parsing `PriceDto.price` as non-nullable — crashes on unlisted tokens | `price` is `String?` — always null-check before parsing to `double` |

---

## Related

- [solana-core.md](solana-core.md) — RPC client and transaction types
- [transaction-building.md](transaction-building.md) — signing and sending the swap transaction
- [spl-token.md](spl-token.md) — token accounts and associated token addresses
