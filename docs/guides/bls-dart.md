# bls_dart — Native BLS12-381 for Walrus and Sui-Flavored Verification

> `bls_dart` is the native BLS layer behind Dartus direct-mode certification. It is small on purpose: initialize Rust once, then verify or aggregate Walrus-compatible `min_pk` signatures on native Flutter targets.

## Overview

Most Flutter apps do not need a BLS package. They need HTTP, wallets, transactions, and maybe some hashing. `bls_dart` exists because Walrus direct mode has one extra requirement: the client may need to verify storage-node confirmations and compress multiple valid signatures into one aggregate signature that can be used during certification.

That is what this package does. It wraps the `blst` library through `flutter_rust_bridge` and exposes three operations:

- verify a single BLS12-381 `min_pk` signature
- aggregate multiple signatures that signed the same message
- verify an aggregate signature against the set of public keys

It does not do wallet work. It does not create keys. It does not sign. It is a narrow bridge between Walrus/Sui-compatible BLS verification rules and a Dart/Flutter app.

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

  final ok = bls12381MinPkVerify(
    sigBytes: Uint8List(96),
    pkBytes: Uint8List(48),
    msg: Uint8List.fromList('hello'.codeUnits),
  );

  print(ok);
}
```

That example uses dummy zeroed inputs, so verification returns `false`, but it shows the real lifecycle: initialize the native runtime, then call synchronous verification functions.

## Why This Package Exists

Walrus uses BLS signatures in places where a client collects confirmations from multiple storage nodes and needs to condense them into something that can be verified and submitted efficiently. In Dartus, that shows up during direct-mode certification. The client may receive several node confirmations, each with its own public key and signature. Before trusting those confirmations, the app needs to verify them. Before finalizing a certification transaction, it may need to aggregate them.

This is not a place for “close enough” crypto compatibility. Walrus expects the same BLS12-381 `min_pk` conventions and domain separation behavior as Sui Move verification. A library that uses a different variant, different compression assumptions, or a different DST is the sort of thing that looks correct in code review and then fails only when you hit the chain.

## The Runtime Model

`bls_dart` is native. That one fact explains most of its behavior.

The public API looks simple because the real complexity lives underneath:

- `RustLib.init()` bootstraps the generated Rust bridge
- `blst` performs the actual BLS math
- Flutter native build tooling packages the binaries for supported targets

After initialization, the exported verification and aggregation functions are synchronous. That is good for ergonomics, but it also makes one mistake common: agents see synchronous functions and forget that the package still has an asynchronous startup step.

> **GOTCHA**: Call `await RustLib.init()` once near app startup. Do not scatter repeated initialization through feature code unless you deliberately wrap it behind your own idempotent guard.

## What the API Actually Guarantees

The package surface is intentionally small:

| Function | What it does | Failure shape |
| -------- | ------------ | ------------- |
| `bls12381MinPkVerify()` | Verifies one signature against one public key and message | Returns `false` |
| `bls12381MinPkAggregate()` | Aggregates multiple signatures over the same message | Returns empty `Uint8List` on invalid input |
| `bls12381MinPkVerifyAggregate()` | Verifies one aggregate signature against many public keys and one shared message | Returns `false` |

The important part is what the API does **not** promise. It does not validate your app architecture. It will not tell you whether you fed it the wrong message bytes from an upstream protocol step. It will not infer whether a 48-byte array is the right key for the confirmation you think you are checking. It only says whether the given bytes pass the configured verification rules.

## How It Fits Into Dartus

If you are already inside the Walrus flow, the best integration point is not the raw package functions. It is `BlsDartProvider` from Dartus.

```dart
import 'package:bls_dart/bls_dart.dart';
import 'package:dartus/dartus.dart';

Future<void> main() async {
  await RustLib.init();

  final client = WalrusDirectClient.fromNetwork(
    network: WalrusNetwork.testnet,
    blsProvider: const BlsDartProvider(),
  );

  client.close();
}
```

That arrangement buys you two things:

- a stable `BlsProvider` interface inside Dartus
- better failure semantics for aggregation, because `BlsDartProvider.aggregate()` throws when `bls_dart` returns an empty result

There is one subtle point here that matters in practice: adding `BlsDartProvider` does not automatically mean you are in true direct mode. `WalrusDirectClient.fromNetwork()` still prefers the network's upload relay when one is configured. The BLS provider becomes mandatory when you build a no-relay client for direct storage-node certification; in relay mode it is optional but still compatible.

## Platform Boundaries

`bls_dart` is for native Flutter targets: iOS, Android, macOS, Linux, and Windows. Web is out of scope because the underlying `blst` implementation is native C/assembly, not a pure-Dart algorithm.

That limitation is not incidental. It affects product architecture:

- if your app needs browser support, keep BLS work on a native companion app or backend
- if your Flutter app targets desktop/mobile only, `bls_dart` is a clean fit
- if you only need HTTP or relay mode in Walrus, you may not need BLS on the client at all

## Common Failure Patterns

The most common problems are not cryptographic. They are integration mistakes:

1. The app never called `RustLib.init()`.
2. The wrong bytes were passed in as the message.
3. The code assumed `bls_dart` could sign or derive keys.
4. The app was actually running on web.
5. The caller ignored the empty-byte failure contract from `bls12381MinPkAggregate()`.

The pattern to follow is simple: initialize once, keep the crypto calls close to the Walrus protocol boundary, and move the rest of the app through higher-level abstractions like `BlsDartProvider`.

## Related

- [docs/skills/bls-dart.md](../skills/bls-dart.md)
- [docs/skills/dartus.md](../skills/dartus.md)
- [docs/guides/dartus/native-layers-and-bls.md](./dartus/native-layers-and-bls.md)
