# NFT Development — Metaplex & Compressed NFTs in Flutter

> Mint, transfer, and display NFTs on Solana from Flutter apps using Metaplex standards.

## Overview

Solana NFTs use the Metaplex standard. An NFT is technically an SPL token with 0 decimals and a supply of 1, plus associated metadata. Compressed NFTs (cNFTs) use state compression to mint millions of NFTs at a fraction of the cost.

## Core Concepts

### NFT Account Structure

```
┌─────────────────┐
│ Mint Account     │ ← The token itself (supply=1, decimals=0)
├─────────────────┤
│ Metadata Account │ ← Name, symbol, URI, royalties (PDA from mint)
├─────────────────┤
│ Master Edition   │ ← Proves this is an original / sets max supply 
├─────────────────┤
│ Token Account    │ ← Who currently holds this NFT
└─────────────────┘
```

### Fetching NFT Metadata

```dart
// Derive the metadata PDA
final metadataProgramId = Ed25519HDPublicKey.fromBase58(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
);

final metadataPda = await Ed25519HDPublicKey.findProgramAddress(
  seeds: [
    'metadata'.codeUnits,
    metadataProgramId.bytes,
    mintAddress.bytes,
  ],
  programId: metadataProgramId,
);

// Fetch and decode the metadata account
final accountInfo = await client.getAccountInfo(
  metadataPda.key.toBase58(),
  encoding: Encoding.base64,
);

// Metadata contains a URI pointing to off-chain JSON
// Fetch that JSON for image, attributes, etc.
```

### Displaying NFTs

```dart
// After getting the metadata URI, fetch the JSON:
// {
//   "name": "Cool NFT #123",
//   "image": "https://arweave.net/...",
//   "attributes": [
//     { "trait_type": "Background", "value": "Blue" }
//   ]
// }

// Display in Flutter:
CachedNetworkImage(
  imageUrl: nftMetadata.image,
  placeholder: (_, __) => Shimmer(),
  errorWidget: (_, __, ___) => Icon(Icons.broken_image),
)
```

### Compressed NFTs (cNFTs)

cNFTs use Merkle trees for massive cost savings:

| Type | Mint Cost (1 NFT) | Mint Cost (10,000 NFTs) |
|------|-------------------|------------------------|
| Standard NFT | ~0.012 SOL | ~120 SOL |
| Compressed NFT | ~0.000005 SOL | ~0.05 SOL |

```dart
// Compressed NFTs use the Bubblegum program
final bubblegumProgramId = Ed25519HDPublicKey.fromBase58(
  'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY',
);

// Reading cNFTs requires the Digital Asset Standard (DAS) API
// Available through RPC providers like Helius
final response = await http.post(
  Uri.parse('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY'),
  body: jsonEncode({
    'jsonrpc': '2.0',
    'id': 'my-id',
    'method': 'getAssetsByOwner',
    'params': {
      'ownerAddress': wallet.publicKey.toBase58(),
      'page': 1,
      'limit': 100,
    },
  }),
);
```

> **GOTCHA**: Standard `getTokenAccountsByOwner` does NOT return compressed NFTs. You MUST use the DAS API (Digital Asset Standard) through a provider like Helius. This is the most common confusion for developers.

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Using `getTokenAccountsByOwner` for cNFTs | cNFTs aren't real token accounts | Use DAS API: `getAssetsByOwner` |
| Not caching metadata fetches | Each NFT requires separate HTTP call | Cache aggressively — metadata is immutable |
| Ignoring royalties in marketplace | Different enforcement models | Check `sellerFeeBasisPoints` and `creators` array |
| Loading full-res images in lists | NFTs can have large images | Use thumbnail URLs or resize before display |

## Related

- [Token Operations](./token-ops.md) — NFTs are a special case of SPL tokens
- [Solana Package Deep Dive](./solana-package.md) — Underlying transaction building

---

*Metaplex: [docs.metaplex.com](https://docs.metaplex.com/)*
