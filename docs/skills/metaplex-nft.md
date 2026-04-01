# Metaplex NFT — Token Metadata & Master Editions for Dart/Flutter

> On-chain metadata creation and reading via Metaplex Token Metadata Program.
> Supports `createMetadataAccountV3`, `createMasterEditionV3`, PDA derivation,
> and off-chain JSON metadata parsing. Built into the `solana` package.

| Package | Version | Pub |
|---------|---------|-----|
| `solana` | 0.31.2+ | [pub.dev](https://pub.dev/packages/solana) |

**Metaplex support is built into the `solana` package** — import via
`package:solana/metaplex.dart`.

---

## Overview

The `solana` package provides Metaplex Token Metadata support through:

1. **Instruction builders** — `createMetadataAccountV3()` and
   `createMasterEditionV3()` that return `AnchorInstruction` objects.
2. **Account parsers** — `Metadata.fromBinary()` (hand-written) and
   `MasterEdition.fromBorsh()` for reading on-chain accounts.
3. **RPC extensions** — `getMetadata()` and `getMasterEdition()` on
   `RpcClient` that handle PDA derivation + fetching + parsing.
4. **Off-chain models** — `OffChainMetadata`, `Attribute`, `Properties`,
   `Collection`, `File` for the JSON standard.

The Metaplex program ID is `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`.

---

## Quick Start

```dart
import 'package:solana/solana.dart';
import 'package:solana/metaplex.dart';

Future<void> mintNft(SolanaClient client, Ed25519HDKeyPair owner) async {
  // 1. Create a mint with 0 decimals (NFT = 0 decimals, supply 1)
  final mint = await client.initializeMint(
    mintAuthority: owner,
    decimals: 0,
  );

  // 2. Create ATA and mint exactly 1 token
  final ata = await client.createAssociatedTokenAccount(
    mint: mint.address,
    funder: owner,
  );
  await client.mintTo(
    mint: mint.address,
    destination: Ed25519HDPublicKey.fromBase58(ata.pubkey),
    amount: 1,
    authority: owner,
  );

  // 3. Create metadata account
  final metadataIx = await createMetadataAccountV3(
    mint: mint.address,
    mintAuthority: owner.publicKey,
    payer: owner.publicKey,
    updateAuthority: owner.publicKey,
    data: CreateMetadataAccountV3Data(
      name: 'My NFT',
      symbol: 'MNFT',
      uri: 'https://arweave.net/your-metadata.json',
      sellerFeeBasisPoints: 500, // 5% royalty
      isMutable: true,
      colectionDetails: false,
    ),
  );
  await client.sendAndConfirmTransaction(
    message: Message.only(metadataIx),
    signers: [owner],
    onSigned: ignoreOnSigned,
  );

  // 4. Create master edition (makes it a true NFT)
  final editionIx = await createMasterEditionV3(
    mint: mint.address,
    updateAuthority: owner.publicKey,
    mintAuthority: owner.publicKey,
    payer: owner.publicKey,
    data: CreateMasterEditionV3Data(
      maxSupply: BigInt.zero, // 0 = no prints allowed
    ),
  );
  await client.sendAndConfirmTransaction(
    message: Message.only(editionIx),
    signers: [owner],
    onSigned: ignoreOnSigned,
  );
}
```

---

## Core Concepts

### Reading Metadata

```dart
// Via RpcClient extension — handles PDA derivation automatically
final metadata = await client.rpcClient.getMetadata(
  mint: mintPubKey,
  commitment: Commitment.finalized,
);
// Returns Metadata? — null if account doesn't exist

if (metadata != null) {
  metadata.name;              // 'My NFT'
  metadata.symbol;            // 'MNFT'
  metadata.uri;               // 'https://arweave.net/...'
  metadata.updateAuthority;   // base58 string
  metadata.mint;              // base58 string
}
```

### Reading Master Edition

```dart
final edition = await client.rpcClient.getMasterEdition(
  mint: mintPubKey,
);
// Returns MasterEdition? — null if not found

if (edition != null) {
  edition.key;         // 6 = MasterEditionV2
  edition.supply;      // BigInt — prints minted so far
  edition.maxSupply;   // BigInt? — null = unlimited, 0 = no prints
}
```

### Off-Chain Metadata (JSON)

Fetch and parse the off-chain JSON from the `uri` field:

```dart
final offChain = await metadata.getExternalJson();

offChain.name;           // 'My NFT'
offChain.description;    // 'A cool NFT'
offChain.symbol;         // 'MNFT'
offChain.image;          // 'https://arweave.net/image.png'

// Attributes (trait_type / value pairs)
for (final attr in offChain.attributes) {
  attr.traitType;  // 'Background'
  attr.value;      // 'Blue' (dynamic — can be string, int, etc.)
}

// Properties — freezed union by media category
offChain.properties.map(
  unknown: (_) => 'Unknown',
  image: (p) => p.files.first.uri,
  video: (p) => p.files.first.uri,
  audio: (p) => p.files.first.uri,
  vr: (p) => p.files.first.uri,
  html: (p) => p.files.first.uri,
);

// Collection
offChain.collection?.name;    // 'My Collection'
offChain.collection?.family;  // 'My Family'
```

---

## Instruction Builders

### createMetadataAccountV3

```dart
Future<AnchorInstruction> createMetadataAccountV3({
  required Ed25519HDPublicKey mint,
  required Ed25519HDPublicKey mintAuthority,
  required Ed25519HDPublicKey payer,
  required Ed25519HDPublicKey updateAuthority,
  required CreateMetadataAccountV3Data data,
});
```

**CreateMetadataAccountV3Data fields:**

| Field | Type | Notes |
|-------|------|-------|
| `name` | `String` | Fixed 32 bytes (BFixedString) |
| `symbol` | `String` | Fixed 10 bytes |
| `uri` | `String` | Fixed 200 bytes — off-chain JSON URL |
| `sellerFeeBasisPoints` | `int` | Royalty in bps (500 = 5%) |
| `creators` | `List<MetadataCreator>?` | Optional creator list |
| `collection` | `MetadataCollection?` | Collection verification |
| `uses` | `MetadataUses?` | Usage tracking |
| `isMutable` | `bool` | Can metadata be updated later |
| `colectionDetails` | `bool` | Collection details flag |

### createMasterEditionV3

```dart
Future<AnchorInstruction> createMasterEditionV3({
  required Ed25519HDPublicKey mint,
  required Ed25519HDPublicKey updateAuthority,
  required Ed25519HDPublicKey mintAuthority,
  required Ed25519HDPublicKey payer,
  required CreateMasterEditionV3Data data,
});
```

**CreateMasterEditionV3Data fields:**

| Field | Type | Notes |
|-------|------|-------|
| `maxSupply` | `BigInt?` | `null` = unlimited prints, `BigInt.zero` = no prints |

---

## Supporting Types

### MetadataCreator

```dart
MetadataCreator(
  address: creatorPubKey,   // Ed25519HDPublicKey
  verified: false,          // Only true after on-chain verification
  share: 100,               // 0–100, must sum to 100 across all creators
)
```

### MetadataCollection

```dart
MetadataCollection(
  verified: false,          // Only true after collection authority verifies
  key: collectionMintPubKey,
)
```

### MetadataUses

```dart
MetadataUses(
  useMethod: 0,    // 0 = Burn, 1 = Multiple, 2 = Single
  remaining: BigInt.from(1),
  total: BigInt.from(1),
)
```

### Properties (Off-Chain — Freezed Union)

```dart
// Discriminated by 'category' field in JSON
const factory Properties.image({required List<File> files}) = Image;
const factory Properties.video({required List<File> files}) = Video;
const factory Properties.audio({required List<File> files}) = Audio;
const factory Properties.vr({required List<File> files}) = Model3D;
const factory Properties.html({required List<File> files}) = Html;
const factory Properties.unknown() = Unknown;
```

```dart
// File model
class File {
  String uri;     // 'https://arweave.net/image.png'
  String type;    // 'image/png'
  bool cdn;       // defaults false
}
```

---

## Patterns & Recipes

### Full NFT Minting Flow

The complete flow requires 4 transactions (or batch in fewer):

1. **Create mint** — `initializeMint(decimals: 0)`
2. **Create ATA + mint 1 token** — `createAssociatedTokenAccount` + `mintTo(amount: 1)`
3. **Create metadata** — `createMetadataAccountV3`
4. **Create master edition** — `createMasterEditionV3`

### Backend-Mediated Minting (Production Pattern)

For mobile apps, delegate transaction building to a backend:

```dart
// 1. Upload media + JSON metadata to Arweave/IPFS
final metadataUri = await uploadService.upload(name, image, attributes);

// 2. Backend builds the Metaplex instructions server-side
final preparedTx = await backendApi.prepareNft(
  walletAddress: wallet.address,
  name: 'My NFT',
  symbol: 'MNFT',
  metadataUri: metadataUri,
  sellerFeeBasisPoints: 500,
  creators: [CreatorDto(address: wallet.address, share: 100)],
);

// 3. Sign with MWA
final signed = await mwaClient.signTransactions(
  authToken: token,
  transactions: [base64Decode(preparedTx.encodedTx)],
);

// 4. Backend submits
await backendApi.finalizeNft(preparedTx.id, base64Encode(signed));
```

### Fetch and Display NFT Gallery

```dart
Future<List<OffChainMetadata>> fetchNfts(
  RpcClient rpc,
  List<Ed25519HDPublicKey> mints,
) async {
  final results = <OffChainMetadata>[];
  for (final mint in mints) {
    final metadata = await rpc.getMetadata(mint: mint);
    if (metadata == null) continue;
    try {
      results.add(await metadata.getExternalJson());
    } catch (_) {
      // URI may be invalid or unreachable
    }
  }
  return results;
}
```

---

## Common Mistakes

| # | Mistake | Fix |
|---|---------|-----|
| 1 | Creating NFT mint with non-zero decimals | NFTs must have `decimals: 0` and supply of exactly 1 |
| 2 | Minting more than 1 token for an NFT mint | Mint exactly 1 token before creating the master edition |
| 3 | Not creating metadata before master edition | Master edition instruction requires the metadata PDA to exist |
| 4 | Setting `maxSupply: null` when no prints wanted | Use `BigInt.zero` for no prints — `null` means unlimited |
| 5 | Creator shares not summing to 100 | All `MetadataCreator.share` values must sum to exactly 100 |
| 6 | Setting `verified: true` on creators without on-chain verification | Only the signing creator can be `verified: true` at creation time |
| 7 | Using the wrong import — `package:solana/solana.dart` alone misses Metaplex types | Add `import 'package:solana/metaplex.dart';` for all Metaplex types |
| 8 | Trying to access PDA helpers directly — `findMetaplexMetadataProgramAddress` is internal | Use `rpcClient.getMetadata(mint:)` which handles PDA derivation internally |

---

## Related

- [solana-core.md](solana-core.md) — RPC client, transaction signing
- [spl-token.md](spl-token.md) — mint creation, ATA, token operations
- [borsh.md](borsh.md) — Borsh serialization used by metadata DTOs
- [transaction-building.md](transaction-building.md) — composing multi-instruction NFT transactions
