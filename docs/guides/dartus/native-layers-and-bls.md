# Native Layers & BLS

> Direct mode in Dartus is not pure Dart by design. The package uses native code where protocol correctness and cryptographic performance matter more than keeping the dependency graph aesthetically clean.

## Overview

There are two questions serious readers ask once they see the Dartus source tree:

1. Why is there a `native/walrus_ffi` Rust crate inside a Dart package?
2. Why does Dartus depend on `bls_dart` instead of implementing BLS in Dart directly?

The answer to both is the same: some parts of the Walrus protocol are too correctness-sensitive, too performance-sensitive, or too interoperability-sensitive to fake with a “good enough” Dart reimplementation.

Dartus uses Dart for the API surface, orchestration, and developer ergonomics. It uses native code for canonical Walrus encoding and BLS12-381 operations.

## Quick Start

```dart
import 'package:bls_dart/bls_dart.dart';
import 'package:dartus/dartus.dart';

Future<void> main() async {
  WalrusFfiBindings.configure(
    '/absolute/path/to/libwalrus_ffi.dylib',
  );

  await RustLib.init();

  final directClient = WalrusDirectClient.fromNetwork(
    network: WalrusNetwork.testnet,
  );

  directClient.close();
}
```

That snippet shows the two native boundaries clearly:

- `WalrusFfiBindings` for Walrus encoding/decoding
- `RustLib.init()` from `bls_dart` for BLS native runtime setup

You do **not** need this for HTTP mode. You do need to understand it if you want to understand direct mode honestly.

## Core Concepts

### Why `walrus_ffi` Exists

Direct mode must produce Walrus-compatible encoded output.

That sounds obvious, but it has a deeper implication: the SDK cannot just produce “some Reed-Solomon output.” It has to produce the output the Walrus network expects.

That is why `WalrusBlobEncoder` delegates to `WalrusFfiBindings`, which in turn calls into the native `walrus_ffi` library for:

- metadata computation
- encoding parameter calculation
- full blob encoding
- blob reconstruction/decoding

The docs in `walrus_ffi_bindings.dart` say this directly: the native output is intended to be bit-identical to `walrus-core` / `walrus-wasm`.

> **WHY THIS MATTERS**: “Reed-Solomon” is a category, not a guarantee of interoperability. In a live protocol, byte-for-byte compatibility matters more than algorithm-family similarity.

### Why The Package Searches For Native Libraries In So Many Places

The native library lookup logic is more complex than a typical FFI binding because Flutter apps run in a lot of different environments:

- package source tree during local development
- app bundles on macOS/iOS
- current working directory during CLI runs or tests
- explicit paths supplied by the app
- environment variable overrides

That is why `WalrusFfiBindings` searches in an ordered list rather than assuming one fixed path.

This is not overengineering. It is what happens when you want one package to work in:

- mono-repo development
- Flutter desktop bundles
- test environments
- custom app startup paths

### Why `bls_dart` Exists As A Separate Package

Walrus writes do not stop at “nodes stored my slivers.” The network also needs certification evidence, and BLS signatures are part of that story.

Dartus solves that by depending on `bls_dart`, which is a separate Flutter/Dart plugin wrapping the `blst` library via `flutter_rust_bridge`.

`bls_dart` is not trying to explain BLS as a math tutorial. Its job is much narrower:

- verify a single BLS12-381 min_pk signature
- aggregate signatures
- verify aggregated signatures for a shared message

That is exactly the kind of boundary you want from a support package.

Dartus then uses a `BlsProvider` interface so the main package is not hard-coded to one implementation.

### Where BLS Fits In The Walrus Flow

BLS is not used because “crypto makes storage cooler.” It exists because direct-mode certification needs a compact way to represent confirmations from multiple storage participants.

The mental model is:

1. Slivers get written to storage nodes
2. Nodes produce confirmations
3. Those confirmations need to be represented in a form the on-chain certification step can use
4. BLS aggregation keeps that evidence compact and verifiable

That is why the package has:

- `BlsProvider` in the main SDK
- `BlsDartProvider` as the published implementation
- explicit comments in `WalrusDirectClient` about aggregate signature handling

### What `classic-bls12-382` Is And Is Not

The `classic-bls12-382` folder in this repository is useful context, but it is **not** the runtime BLS engine Dartus depends on.

It is a TypeScript implementation of BLS12-381 primitives and pairing operations. That makes it useful as:

- a reference implementation for understanding the math
- a comparison point for API design
- evidence that the project explored the space beyond “just wrap a native library”

But the actual production path in Dartus is the `bls_dart` plugin, because the runtime goal here is integration and reliability, not shipping an educational pure-Dart or pure-TypeScript pairing engine.

> **GOTCHA**: When people see multiple BLS-related folders, they often assume they are all part of the same runtime path. They are not. For Dartus itself, `bls_dart` is the relevant dependency. `classic-bls12-382` is context, not the direct runtime dependency.

### Why `rust_builder` Exists But Barely Says Anything

The `bls_dart/rust_builder` package looks suspiciously empty because it is not trying to be a human-facing crypto package.

Its job is packaging glue:

- help Flutter build the Rust native layer
- fit into pub.dev’s packaging/publishing constraints
- keep the build chain reproducible across supported platforms

That is why its README basically says “please ignore this folder.” That is not laziness. It is correctly scoped documentation.

### Web Support And Why It Stops Here

`bls_dart` explicitly says web is not supported because `blst` is a native C/assembly library.

That affects the deep end of the Dartus stack too.

The clean way to explain this is:

- **HTTP mode** is the most portable path and is the safest fit for web-style environments
- **Direct mode** depends on native code and is therefore a desktop/mobile/native story, not a universal web story

Trying to explain direct mode as “works everywhere Dart runs” would be dishonest.

## Patterns & Recipes

### Pattern: Treat Native Setup As App Startup Infrastructure

If your app uses direct mode, configure native pieces early.

Do not scatter native init logic across feature code. Put it near app startup and fail fast if the required library is missing.

### Pattern: Keep Your Mental Split Clean

Use this split when reading the source:

- `dartus` = Walrus protocol SDK and orchestration layer
- `bls_dart` = native BLS operations used by that SDK
- `rust_builder` = build glue, not protocol logic
- `classic-bls12-382` = reference code, not the production Dart runtime path

### Pattern: Be Honest About Why Native Exists

Do not frame the native layer as a temporary accident.

In this package, native code exists because the protocol demands byte-for-byte compatibility and practical cryptographic performance. That is a design decision, not a packaging failure.

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| Assuming the Rust layer is only an optimization | Many SDKs use native code as a speed boost, so readers generalize | In Dartus, native encoding is also about canonical protocol compatibility |
| Treating `bls_dart` as unrelated support code | The package name sounds separate from Walrus | Remember it is how Dartus gets practical BLS12-381 operations for certification-related flows |
| Expecting direct mode to be as portable as HTTP mode | The same package supports both, so portability gets overgeneralized | Describe HTTP and direct mode separately when discussing platform expectations |
| Overreading `rust_builder` as part of the crypto API | It lives inside the plugin repo, so it looks important | Treat it as build plumbing, not a conceptual layer of the Walrus protocol |
| Assuming `classic-bls12-382` is what Dartus executes | The repo contains multiple BLS-related folders | Use it as context/reference only; `bls_dart` is the actual Dart-facing runtime dependency |

## API Quick Reference

| Type / package | Responsibility |
|----------------|----------------|
| `WalrusFfiBindings` | Loads and calls the native Walrus encoding library |
| `WalrusBlobEncoder` | Dart-facing encoder built on top of `WalrusFfiBindings` |
| `BlsProvider` | Abstract BLS interface used by Dartus |
| `BlsDartProvider` | Concrete provider backed by `bls_dart` |
| `bls_dart` | Flutter/Dart plugin exposing `blst`-backed BLS operations |
| `rust_builder` | Build/publish glue for the native plugin layer |
| `classic-bls12-382` | Reference TypeScript BLS implementation, not the Dart runtime path |

## Related

- [Dartus Architecture](architecture)
- [Dartus App Flows](app-flows)
- [Walrus Mental Model](walrus-mental-model)
- [Dartus — Understanding the Walrus Stack](index)
