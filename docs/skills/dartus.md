# dartus — Walrus Storage SDK for Dart & Flutter

> Use `dartus` when a Dart or Flutter app needs Walrus uploads, downloads, blob ownership on Sui, or direct storage-node writes without translating TypeScript SDK patterns by hand.

## Overview

The `dartus` package (v0.2.0) is the Dart/Flutter SDK for Walrus. It exposes three distinct operating modes behind one package: HTTP mode with `WalrusClient`, relay-backed wallet writes with `WalrusDirectClient`, and full direct mode with local encoding plus storage-node interaction. That split matters because the wrong mode choice changes who pays, what native libraries are required, and whether you are talking to publisher/aggregator endpoints or to storage nodes plus Sui.

Use `dartus` instead of raw HTTP calls when you need correct Walrus request shapes, cache behavior, blob/object ID handling, and Sui transaction building. Use it instead of copying examples from the TS SDK when you are in Flutter, because the Dart API surface is similar in intent but not identical in defaults or setup.

**Package links:** [pub.dev/packages/dartus](https://pub.dev/packages/dartus) / [GitHub](https://github.com/OpenSauceDev/walrus/tree/main/Dartus)

## Quick Start

```yaml
dependencies:
  dartus: ^0.2.0
```

```dart
import 'dart:typed_data';

import 'package:dartus/dartus.dart';

Future<void> main() async {
  final client = WalrusClient(
    publisherBaseUrl: Uri.parse(
      'https://publisher.walrus-testnet.walrus.space',
    ),
    aggregatorBaseUrl: Uri.parse(
      'https://aggregator.walrus-testnet.walrus.space',
    ),
  );

  final response = await client.putBlob(
    data: Uint8List.fromList('Hello Walrus'.codeUnits),
    epochs: 1,
    deletable: true,
  );

  String? blobId;
  final newlyCreated = response['newlyCreated'];
  if (newlyCreated is Map<String, dynamic>) {
    final blobObject = newlyCreated['blobObject'];
    if (blobObject is Map<String, dynamic>) {
      blobId = blobObject['blobId'] as String?;
    }
  }
  blobId ??= response['blobId'] as String?;

  if (blobId == null) {
    throw StateError('Upload response did not contain a blobId');
  }

  final bytes = await client.getBlob(blobId);
  print(String.fromCharCodes(bytes));

  await client.close();
}
```

## Core Concepts

### Pick the mode first

`dartus` is not one transport. It is three:

| Mode | Primary Class | Who Pays | Network Path | Use It For |
| ---- | ------------- | -------- | ------------ | ---------- |
| HTTP | `WalrusClient` | Publisher/operator | Publisher + aggregator HTTP endpoints | Public uploads/downloads, backend services, simple Flutter apps |
| Relay | `WalrusDirectClient` | End user wallet | Upload relay + Sui transactions | User-paid writes without running full direct storage-node logic |
| Direct | `WalrusDirectClient` | End user wallet | Sui + storage nodes + local encoding | Full Walrus-native writes, certification, advanced clients |

```dart
import 'dart:typed_data';

import 'package:dartus/dartus.dart';
import 'package:sui/sui.dart';

Future<void> main() async {
  final signer = SuiAccount.ed25519Account();

  final relayClient = WalrusDirectClient.fromNetwork(
    network: WalrusNetwork.testnet,
  );

  final result = await relayClient.writeBlob(
    blob: Uint8List.fromList('wallet-paid upload'.codeUnits),
    epochs: 1,
    signer: signer,
    deletable: true,
  );

  print(result.blobId);
  print(result.blobObjectId);

  relayClient.close();
}
```

> **CRITICAL**: `WalrusDirectClient.fromNetwork()` auto-configures the network's default upload relay when one exists. On testnet, that means `writeBlob()` uses relay mode unless you build the client with the primary constructor and leave `uploadRelayConfig` unset. Do not assume `fromNetwork()` plus `WalrusBlobEncoder()` is true direct mode.

### Blob IDs and object IDs are different identifiers

Walrus uses URL-safe base64 blob IDs for stored data and Sui `0x...` object IDs for on-chain blob objects. Some methods accept one, some the other, and some will resolve either.

```dart
import 'package:dartus/dartus.dart';

Future<void> main() async {
  final client = WalrusDirectClient.fromNetwork(
    network: WalrusNetwork.testnet,
  );

  final blobId = await client.resolveBlobId(
    '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  );

  final blob = await client.getBlob(blobId: blobId);
  final file = blob.asFile();
  print(await file.text());

  client.close();
}
```

Use these rules:

| Method | Expects | Notes |
| ------ | ------- | ----- |
| `WalrusClient.getBlob()` | blob ID | HTTP download via aggregator, cached |
| `WalrusClient.getBlobByObjectId()` | object ID | HTTP convenience, not cached |
| `WalrusDirectClient.resolveBlobId()` | blob ID or object ID | Normalizes before direct reads |
| `WalrusDirectClient.readBlobAttributes()` | object ID | Reads on-chain blob object attributes |

> **GOTCHA**: `readBlobAttributes()` needs the Sui object ID, not the base64 blob ID. The opposite is true for `getBlob()` and most direct reads. If you only have `0x...`, call `resolveBlobId()` before reading blob bytes.

### HTTP mode has real disk caching, with specific limits

`WalrusClient` caches blobs one-per-file through `BlobCache`. The cache key is the blob ID, the filename is a SHA-256 hash of that ID, and `maxSize` is a count of blobs, not bytes.

```dart
import 'dart:io';

import 'package:dartus/dartus.dart';

Future<void> main() async {
  final client = WalrusClient(
    publisherBaseUrl: Uri.parse(
      'https://publisher.walrus-testnet.walrus.space',
    ),
    aggregatorBaseUrl: Uri.parse(
      'https://aggregator.walrus-testnet.walrus.space',
    ),
    cacheDirectory: await Directory.systemTemp.createTemp('dartus-cache-'),
    cacheMaxSize: 50,
  );

  final destination = File('${client.cache.directory.path}/preview.bin');

  await client.getBlobAsFileStreaming(
    blobId: 'replace-with-a-real-blob-id',
    destination: destination,
  );

  print(destination.path);
  await client.close();
}
```

Important behavior:

| Operation | Uses cache on read | Populates cache |
| --------- | ------------------ | --------------- |
| `getBlob()` | Yes | Yes |
| `getBlobAsFile()` | Yes | Yes |
| `getBlobAsFileStreaming()` | Yes | Yes |
| `getBlobByObjectId()` | No | No |

> **WHY THIS MATTERS**: `getBlobAsFileStreaming()` writes incrementally to disk, but it still buffers the final bytes in memory so it can populate the cache afterward. Do not treat it as a zero-memory streaming path for very large blobs.

### True direct mode requires native encoding, and usually BLS

Direct mode is not just `WalrusDirectClient`. You need a client with no relay configured, a `WalrusBlobEncoder`, the Walrus native FFI library loaded through `WalrusFfiBindings.configure()`, and a `BlsProvider` if you want correct multi-signature certification.

```dart
import 'dart:typed_data';

import 'package:bls_dart/bls_dart.dart';
import 'package:dartus/dartus.dart';
import 'package:sui/sui.dart';

Future<void> main() async {
  await RustLib.init();
  WalrusFfiBindings.configure('/absolute/path/to/libwalrus_ffi.dylib');

  final signer = SuiAccount.ed25519Account();

  final client = WalrusDirectClient(
    network: WalrusNetwork.testnet,
    suiClient: SuiClient(WalrusNetwork.testnet.defaultRpcUrl),
    encoder: WalrusBlobEncoder(),
    blsProvider: const BlsDartProvider(),
  );

  final result = await client.writeBlob(
    blob: Uint8List.fromList('direct mode'.codeUnits),
    epochs: 1,
    signer: signer,
    deletable: true,
  );

  print(result.blobId);
  client.close();
}
```

> **CRITICAL**: Without `WalrusFfiBindings.configure()`, `WalrusBlobEncoder` throws. Without a `BlsProvider`, direct-mode certification falls back to the first valid signature, which is acceptable for relay mode or testing but not for production-grade multi-signer direct certification.

## Patterns & Recipes

### Public app with operator-paid reads and writes

Use `WalrusClient`. Upload through the publisher, download through the aggregator, and keep `BlobCache` enabled. This is the right path for media previews, public attachments, or backend jobs where the app is not expected to spend user WAL.

```dart
import 'dart:typed_data';

import 'package:dartus/dartus.dart';

Future<void> main() async {
  final client = WalrusClient(
    publisherBaseUrl: Uri.parse(
      'https://publisher.walrus-testnet.walrus.space',
    ),
    aggregatorBaseUrl: Uri.parse(
      'https://aggregator.walrus-testnet.walrus.space',
    ),
  );

  client.setJwtToken('replace-with-real-jwt-if-required');

  await client.putBlob(
    data: Uint8List.fromList('operator paid'.codeUnits),
    epochs: 1,
    deletable: true,
  );

  await client.close();
}
```

### Wallet-owned writes where the app signs transactions itself

Use relay mode through `WalrusDirectClient.fromNetwork()`. Persist both the `blobId` and the `blobObjectId`: the first is what you read with later, the second is what you inspect or mutate on chain.

```dart
import 'dart:typed_data';

import 'package:dartus/dartus.dart';
import 'package:sui/sui.dart';

Future<void> main() async {
  final signer = SuiAccount.ed25519Account();
  final client = WalrusDirectClient.fromNetwork(
    network: WalrusNetwork.testnet,
  );

  final result = await client.writeBlob(
    blob: Uint8List.fromList('store both IDs'.codeUnits),
    epochs: 1,
    signer: signer,
    deletable: true,
  );

  print('blobId=${result.blobId}');
  print('blobObjectId=${result.blobObjectId}');

  client.close();
}
```

### Lazy reads for quilts and multi-file blobs

When you want file-level access, read through `WalrusDirectClient.getBlob()` and then use `WalrusBlob.files()`. Do not try to apply HTTP cache assumptions to these file abstractions; they are backed by direct readers.

```dart
import 'package:dartus/dartus.dart';

Future<void> main() async {
  final client = WalrusDirectClient.fromNetwork(
    network: WalrusNetwork.testnet,
  );

  final blob = await client.getBlob(
    blobId: 'replace-with-a-real-quilt-blob-id',
  );

  final files = await blob.files();
  for (final file in files) {
    print(await file.getIdentifier());
  }

  client.close();
}
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
| ------- | -------------- | --- |
| Using `WalrusDirectClient.fromNetwork()` and assuming that means direct storage-node writes | The convenience constructor auto-injects the network's upload relay when one exists | For true direct mode, use `WalrusDirectClient(...)` directly and omit `uploadRelayConfig` |
| Passing a blob ID to `readBlobAttributes()` | Agents conflate blob IDs and Sui object IDs | Pass the `blobObjectId` for on-chain attribute reads, or call `resolveBlobId()` when you need blob bytes |
| Treating `getBlobByObjectId()` as equivalent to `getBlob()` | Both download bytes, but only one participates in HTTP cache semantics | Use `getBlob()` for cacheable reads and use `getBlobByObjectId()` only when you truly only have the object ID |
| Forgetting to close clients | `WalrusClient` owns an HTTP client and temp cache, and `WalrusDirectClient` keeps storage-node connections | Call `await client.close()` for `WalrusClient` and `client.close()` for `WalrusDirectClient` |
| Enabling direct mode without configuring Walrus FFI or BLS | The direct client API surface looks similar to relay mode, so agents skip the native prerequisites | Load the native Walrus library with `WalrusFfiBindings.configure()`, add `WalrusBlobEncoder()`, and provide `BlsDartProvider()` for production direct certification |

## Related

- [docs/guides/dartus/index.md](../guides/dartus/index.md)
- [docs/guides/dartus/app-flows.md](../guides/dartus/app-flows.md)
- [docs/skills/bls-dart.md](./bls-dart.md)
- [pub.dev/packages/dartus](https://pub.dev/packages/dartus)
- [Walrus docs](https://docs.wal.app)
