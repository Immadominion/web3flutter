---
description: Scaffold a Flutter app wired for Solana (RPC plus Mobile Wallet Adapter)
---

Set up a new Flutter app configured for Solana development.

1. Confirm Flutter is installed: `flutter --version`.
2. Create the app if it does not exist: `flutter create <name>`.
3. Add dependencies to pubspec.yaml: `solana: ^0.31.2`, and for Android wallet signing `solana_mobile_client: ^0.1.1`, plus `flutter_secure_storage` and `local_auth` for key storage and gating.
4. Read `skill/solana-dart-sdk.md` for the RpcClient setup and keypair derivation.
5. Read `skill/mobile-wallet-adapter.md` and wire a wallet connect service. Gate every MWA call behind `Platform.isAndroid`.
6. Read `skill/wallet-security.md` and store any local keys encrypted, never in plaintext.
7. Read `skill/transactions.md` before sending anything, and simulate first.

Reference: the solana-flutter skill entry point at `skill/SKILL.md`.
