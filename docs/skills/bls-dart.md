# bls_dart — Native BLS12-381 Verification and Aggregation for Flutter

> Use `bls_dart` when your Dart or Flutter app needs Walrus-compatible BLS12-381 `min_pk` verification or aggregation on native platforms.

## Overview

The `bls_dart` package (v0.1.2) exposes three native BLS12-381 operations: verify a single signature, aggregate multiple signatures, and verify an aggregate signature. It is backed by `blst` through `flutter_rust_bridge`, so it runs on native Flutter targets and matches the Sui/Walrus `min_pk` domain separation string.

In practice, you rarely use `bls_dart` as a standalone crypto utility. Its main job in this repo is to back `BlsDartProvider`, which lets `dartus` validate storage-node confirmations and aggregate signatures during Walrus direct-mode certification. If you only do HTTP mode or relay-only writes, you usually do not need this package directly.

**Package links:** [pub.dev/packages/bls_dart](https://pub.dev/packages/bls_dart) / [GitHub](https://github.com/OpenSauceDev/walrus/tree/main/bls_dart)

## Quick Start

```yaml
dependencies:
  bls_dart: ^0.1.2
```

```dart
import 'dart:typed_data';

import 'package:bls_dart/bls_dart.dart';

Future<void> main() async {
  await RustLib.init();

  final isValid = bls12381MinPkVerify(
    sigBytes: Uint8List(96),
    pkBytes: Uint8List(48),
    msg: Uint8List.fromList('hello'.codeUnits),
  );

  print(isValid); // false for zeroed test input
}
```

## Core Concepts

### Initialize the Rust runtime once

Every `bls_dart` call depends on the generated Rust bridge runtime. Initialization is explicit.

```dart
import 'package:bls_dart/bls_dart.dart';

Future<void> main() async {
  await RustLib.init();

  final aggregate = bls12381MinPkAggregate(
    sigsBytes: const [],
  );

  print(aggregate.length); // 0 on invalid input
}
```

> **CRITICAL**: Call `await RustLib.init()` before the first verification or aggregation. Do it once during app startup. Skipping initialization is the fastest way to get runtime failures that look unrelated to your actual signature logic.

### This package verifies and aggregates. It does not sign

`bls_dart` is intentionally narrow. It does not generate keys, sign messages, or manage wallets. It only works with already-produced compressed public keys and signatures.

| Function | Input sizes | Output |
| -------- | ----------- | ------ |
| `bls12381MinPkVerify()` | 96-byte signature, 48-byte public key, message bytes | `bool` |
| `bls12381MinPkAggregate()` | List of 96-byte signatures | 96-byte aggregate signature or empty `Uint8List` |
| `bls12381MinPkVerifyAggregate()` | List of 48-byte public keys, shared message, 96-byte aggregate sig | `bool` |

```dart
import 'dart:typed_data';

import 'package:bls_dart/bls_dart.dart';

Future<void> main() async {
  await RustLib.init();

  final aggregate = bls12381MinPkAggregate(
    sigsBytes: [Uint8List(96), Uint8List(96)],
  );

  final ok = bls12381MinPkVerifyAggregate(
    pksBytes: [Uint8List(48), Uint8List(48)],
    msg: Uint8List.fromList('shared message'.codeUnits),
    aggSigBytes: aggregate,
  );

  print(ok);
}
```

> **GOTCHA**: `bls12381MinPkAggregate()` returns an empty `Uint8List` on invalid input. It does not throw. If you need a throwing API, wrap it or use `dartus` through `BlsDartProvider`, which turns an empty result into `ArgumentError`.

### It matches Walrus and Sui `min_pk`, not arbitrary BLS variants

Walrus certification expects BLS12-381 `min_pk` semantics and the same domain separation string used by Sui Move verification. That is why `bls_dart` is useful here and a generic BLS library may not be.

```dart
import 'dart:typed_data';

import 'package:bls_dart/bls_dart.dart';

Future<void> main() async {
  await RustLib.init();

  final ok = bls12381MinPkVerify(
    sigBytes: Uint8List(96),
    pkBytes: Uint8List(48),
    msg: Uint8List.fromList(<int>[1, 2, 3, 4]),
  );

  print(ok);
}
```

> **WHY THIS MATTERS**: BLS compatibility is not just “same curve.” Public-key placement (`min_pk` vs `min_sig`), compression layout, and DST have to match the verifier on chain. If they do not, verification fails even when the math library itself is correct.

### In Dartus, prefer `BlsDartProvider`

If your real goal is Walrus direct-mode certification, do not scatter raw `bls_dart` calls through the app. Let `dartus` consume it through `BlsDartProvider`.

```dart
import 'package:bls_dart/bls_dart.dart';
import 'package:dartus/dartus.dart';

Future<void> main() async {
  await RustLib.init();

  final provider = const BlsDartProvider();
  final client = WalrusDirectClient.fromNetwork(
    network: WalrusNetwork.testnet,
    blsProvider: provider,
  );

  client.close();
}
```

> **GOTCHA**: `WalrusDirectClient.fromNetwork()` plus `blsProvider` still defaults to relay mode on networks with a default upload relay. The provider is useful there for consistency, but it becomes mandatory when you move into true direct mode with storage-node certification.

## Patterns & Recipes

### Wire it into Walrus direct mode

This is the production path that matters: initialize Rust once, create `BlsDartProvider`, and inject it into a direct-mode `WalrusDirectClient`.

```dart
import 'dart:typed_data';

import 'package:bls_dart/bls_dart.dart';
import 'package:dartus/dartus.dart';
import 'package:sui/sui.dart';

Future<void> main() async {
  await RustLib.init();
  WalrusFfiBindings.configure('/absolute/path/to/libwalrus_ffi.dylib');

  final client = WalrusDirectClient(
    network: WalrusNetwork.testnet,
    suiClient: SuiClient(WalrusNetwork.testnet.defaultRpcUrl),
    encoder: WalrusBlobEncoder(),
    blsProvider: const BlsDartProvider(),
  );

  final signer = SuiAccount.ed25519Account();

  await client.writeBlob(
    blob: Uint8List.fromList('walrus'.codeUnits),
    epochs: 1,
    signer: signer,
    deletable: true,
  );

  client.close();
}
```

### Keep raw verification logic at the edge

If you need to validate a confirmation outside `dartus`, isolate the crypto behind a small wrapper so the rest of the app never depends on `Uint8List(48)` and `Uint8List(96)` conventions directly.

```dart
import 'dart:typed_data';

import 'package:bls_dart/bls_dart.dart';

Future<bool> verifyConfirmation({
  required Uint8List signature,
  required Uint8List publicKey,
  required Uint8List message,
}) async {
  await RustLib.init();
  return bls12381MinPkVerify(
    sigBytes: signature,
    pkBytes: publicKey,
    msg: message,
  );
}
```

## Common Mistakes

| Mistake | Why It Happens | Fix |
| ------- | -------------- | --- |
| Calling BLS functions before `RustLib.init()` | The API functions are synchronous, so agents assume there is no startup lifecycle | Initialize once during app startup before the first verification or aggregation |
| Trying to use `bls_dart` on web | The Dart API looks portable, but the implementation depends on native `blst` binaries | Use it only on iOS, Android, macOS, Linux, or Windows |
| Treating this package as a signer or key-management library | The package name suggests a general BLS toolkit | Bring keys and signatures from elsewhere; `bls_dart` only verifies and aggregates |
| Ignoring empty output from `bls12381MinPkAggregate()` | The function returns an empty byte array on malformed input instead of throwing | Check `result.isEmpty` or use `BlsDartProvider.aggregate()` from `dartus` |
| Using the wrong key or signature sizes | BLS12-381 has multiple encodings and agent memory often drifts from other ecosystems | Use 48-byte compressed G1 public keys and 96-byte compressed G2 signatures only |

## Related

- [docs/guides/bls-dart.md](../guides/bls-dart.md)
- [docs/skills/dartus.md](./dartus.md)
- [pub.dev/packages/bls_dart](https://pub.dev/packages/bls_dart)
- [blst](https://github.com/supranational/blst)
