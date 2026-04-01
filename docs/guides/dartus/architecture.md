# Dartus Architecture

> Dartus is really three SDKs wearing one package name: an HTTP client, a wallet-aware write client, and a direct protocol client with lazy file readers and native encoding underneath.

## Overview

The easiest way to misunderstand Dartus is to read `lib/dartus.dart` as one flat API. It is not. It is a layered package that grew in phases, and those phases still show up clearly in the source tree.

At the top level, Dartus gives you two main client entry points:

- `WalrusClient` for publisher/aggregator HTTP flows
- `WalrusDirectClient` for relay mode and direct storage-node mode

Everything else in the package exists to support one of those clients: caching, on-chain state reading, transaction building, encoding, lazy file reading, quilts, or certificate handling.

## Quick Start

```dart
import 'package:dartus/dartus.dart';

Future<void> main() async {
  final httpClient = WalrusClient(
    publisherBaseUrl: Uri.parse('https://publisher.walrus-testnet.walrus.space'),
    aggregatorBaseUrl: Uri.parse('https://aggregator.walrus-testnet.walrus.space'),
  );

  final directClient = WalrusDirectClient.fromNetwork(
    network: WalrusNetwork.testnet,
  );

  await httpClient.close();
  directClient.close();
}
```

That is the whole architecture in miniature: one entry point for HTTP mode, one entry point for everything deeper.

## Core Concepts

### Phase 1: `WalrusClient` Is A High-Level HTTP Facade

`WalrusClient` is the simplest client in the package, but it is still doing more than raw endpoint calls.

Its responsibilities are:

- normalize publisher and aggregator URLs
- attach JWT auth when needed
- stream uploads when requested
- cache HTTP reads on disk
- convert non-2xx responses into `WalrusApiError`
- give you a small, Dart-shaped API instead of raw HTTP boilerplate

This is why the class owns a `BlobCache`, a `RequestExecutor`, and a `WalrusLogger`.

#### What happens on HTTP upload

When you call `putBlob()`:

1. Dartus builds Walrus query parameters like `epochs`, `deletable`, and `send_object_to`
2. It adds headers, including `Authorization: Bearer ...` if configured
3. It sends the bytes to `PUT /v1/blobs`
4. It parses the JSON result into a Dart `Map<String, dynamic>`

`putBlobStreaming()` is the same basic flow, except it uses `file.openRead()` and sends a body stream instead of loading the entire file first.

#### What happens on HTTP download

When you call `getBlob(blobId)`:

1. Dartus checks the disk cache first
2. On a hit, it returns the cached bytes immediately
3. On a miss, it fetches from the aggregator
4. It stores the result in cache for later reuse

This part is implemented directly in `WalrusClient`, not hidden in a separate “cache manager” package. That is a good design choice because the cache policy is part of the semantics of HTTP mode.

> **WHY THIS MATTERS**: HTTP mode is not just “easy mode.” It is the mode where Dartus deliberately absorbs the gateway ergonomics: auth headers, cache reuse, streamed upload, error shaping, and destination-file writes.

### Phase 2: `WalrusDirectClient` Is The Real Protocol Client

`WalrusDirectClient` is where the package stops feeling like a web client and starts feeling like a protocol SDK.

Its responsibilities include:

- reading Walrus state from Sui
- discovering committee information
- building Walrus-specific transactions
- handling relay-mode and direct-mode write flows
- reading blobs and slivers from storage nodes
- exposing higher-level file abstractions like `WalrusBlob` and `WalrusFile`

That is why it imports so much more than `WalrusClient`: `SystemStateReader`, `CommitteeResolver`, `WalrusTransactionBuilder`, `UploadRelayClient`, `BlobEncoder`, `StorageNodeClient`, and the file-reader layer.

### Relay Mode vs Direct Mode

Both relay mode and direct mode use `WalrusDirectClient`, but they are not the same thing.

#### Relay mode

In relay mode, the client still owns the wallet/signing side, but the upload relay owns the heavy upload/distribution work.

The flow looks like this:

1. Compute or load blob metadata
2. Build a register transaction
3. Let the wallet sign and execute it
4. Send the raw blob to the relay with the register digest and blob object details
5. Receive a confirmation certificate
6. Build and sign the certify transaction

This mode exists because many apps want user-paid storage without making the client implement every storage-node detail itself.

#### Direct mode

In direct mode, the client goes all the way down:

1. Encode the blob client-side
2. Build the register transaction
3. Let the wallet sign and execute it
4. Write slivers directly to storage nodes
5. Collect confirmations
6. Aggregate/prepare certification data
7. Build and sign the certify transaction

This is the deepest integration path. It is also why Dartus needs native code.

### `WriteBlobFlow` Exists For Wallet UX, Not For Internal Purity

`WriteBlobFlow` is one of the most important design choices in the package.

A lot of SDKs get this wrong: they make the “ideal” API a one-shot method call even though the real wallet flow is multi-step. Dartus does not hide that.

The flow object splits the write into the steps a real app actually needs:

1. `encode()`
2. `register()`
3. `upload()`
4. `certify()`
5. `getBlob()`

That makes it fit real wallet UX instead of forcing every product to reverse-engineer the internal state machine.

> **GOTCHA**: If you are reading the code and wondering why the flow object stores so much intermediate state, the answer is simple: wallets sign transactions at different times, not in one synchronous burst. The object is preserving protocol state across those boundaries.

### File Abstractions: `WalrusBlob`, `WalrusFile`, and The Reader Layer

This is the part people miss if they only skim the package.

Dartus does not only give you “fetch bytes” APIs. It also gives you a reader-based file model:

- `WalrusBlob` represents a stored blob
- `WalrusFile` is a generic file abstraction over a reader
- `BlobReader` lazily fetches blob data and secondary slivers
- `QuiltReader` reads the structure of a quilt blob
- `QuiltFileReader` exposes one file inside a quilt

That means a single Walrus blob can be treated either as:

- one raw file
- or a multi-file quilt with named entries and tags

This is a much better abstraction for app code than forcing every consumer to parse quilt bytes manually.

### Caching and Streaming: Useful, But Be Precise About Them

Dartus does do real caching and streaming, but you should describe them accurately.

#### Caching

The disk cache is part of `WalrusClient` in HTTP mode.

- It stores blobs one-per-file
- Filenames are SHA-256 hashes of blob IDs
- Eviction is LRU by **count**, not by byte size

That last point matters. `maxSize` in `BlobCache` means “number of cached blobs,” not “megabytes on disk.”

#### Streaming uploads

`putBlobStreaming()` is a true streaming upload path. It uses `file.openRead()` so the file does not have to be fully loaded before the request is sent.

#### Streaming downloads

`getBlobAsFileStreaming()` writes response chunks incrementally to disk.

But there is one caveat: it also accumulates those bytes in a `BytesBuilder` so they can be cached afterwards.

So the honest description is:

- uploads stream cleanly from disk
- downloads stream to file
- streamed downloads are **not** fully constant-memory because the implementation still buffers the final bytes for caching

That nuance matters if you are documenting the package for serious mobile engineers.

## Patterns & Recipes

### Pattern: Choose Your Mode By Product Shape

| Product shape | Best Dartus mode | Why |
|--------------|------------------|-----|
| Prototype or operator-sponsored app | HTTP | Lowest setup, no wallet requirement |
| dApp with external wallet signing | Relay | User pays, relay absorbs upload-side complexity |
| Deep protocol integration or infra-heavy client | Direct | Full control over encoding, nodes, and certification |

### Pattern: Use `WalrusBlob` As The Bridge Between Raw Storage And App UX

If your app wants to work with files instead of low-level storage concepts, `WalrusBlob` is the right mental boundary.

It lets app code say:

- “give me the blob as a file”
- “give me the files inside this quilt”
- “does this blob exist?”

That keeps the product code cleaner than passing around raw slivers, patch headers, and node calls.

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Treating `WalrusDirectClient` as just “HTTP mode plus more methods” | The name sounds like a bigger HTTP client | Read it as a protocol client that also coordinates Sui state, transactions, and node writes |
| Assuming `WriteBlobFlow` is unnecessary ceremony | The code looks stateful at first glance | Remember it exists to match real wallet UX boundaries |
| Assuming cache size is byte-based | Many cache APIs use MB/GB limits | In Dartus, `BlobCache.maxSize` is the number of blobs, not total bytes |
| Saying streamed downloads never touch full memory | The method name sounds stronger than the implementation | Be precise: the file is streamed to disk, but bytes are still buffered for caching |
| Thinking quilts are a separate protocol | The term sounds bigger than it is | A quilt is just a structured multi-file blob with an index and patch readers |

## API Quick Reference

| Type | Responsibility |
|------|----------------|
| `WalrusClient` | HTTP publisher/aggregator operations |
| `RequestExecutor` | Shared HTTP request execution with timeout/log hooks |
| `BlobCache` | Disk-backed LRU cache for HTTP reads |
| `WalrusDirectClient` | Relay/direct mode, on-chain state, storage nodes |
| `WriteBlobFlow` | Multi-step wallet-friendly write flow |
| `WalrusBlob` | High-level blob abstraction |
| `WalrusFile` | Generic file abstraction over a reader |
| `BlobReader` | Lazy access to blob bytes and slivers |
| `QuiltReader` | Quilt index parsing and patch access |
| `QuiltFileReader` | One file inside a quilt |

## Related

- [Walrus Mental Model](walrus-mental-model)
- [Dartus App Flows](app-flows)
- [Native Layers & BLS](native-layers-and-bls)
- [Dartus — Understanding the Walrus Stack](index)
