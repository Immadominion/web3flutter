# Resources and Package Versions

## Packages

| Package | Version | Purpose |
|---------|---------|---------|
| solana | ^0.31.2 | Core SDK: RPC, keypairs, PDAs, transactions, SPL, Metaplex |
| coral_xyz | ^1.0.0-beta.9 | Anchor client for Dart. Depends on solana ^0.32.0 |
| solana_mobile_client | ^0.1.1 | Mobile Wallet Adapter, dApp side. Android only |
| light_sdk | ^0.1.0-beta.1 | Light Protocol ZK compression. Helius RPC required |
| tld_parser | ^0.1.0 | AllDomains ANS domain resolution |
| flutter_secure_storage | ^9.2.2 | Encrypted key storage |
| local_auth | ^2.3.0 | Biometric gating |
| cryptography | ^2.7.0 | Argon2id PIN hashing |
| encrypt | ^5.0.3 | AES-256-CBC |

Version note: coral_xyz beta.9 pins solana ^0.32.0. Apps that use coral_xyz should pin solana ^0.32.0. Apps without coral_xyz can stay on ^0.31.2. All API names in this skill were checked against these versions on pub.dev.

## Links

- web3flutter.dev (source of these skills): https://www.web3flutter.dev
- coral_xyz: https://pub.dev/packages/coral_xyz
- solana (Espresso Cash): https://pub.dev/packages/solana
- solana_mobile_client: https://pub.dev/packages/solana_mobile_client
- light_sdk: https://pub.dev/packages/light_sdk
- tld_parser: https://pub.dev/packages/tld_parser
- Solana Mobile docs: https://docs.solanamobile.com
- jupiter_aggregator source: https://github.com/espresso-cash/espresso-cash-public/tree/master/packages/jupiter_aggregator
- Jupiter developer docs: https://dev.jup.ag
