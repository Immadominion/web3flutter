# Solana Flutter Skill

This repo is an agent skill for building Solana apps in Flutter and Dart.

Entry point: `skill/SKILL.md`. It routes to focused topic files under `skill/`. Load only the file relevant to the current task, not all of them.

Stack: Flutter 3.x, Dart 3.x, solana ^0.31.2. Apps that use coral_xyz pin solana ^0.32.0. See `skill/resources.md` for all package versions.

Hard rules: Mobile Wallet Adapter and Seed Vault are Android only. Never log keys or seed phrases. Always simulate a transaction before sending.
