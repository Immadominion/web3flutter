# NFTs on Solana — Metaplex Integration in Dart

> The `solana` package's Metaplex layer: on-chain metadata parsing, MasterEdition deserialization, off-chain JSON fetching, PDA derivation, and V3 instruction builders for minting NFTs.

## Overview

An NFT on Solana is an SPL token with 0 decimals and supply of 1. What makes it an "NFT" is the **Metaplex Token Metadata program** — it attaches two PDA accounts to the mint:

- **Metadata** — name, symbol, URI, update authority, mint address
- **Master Edition** — proves it's an original, tracks print supply

The `solana` package includes a full `metaplex/` module: binary metadata parsing, Borsh-based MasterEdition deserialization, off-chain JSON models, PDA derivation utilities, and V3 create instructions.

**Program ID**: `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`

---

## Quick Start

```dart
import 'package:solana/solana.dart';

final rpc = RpcClient('https://api.mainnet-beta.solana.com');

// Fetch on-chain metadata
final metadata = await rpc.getMetadata(mint: nftMint);
if (metadata == null) throw Exception('Not an NFT or metadata not found');

print(metadata.name);             // "Cool NFT #123"
print(metadata.symbol);           // "COOL"
print(metadata.uri);              // "https://arweave.net/..."
print(metadata.mint);             // mint address (base58)
print(metadata.updateAuthority);  // who can update this metadata

// Fetch off-chain JSON (image, attributes, description)
final offChain = await metadata.getExternalJson();
print(offChain.image);            // "https://arweave.net/image.png"
print(offChain.description);      // "A very cool NFT"
for (final attr in offChain.attributes) {
  print('${attr.traitType}: ${attr.value}');  // "Rarity: Legendary"
}

// Check master edition (supply, max supply)
final edition = await rpc.getMasterEdition(mint: nftMint);
print(edition?.supply);     // BigInt — copies printed so far
print(edition?.maxSupply);  // BigInt? — null means unlimited prints
```

---

## Core Concepts

### PDA Derivation

Metaplex PDAs follow a deterministic pattern from the mint address:

```dart
// Metadata PDA: ["metadata", program_id, mint]
final metadataPda = await findMetaplexMetadataProgramAddress(nftMint);

// Master Edition PDA: ["metadata", program_id, mint, "edition"]
final editionPda = await findMetaplexEditionProgramAddress(nftMint);
```

Both use `Ed25519HDPublicKey.findProgramAddress` with the Metaplex program ID.

### On-Chain Metadata — Binary Parsing

The `Metadata` class uses a **hand-written binary parser**, not `@BorshSerializable`. This is because Metaplex's metadata layout uses C-style zero-terminated strings inside fixed-length fields, which Borsh's standard types can't handle cleanly.

**Binary layout**:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 1 byte | key (discriminator, skipped) |
| 1 | 32 bytes | updateAuthority → base58 |
| 33 | 32 bytes | mint → base58 |
| 65 | 4 + N bytes | name: u32 LE length + UTF-8 bytes (zero-terminated) |
| ... | 4 + N bytes | symbol: same format |
| ... | 4 + N bytes | uri: same format |

The parser reads the u32 length prefix, then scans within that span for the first `0x00` byte to find the actual string end. This handles Metaplex's zero-padded fixed-size string fields.

```dart
class Metadata {
  final String name;              // e.g. "Cool NFT #123"
  final String symbol;            // e.g. "COOL"
  final String uri;               // e.g. "https://arweave.net/..."
  final String updateAuthority;   // base58 public key
  final String mint;              // base58 public key
}
```

> **WHY THIS MATTERS**: The parser intentionally stops after `uri` — it doesn't extract `sellerFeeBasisPoints`, `creators`, `collection`, or `uses` from the on-chain binary. These fields exist in the account data but aren't parsed. If you need them, you'll extend `Metadata.fromBinary()` or use the Borsh-annotated instruction data models that DO include those fields.

### RPC Extension Methods

```dart
extension GetMetaplexMetadata on RpcClient {
  // Derives metadata PDA → getAccountInfo(base64) → Metadata.fromBinary()
  Future<Metadata?> getMetadata({
    required Ed25519HDPublicKey mint,
    Commitment commitment = Commitment.finalized,
  });

  // Derives edition PDA → getAccountInfo(base64) → MasterEdition.fromBorsh()
  Future<MasterEdition?> getMasterEdition({
    required Ed25519HDPublicKey mint,
    Commitment commitment = Commitment.finalized,
  });
}
```

Both return `null` if the account doesn't exist (the token isn't an NFT, or hasn't been initialized with Metaplex).

### MasterEdition — Borsh Deserialized

Unlike `Metadata`, `MasterEdition` uses standard `@BorshSerializable`:

```dart
@BorshSerializable()
abstract class MasterEdition with _$MasterEdition {
  factory MasterEdition({
    @BU8() required int key,           // account discriminator
    @BU64() required BigInt supply,    // copies printed so far
    @BOption(BU64()) BigInt? maxSupply, // null = unlimited prints
  }) = _MasterEdition;

  factory MasterEdition.fromBorsh(Uint8List data) => _$MasterEditionFromBorsh(data);
}
```

| Field | Meaning |
|-------|---------|
| `key` | Account type discriminator (6 = MasterEditionV2) |
| `supply` | Number of printed editions (starts at 0) |
| `maxSupply` | Maximum printable editions. `null` (None) means unlimited. `BigInt.zero` means no prints allowed. |

### Off-Chain Metadata — JSON

The `uri` in on-chain metadata points to a JSON file (usually on Arweave, IPFS, or a CDN):

```dart
final offChain = await metadata.getExternalJson();
// HTTP GET to metadata.uri → parse JSON → OffChainMetadata
```

```dart
class OffChainMetadata {
  final String name;
  final String description;
  final String symbol;
  final String image;                 // image URL
  final Properties properties;       // media files + category
  final List<Attribute> attributes;   // trait_type/value pairs
  final Collection? collection;       // collection name + family
}
```

Expected JSON format:

```json
{
  "name": "Cool NFT #123",
  "description": "A very cool NFT from the COOL collection",
  "symbol": "COOL",
  "image": "https://arweave.net/abc123",
  "properties": {
    "category": "image",
    "files": [{ "uri": "https://arweave.net/abc123", "type": "image/png", "cdn": false }]
  },
  "attributes": [
    { "trait_type": "Background", "value": "Blue" },
    { "trait_type": "Rarity", "value": "Legendary" }
  ],
  "collection": { "name": "Cool Collection", "family": "Cool" }
}
```

**Properties** is a freezed union on `category`: `.image(files)`, `.video(files)`, `.audio(files)`, `.vr(files)`, `.html(files)`, `.unknown()`.

Each **File** has `uri` (String), `type` (MIME), and `cdn` (bool, defaults false).

> **GOTCHA**: Storing images on-chain would cost thousands of SOL. The on-chain metadata just holds a URI pointer. If the hosting (Arweave, IPFS, CDN) goes down, the NFT's display breaks — even though ownership is still provable on-chain. Always check that `uri` is accessible before assuming you can show the image.

---

### Minting NFTs — V3 Instructions

The package includes `createMetadataAccountV3` and `createMasterEditionV3` instruction builders:

```dart
// 1. Create the SPL token mint (supply=1, decimals=0)
final mintKeypair = await Ed25519HDKeyPair.random();
final mintInstructions = TokenInstruction.createAccountAndInitializeMint(
  mint: mintKeypair.publicKey,
  mintAuthority: wallet.publicKey,
  rent: await rpc.getMinimumBalanceForRentExemption(TokenProgram.neededMintAccountSpace),
  space: TokenProgram.neededMintAccountSpace,
  decimals: 0,
);

// 2. Create the ATA and mint 1 token
final ata = await findAssociatedTokenAddress(owner: wallet.publicKey, mint: mintKeypair.publicKey);
final ataIx = AssociatedTokenAccountInstruction.createAccount(
  funder: wallet.publicKey, address: ata, owner: wallet.publicKey, mint: mintKeypair.publicKey,
);
final mintToIx = TokenInstruction.mintTo(
  mint: mintKeypair.publicKey, destination: ata, amount: 1, authority: wallet.publicKey,
);

// 3. Create metadata account
final metadataIx = createMetadataAccountV3(
  metadata: await findMetaplexMetadataProgramAddress(mintKeypair.publicKey),
  mint: mintKeypair.publicKey,
  mintAuthority: wallet.publicKey,
  payer: wallet.publicKey,
  updateAuthority: wallet.publicKey,
  data: CreateMetadataAccountV3Data(
    name: 'My NFT',
    symbol: 'MNFT',
    uri: 'https://arweave.net/my-metadata.json',
    sellerFeeBasisPoints: 500, // 5% royalty
    creators: [
      MetadataCreator(
        address: wallet.publicKey,
        verified: true,  // only the signer can set verified=true
        share: 100,      // 100% of royalties
      ),
    ],
    collection: null,
    uses: null,
    isMutable: true,
    colectionDetails: false, // typo preserved from original code
  ),
);

// 4. Create master edition
final editionIx = createMasterEditionV3(
  edition: await findMetaplexEditionProgramAddress(mintKeypair.publicKey),
  mint: mintKeypair.publicKey,
  updateAuthority: wallet.publicKey,
  mintAuthority: wallet.publicKey,
  payer: wallet.publicKey,
  metadata: await findMetaplexMetadataProgramAddress(mintKeypair.publicKey),
  maxSupply: BigInt.zero, // 0 = no prints allowed (1/1 NFT)
);

// 5. Send all instructions in one transaction
final message = Message(instructions: [
  ...mintInstructions,
  ataIx,
  mintToIx,
  metadataIx,
  editionIx,
]);
```

**Instruction discriminators**: Metaplex uses single-byte discriminators (not Anchor 8-byte hashes): `33` for CreateMetadataAccountV3, `17` for CreateMasterEditionV3.

### BFixedString — Metaplex's String Encoding

Metaplex uses fixed-size string fields (name=32, symbol=10, uri=200). The package implements `BFixedString(length)` to handle this:

**Write**: u32 LE length prefix + string bytes + zero-padding to fixed length
**Read**: u32 LE length prefix + validate matches expected size + read fixed array + strip null bytes

This is different from Borsh's standard `BString` (which is variable-length). It only exists for Metaplex compatibility.

---

## Patterns & Recipes

### Displaying NFTs in Flutter

The fetch chain:

```
Mint Address → Metadata PDA → getAccountInfo → Metadata.fromBinary()
    ↓
metadata.uri → HTTP GET → OffChainMetadata.fromJson()
    ↓
offChain.image → CachedNetworkImage (display)
```

```dart
Future<Widget> buildNftCard(Ed25519HDPublicKey mint) async {
  final metadata = await rpc.getMetadata(mint: mint);
  if (metadata == null) return const SizedBox.shrink();

  final offChain = await metadata.getExternalJson();

  return Card(
    child: Column(children: [
      CachedNetworkImage(imageUrl: offChain.image),
      Text(offChain.name),
      Text(offChain.description),
      Wrap(
        children: offChain.attributes.map((a) =>
          Chip(label: Text('${a.traitType}: ${a.value}')),
        ).toList(),
      ),
    ]),
  );
}
```

Cache aggressively — metadata and images rarely change. Prefetch during list scrolls.

### Compressed NFTs (cNFTs)

Standard NFTs cost ~0.012 SOL per mint. Compressed NFTs cost ~0.000005 SOL per mint.

How: Instead of one account per NFT, compressed NFTs store a Merkle tree on-chain. Each leaf is a hash of the NFT's data. The full data lives off-chain in indexers.

**The trade-off**: You can't read a compressed NFT from a regular RPC call. You need the **Digital Asset Standard (DAS) API** from providers like Helius or Triton:

```dart
// DAS API (not part of the solana package — use HTTP directly)
final response = await http.post(
  Uri.parse('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY'),
  body: json.encode({
    'jsonrpc': '2.0',
    'id': 'my-id',
    'method': 'getAssetsByOwner',
    'params': {
      'ownerAddress': walletAddress,
      'page': 1,
      'limit': 100,
    },
  }),
);
// Returns JSON with all NFTs (standard + compressed) including image URLs
```

---

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| `getMetadata` returns null | Token isn't an NFT (no Metaplex metadata) | Check for null — not all mints have metadata |
| Off-chain JSON 404 | Arweave/IPFS host unreachable | Show fallback UI, retry with backoff, cache aggressively |
| Royalties not enforced | Metaplex royalties are up to marketplaces to enforce | Use `sellerFeeBasisPoints` and `creators` but understand enforcement is off-chain |
| Wrong creator `verified` flag | Only the signing authority can set `verified: true` | Non-signing creators must be added with `verified: false`, then verified separately |
| `maxSupply: null` vs `BigInt.zero` confusion | Both seem like "no prints" | `null` = unlimited prints, `BigInt.zero` = no prints allowed |
| Metadata fields truncated | Metaplex uses zero-padded fixed strings | Name=32 chars max, symbol=10, URI=200 — truncation is silent |
| Can't find compressed NFTs | Regular `getAccountInfo` doesn't work for cNFTs | Use the DAS API (getAssetsByOwner) from Helius or similar provider |

---

## API Quick Reference

| Type | Purpose |
|------|---------|
| `rpc.getMetadata(mint:)` | Fetch on-chain metadata → `Metadata?` |
| `rpc.getMasterEdition(mint:)` | Fetch master edition → `MasterEdition?` |
| `Metadata` | On-chain: name, symbol, uri, updateAuthority, mint |
| `Metadata.getExternalJson()` | Fetch off-chain JSON → `OffChainMetadata` |
| `MasterEdition` | On-chain: supply, maxSupply (Borsh) |
| `OffChainMetadata` | JSON: name, description, image, attributes, properties |
| `Attribute` | Trait: `traitType` + `value` |
| `Properties` | Union: image/video/audio/vr/html + files |
| `createMetadataAccountV3()` | Instruction builder (discriminator: 33) |
| `createMasterEditionV3()` | Instruction builder (discriminator: 17) |
| `findMetaplexMetadataProgramAddress(mint)` | Derive metadata PDA |
| `findMetaplexEditionProgramAddress(mint)` | Derive master edition PDA |
| `MetadataCreator` | On-chain Borsh: address + verified + share |
| `BFixedString(length)` | Custom BType for Metaplex's zero-padded strings |

---

## Related

- [The solana Package](solana-package) — RPC client, Ed25519 keys, transaction building
- [Token Operations](token-ops) — NFTs are SPL tokens (supply=1, decimals=0)
- [Borsh Serialization](borsh) — MasterEdition uses `@BorshSerializable`, Metadata uses manual parsing
