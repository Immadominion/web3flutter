# Walrus Mental Model

> The shortest path to understanding Dartus is understanding Walrus first: what a blob is, who pays for storage, why Sui is involved, and why the network needs publishers, aggregators, and storage nodes.

## Overview

Walrus stores **large unstructured blobs** in a way that is content-addressed, highly available, and verifiable. That already makes it different from a normal cloud bucket.

The part that usually confuses people is that Walrus is not only a storage network. It also uses Sui to coordinate ownership, certification, storage duration, and payment. So when you look at Dartus and see HTTP classes sitting next to transaction builders, that is not the SDK being messy. That is the protocol.

If you take one idea from this page, make it this one: **Walrus storage is a network service, but Walrus storage rights are on-chain objects.**

## Quick Start

```dart
import 'package:dartus/dartus.dart';

Future<void> main() async {
  final client = WalrusClient(
    publisherBaseUrl: Uri.parse('https://publisher.walrus-testnet.walrus.space'),
    aggregatorBaseUrl: Uri.parse('https://aggregator.walrus-testnet.walrus.space'),
  );

  final response = await client.putBlob(
    data: 'hello walrus'.codeUnits,
    epochs: 3,
    deletable: true,
  );

  print(response);
  await client.close();
}
```

This looks like a normal HTTP upload, but a lot more is happening under the hood:

1. A publisher accepts the blob
2. The publisher encodes it for the Walrus network
3. Storage nodes store the resulting pieces
4. Sui tracks the ownership/lifetime side of that write

That is the protocol boundary Dartus is hiding for you in HTTP mode.

## Core Concepts

### Blob ID vs Blob Object ID

Walrus has two identifiers that people mix up constantly.

| Thing | What it identifies | Where it lives |
|------|---------------------|----------------|
| **Blob ID** | The content itself | Walrus storage layer |
| **Blob object ID** | The on-chain ownership object | Sui |

The **blob ID** is content-addressed. Change the data, get a different blob ID. That is why Walrus can make tamper-evidence a core property instead of an afterthought.

The **blob object ID** is a Sui object. That object represents the storage right and metadata side of the write. This is what lets a smart contract ask questions like “does this blob exist?” or “until what epoch is it stored?”

> **WHY THIS MATTERS**: If you only think in terms of blob IDs, direct-mode and ownership APIs will feel strange. If you only think in terms of Sui object IDs, you will miss the fact that Walrus is still content-addressed storage.

### The Four Network Roles

Most Walrus confusion comes from not separating the network roles clearly enough.

#### Storage nodes

Storage nodes are the network itself. They store encoded pieces of blobs and participate in confirmations.

When people say “Walrus is decentralized storage,” this is the part they mean.

#### Publisher

A publisher is an HTTP-facing upload gateway. It accepts a blob from a client, handles the Walrus-side write flow, and pays the write cost from the operator’s side.

That is why HTTP mode in Dartus is so simple. The publisher is absorbing the protocol complexity for you.

#### Aggregator

An aggregator is an HTTP-facing read gateway. It fetches and reconstructs blob data from the network so clients can do a normal `GET /v1/blobs/{id}` style read.

This is why HTTP-mode reads feel like normal web reads even though the underlying storage is distributed.

#### Upload relay

An upload relay is not the same thing as a publisher.

A relay sits in the middle ground. The user still signs and pays through Sui, but the relay handles the heavy upload/distribution side of the write flow. This is useful for dApp-style apps that want wallet-based writes without pushing the entire protocol into the client.

### Why Sui Is Involved At All

Walrus uses Sui because storage in this model is not just “put bytes somewhere.”

Sui tracks:

- who owns the blob object
- how long the blob should remain stored
- WAL-denominated payment and storage reservations
- certification and protocol state
- object-based references that contracts can reason about

That is why the Walrus docs say storage is programmable at the data layer. A blob is not only retrievable content. It is also tied to a Sui-side object model that contracts and apps can interact with.

### Epochs, Committees, and WAL

Walrus is committee-based. Storage nodes evolve between epochs, and WAL is the token used for staking and storage payments.

The practical consequence for app developers is:

- writes are not one-time raw HTTP forever
- committee state matters
- storage is paid for in epochs
- some errors are retryable because the network may be transitioning between epochs

This is exactly why Dartus has things like `SystemStateReader`, `CommitteeResolver`, and retryable error types such as `BehindCurrentEpochError`.

### Why Reads Can Feel Easy While Writes Feel Heavy

This is normal.

Walrus reads can be served through an aggregator, so the client experience can look like normal HTTP. Writes are heavier because they need:

- encoding
- distribution to storage nodes
- confirmations
- storage payment
- certification

That is the whole reason the SDK has three modes. Each mode chooses a different answer to the question:

> How much of the Walrus write path should the client own?

### Public vs Private Data

Walrus is a storage network, not a privacy layer.

If your app uploads plaintext and someone knows the blob ID, they can fetch that data. Private data requires application-layer encryption before upload.

That means the clean mental split is:

- Walrus handles storage, availability, and verifiability
- your app handles secrecy when secrecy matters

Dartus follows that split. It does not pretend Walrus blobs are private by default.

> **GOTCHA**: Developers sometimes hear “ownership” and assume “private by default.” Those are different properties. Ownership is about who controls the on-chain blob object. Privacy is about whether the bytes were encrypted before upload.

## Patterns & Recipes

### Pattern: HTTP Mode For Operator-Pays Products

Use HTTP mode when your product wants the easiest path and is willing to let the app operator absorb storage cost.

This is a good fit for:

- prototypes
- testnet apps
- server-assisted products
- products where the user should never see wallet or storage complexity

### Pattern: Direct Or Relay Mode For User-Pays Products

Use relay or direct mode when the app should not act like a storage sponsor.

That is the path when you want the user to sign and pay using their own wallet, or when the storage flow itself is part of the app’s trust model.

### Pattern: Explain Walrus To Your Team In One Sentence

If you need to explain Walrus quickly inside a product team, use this:

> Walrus stores blobs in a distributed network, but it uses Sui to track who owns them, how long they exist, and whether they were properly certified.

That sentence is usually enough to stop people from treating it like plain object storage.

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Treating blob IDs and blob object IDs as the same thing | Both sound like “the ID of the file” | Keep the split clear: blob ID is content-addressed storage identity, blob object ID is the Sui-side ownership object |
| Assuming publishers and aggregators are protocol nodes | They are gateway roles, not the core storage role | Think of them as convenience interfaces over the network |
| Assuming privacy comes from Walrus itself | Ownership and privacy get mixed together | Encrypt sensitive data before upload; do not rely on the network for secrecy |
| Thinking the relay is just another publisher | Both touch uploads, but the payment/trust model is different | A publisher usually absorbs the storage flow; a relay still works with user-signed writes |
| Ignoring epochs | The network can change across epoch boundaries | Treat retryable network/committee errors as part of the protocol, not random failures |

## API Quick Reference

| Concept in Walrus | Where Dartus exposes it |
|------------------|--------------------------|
| Publisher/aggregator HTTP flow | `WalrusClient` |
| Storage-node reads and writes | `WalrusDirectClient`, `StorageNodeClient` |
| On-chain system state | `SystemStateReader` |
| Committee discovery | `CommitteeResolver` |
| Storage cost calculation | `storageCost()` on direct-mode client |
| User-signed write flow | `WriteBlobFlow`, `WalrusTransactionBuilder` |

## Related

- [Dartus Architecture](architecture)
- [Dartus App Flows](app-flows)
- [Native Layers & BLS](native-layers-and-bls)
- [Dartus — Understanding the Walrus Stack](index)
- [Solana Mobile](../solana-mobile) — useful comparison if you want to contrast “pure chain state” with “chain + decentralized storage” designs
