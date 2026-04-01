# Dartus — Understanding the Walrus Stack

> A deep dive into what Dartus wraps, why the SDK has three modes, and why a Flutter app ends up talking to HTTP gateways, storage nodes, Sui, and native libraries.

## Overview

`dartus` is not just “a storage client for Flutter.” It is a translation layer between Dart apps and a storage protocol that has three different access models:

- Web2-style HTTP gateways
- Wallet-signed writes through Sui
- Direct storage-node interaction with canonical erasure coding

That is why the package feels bigger than a normal upload/download SDK. It is wrapping Walrus itself, and Walrus is not one thing. It is a storage network, an on-chain coordination layer on Sui, and a set of service-provider APIs for publishers, aggregators, relays, and storage nodes.

If you only want to *use* Dartus, the package README is enough. This guide set is for the other kind of reader: the person who wants to understand why the package is shaped this way, what each layer is responsible for, and where the complexity actually lives.

## Quick Start

```dart
import 'package:dartus/dartus.dart';

Future<void> main() async {
  final client = WalrusClient(
    publisherBaseUrl: Uri.parse('https://publisher.walrus-testnet.walrus.space'),
    aggregatorBaseUrl: Uri.parse('https://aggregator.walrus-testnet.walrus.space'),
  );

  final response = await client.putBlob(data: 'hello walrus'.codeUnits);
  final blobId = response['newlyCreated']?['blobObject']?['blobId']
      ?? response['alreadyCertified']?['blobId'];

  final bytes = await client.getBlob(blobId);
  print(String.fromCharCodes(bytes));

  await client.close();
}
```

That example only uses HTTP mode, but it already shows the core design decision of the SDK: Dartus tries to make Walrus feel like a Dart package first, not like a pile of raw endpoints.

## Core Concepts

### Walrus Is Two Systems At Once

Walrus looks simple from the outside: upload a blob, get an ID, read the blob back.

Under the hood, it is two systems working together:

1. **A storage network** made of storage nodes, publishers, aggregators, and optional upload relays.
2. **An on-chain coordination layer on Sui** that tracks ownership, certification, storage duration, and WAL-denominated payments.

That is why Dartus has both HTTP classes like `WalrusClient` and on-chain/storage-node classes like `WalrusDirectClient`, `SystemStateReader`, and `WalrusTransactionBuilder`.

> **WHY THIS MATTERS**: If you think Walrus is “just decentralized S3,” Dartus will feel overbuilt. If you understand that Walrus storage and Sui coordination are inseparable, the package structure starts making sense.

### Dartus Is Layered, Not Monolithic

The top-level export file in `lib/dartus.dart` is organized by phases, and that is not cosmetic. It reflects how the SDK actually grew:

| Phase | What it adds | Main types |
|-------|--------------|------------|
| Phase 1 | HTTP publisher/aggregator access | `WalrusClient`, `BlobCache`, `WalrusApiError` |
| Phase 2 | Wallet-aware writes and upload relay support | `WalrusDirectClient`, `WriteBlobFlow`, `UploadRelayClient`, `WalrusTransactionBuilder` |
| Phase 3 | Full client-side encoding and storage-node access | `WalrusBlobEncoder`, `StorageNodeClient`, `BlobReader`, `QuiltReader` |
| Phase 4 | BLS signature aggregation and verification | `BlsProvider`, `BlsDartProvider` |

Each later phase depends on the ones before it. That is why the simplest production use case is still HTTP mode, while the deepest integration uses most of the package.

### The Three Modes Exist Because Walrus Has Three Cost Models

Dartus supports HTTP, Relay, and Direct mode because Walrus has three real trust/payment models.

- **HTTP mode**: the publisher operator pays the storage cost. Your app gets the easiest integration.
- **Relay mode**: the user signs and pays on Sui, but a relay still handles the heavy upload-side work.
- **Direct mode**: the client does the full protocol work itself, including encoding and writing slivers to storage nodes.

This is not feature duplication. It is the SDK exposing three valid product architectures.

### Native Code Is Not Optional In The Deep End

Once you move beyond HTTP mode, Dartus stops being “pure Dart everywhere.” That is not a stylistic choice.

Direct mode needs canonical Walrus encoding. BLS certificate handling needs performant native crypto. That is why the package ships with `native/walrus_ffi` and why it depends on `bls_dart` for BLS12-381 work.

The right mental model is:

- Dart owns the developer experience
- Rust owns the protocol-sensitive math

## Patterns & Recipes

### Pattern: Read This Guide Set In Order

If you want to understand the package deeply, read the pages in this order:

1. **Walrus Mental Model** — what the network is actually doing
2. **Dartus Architecture** — how the SDK maps those concepts into Dart types
3. **Dartus App Flows** — what happens in a real mobile or desktop app call
4. **Native Layers & BLS** — why the package stops being pure Dart in direct mode

That order matters. People usually get confused when they jump straight into `WalrusDirectClient` without understanding blob IDs, object IDs, committees, and WAL.

### Pattern: Think In Terms Of Responsibility Boundaries

When you read the source, ask one question over and over:

> Which layer is responsible for this?

Examples:

- `WalrusClient` is responsible for HTTP ergonomics, not protocol math
- `WalrusBlobEncoder` is responsible for canonical encoding, not wallet UX
- `UploadRelayClient` is responsible for relay HTTP, not transaction building
- `BlsDartProvider` is responsible for signature operations, not certificate policy

That framing prevents the common mistake of judging the package as if it were one giant client class.

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Treating Dartus like one API surface | The package exports a lot from one barrel file, so everything looks equally “top level” | Read it as layers: HTTP, wallet+relay, direct mode, then native crypto |
| Assuming Walrus writes are always just HTTP uploads | That is only true in publisher mode | Separate “operator pays through publisher” from “user pays through Sui” in your mental model |
| Thinking the native pieces are optional everywhere | They are optional for HTTP mode, not for deep direct-mode features | Use `WalrusClient` if you want a pure HTTP path; expect native dependencies in direct mode |
| Confusing blob IDs with Sui object IDs | Walrus uses both, and they solve different problems | Read the Walrus mental-model page before touching the direct-mode APIs |

## API Quick Reference

| Type | What it actually does |
|------|------------------------|
| `WalrusClient` | HTTP client for publisher/aggregator flows |
| `BlobCache` | Disk-backed LRU cache for HTTP blob reads |
| `WalrusDirectClient` | Wallet-aware client for relay and direct mode |
| `WriteBlobFlow` | Stepwise write flow for external wallet signing |
| `UploadRelayClient` | Talks to an upload relay over HTTP |
| `WalrusTransactionBuilder` | Builds Walrus-specific Sui PTBs |
| `WalrusBlobEncoder` | Canonical Walrus encoding via Rust FFI |
| `BlobReader` / `QuiltReader` | Lazy readers for blobs and quilt-packed files |
| `BlsDartProvider` | Native BLS12-381 operations via `bls_dart` |

## Related

- [Walrus Mental Model](walrus-mental-model)
- [Dartus Architecture](architecture)
- [Dartus App Flows](app-flows)
- [Native Layers & BLS](native-layers-and-bls)
- [Solana Package](../solana-package) — useful background if you want a comparison point for how another chain SDK is layered
