# Dartus App Flows

> What actually happens in your app when you call Dartus: which code runs locally, which requests go over HTTP, which steps touch Sui, and where the hard protocol work is being hidden.

## Overview

A lot of SDK documentation explains APIs but never explains execution.

That is a problem for Dartus, because the package is doing very different things depending on the mode you choose. In one path, your app is basically talking to a publisher over HTTP. In another, it is building Sui transactions, encoding blob metadata, writing slivers to storage nodes, and managing certification state.

This page is the “what actually happens” view.

## Quick Start

```dart
import 'package:dartus/dartus.dart';

Future<void> main() async {
  final client = WalrusClient(
    publisherBaseUrl: Uri.parse('https://publisher.walrus-testnet.walrus.space'),
    aggregatorBaseUrl: Uri.parse('https://aggregator.walrus-testnet.walrus.space'),
  );

  final response = await client.putBlob(data: 'hello'.codeUnits);
  final blobId = response['newlyCreated']?['blobObject']?['blobId']
      ?? response['alreadyCertified']?['blobId'];

  final bytes = await client.getBlob(blobId);
  print(String.fromCharCodes(bytes));

  await client.close();
}
```

That is the shortest “app flow” Dartus supports. Everything else in this page explains how the other flows get more complex from there.

## Core Concepts

### Flow 1: HTTP Upload

When a Flutter app calls `WalrusClient.putBlob()` with in-memory bytes:

1. Dartus builds the Walrus upload URL and query parameters
2. It sets standard headers, and auth headers if a JWT is configured
3. It sends the bytes to the publisher
4. The publisher handles the Walrus-side write work
5. Dartus parses the JSON response and returns it as a Dart map

The important thing to understand is what **does not** happen in your app in this mode:

- no client-side erasure coding
- no storage-node fanout
- no Sui transaction building
- no BLS handling

That work is being absorbed by the publisher side of the system.

> **WHY THIS MATTERS**: HTTP mode feels small because your app is outsourcing most of the protocol work. That is the point of the mode, not a limitation of the SDK.

### Flow 2: HTTP Download With Cache

When a Flutter app calls `WalrusClient.getBlob(blobId)`:

1. Dartus checks the disk cache first
2. If the blob is present, it returns cached bytes
3. If not, it requests the blob from the aggregator
4. It reads the response body
5. It writes the bytes into the cache
6. It returns the bytes to the app

If the app calls `getBlobAsFile()` instead, the last step changes from “return bytes” to “write bytes to destination path.”

If the app calls `getBlobAsFileStreaming()`, the response body is written incrementally to the destination file as chunks arrive.

### Flow 3: Relay-Mode Write

Relay mode is the first place where the app starts participating in the real Walrus write flow.

The usual path looks like this:

1. Your app creates a `WalrusDirectClient`
2. It creates a `WriteBlobFlow`
3. `encode()` computes metadata needed for the write
4. `register()` builds a Sui transaction for blob registration
5. The wallet signs and executes that transaction
6. `upload()` sends the raw blob plus register context to the upload relay
7. The relay handles encoding/distribution and returns a certificate
8. `certify()` builds the follow-up certification transaction
9. The wallet signs and executes that transaction
10. `getBlob()` returns the final result information

This is the right flow for apps that want user-paid writes but do not want the client to own all node-distribution logic.

### Flow 4: Direct-Mode Write

Direct mode is the most honest picture of what Walrus writing really involves.

When an app takes the direct path, the client itself is responsible for much more:

1. Resolve or inject committee information
2. Encode the blob into Walrus-compatible slivers using `WalrusBlobEncoder`
3. Build and sign the registration transaction on Sui
4. Send slivers to the right storage nodes
5. Collect confirmations from those nodes
6. Build the certification data
7. Build and sign the certification transaction
8. Resolve the final blob/object result

This is why `WalrusDirectClient` imports so many more subsystems than `WalrusClient`. In direct mode, your app is much closer to the protocol boundary.

### Flow 5: Direct Read And Lazy File Access

The read side of direct mode is also worth understanding, because it is not just “fetch bytes.”

When the app calls `WalrusDirectClient.getBlob(blobId: ...)`, Dartus returns a `WalrusBlob` backed by a `BlobReader`.

That means the app gets a lazy object rather than eagerly loading everything.

From there, the app can choose:

- `blob.asFile()` for one-file behavior
- `blob.files()` for quilt-aware multi-file behavior
- `blob.exists()` or `blob.storedUntil()` for status-oriented checks

This is a very different design from the HTTP client, which mostly gives you bytes and files directly.

### Flow 6: Quilt Reads

Quilts are how Dartus represents multiple logical files inside one Walrus blob.

The quilt path looks like this:

1. A `BlobReader` exposes blob/sliver access
2. A `QuiltReader` uses that reader to parse the quilt index
3. For each patch entry, Dartus creates a `QuiltFileReader`
4. The app interacts with those as normal `WalrusFile` instances

That is a good abstraction because app code can ask for “files in this blob” instead of caring about patch headers, sliver offsets, or index layouts.

### What Runs Locally vs What Runs Remotely

This is the cleanest way to explain the package to another engineer.

| Step | Local in app | Remote service / network |
|------|---------------|--------------------------|
| HTTP upload | request shaping, auth headers | publisher handles actual Walrus-side write |
| HTTP read | cache check, file writing | aggregator reconstructs and serves blob |
| Relay registration | transaction building | Sui executes signed transaction |
| Relay upload | request shaping | relay handles encode/distribute/certificate gathering |
| Direct encoding | `WalrusBlobEncoder` + native FFI | none |
| Direct storage writes | node selection + request orchestration | storage nodes accept slivers and return confirmations |
| Certification | transaction building | Sui executes signed certification transaction |

That table is really the whole package in one view.

## Patterns & Recipes

### Pattern: Explain The SDK To Product Engineers Using The Smallest Accurate Story

If you need to explain Dartus to someone who does not want a protocol lecture, use this:

- HTTP mode: app talks to publisher/aggregator
- Relay mode: app and wallet own the on-chain steps, relay owns the heavy upload step
- Direct mode: app owns the real protocol path itself

That is short, accurate, and enough to get everyone on the same page.

### Pattern: Use The Flow Object When Wallet UX Matters

If a product has an external wallet, do not try to flatten the whole write path into one magic method call.

`WriteBlobFlow` already models the actual boundaries where the user signs, the network responds, and the next step becomes possible.

### Pattern: Use Reader Abstractions For App Code

If your app wants to treat Walrus content as files rather than protocol artifacts, stay at the `WalrusBlob` / `WalrusFile` level for as long as possible.

That keeps product code focused on content and keeps sliver/index details inside the SDK where they belong.

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Explaining all three modes as if they do the same work with different names | The same package exposes them all | Explain them in terms of responsibility: who pays, who encodes, who talks to nodes |
| Assuming direct mode is just a faster relay mode | Both are deeper than HTTP mode, so they get blurred together | Keep the key difference clear: direct mode owns encoding and node writes locally |
| Thinking `getBlob()` and `getBlob(blobId)` mean the same thing across clients | Both client types have blob read APIs, but with different abstractions | Distinguish HTTP bytes/file APIs from direct-mode lazy reader APIs |
| Treating quilts as just “zip files” | That metaphor is useful but incomplete | Remember quilts are structured multi-file blobs with an index and patch readers |

## API Quick Reference

| Flow stage | Main types |
|-----------|------------|
| HTTP upload/download | `WalrusClient`, `RequestExecutor`, `BlobCache` |
| Wallet-friendly write flow | `WriteBlobFlow`, `WalrusTransactionBuilder` |
| Relay upload | `UploadRelayClient` |
| Direct encoding | `WalrusBlobEncoder`, `WalrusFfiBindings` |
| Storage-node reads/writes | `WalrusDirectClient`, `StorageNodeClient` |
| Lazy content reading | `WalrusBlob`, `WalrusFile`, `BlobReader`, `QuiltReader`, `QuiltFileReader` |

## Related

- [Dartus Architecture](architecture)
- [Walrus Mental Model](walrus-mental-model)
- [Native Layers & BLS](native-layers-and-bls)
- [Dartus — Understanding the Walrus Stack](index)
