# Solana Flutter Skill

The first agent skill for building Solana apps in Flutter and Dart.

## The problem

Every Solana agent skill today assumes TypeScript or Rust. There is no coverage for Flutter and Dart, even though Solana Mobile (Saga, Seeker) and Flutter are a real, growing way people ship mobile crypto apps. A coding agent asked to build a Flutter Solana app has no accurate, current reference, so it hallucinates package APIs and wastes the builder's time.

## What this skill does

It gives a coding agent accurate, current, compile-checked guidance for the whole Flutter on Solana stack, loaded progressively so it reads only what the task needs:

- Mobile Wallet Adapter (connect and sign with Phantom, Solflare, and other wallets)
- coral_xyz, the Dart equivalent of the Anchor client
- the solana Dart SDK (RPC, keypairs, PDAs, transactions)
- transaction building, simulation, and failure diagnosis
- SPL tokens and Token-2022
- Metaplex NFTs
- Jupiter swaps
- Light Protocol ZK compression
- AllDomains ANS domain resolution
- wallet security (encrypted key storage, biometrics, salted Argon2id PINs)

Every API name was checked against the pinned package versions on pub.dev.

## Install

Claude Code:

```bash
./install.sh
```

This copies the skill into `~/.claude/skills/solana-flutter`, where Claude Code auto-discovers it. For other agents, copy the `skill/` folder into your agent's skills directory and point it at `skill/SKILL.md`.

## Structure

```
skill/SKILL.md          router entry, loads focused files on demand
skill/*.md              one focused file per topic
commands/               optional Claude Code commands
install.sh              installer
```

## Author

Built by Dominion Nwakanma ([web3flutter.dev](https://www.web3flutter.dev)), maintainer of [coral_xyz](https://pub.dev/packages/coral_xyz) and the Flutter on Solana resource hub. These skills are the agent-skill form of the references published at web3flutter.dev.

## License

MIT
