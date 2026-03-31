# Documentation Writing Style Guide

## Purpose

This guide ensures every documentation page on web3flutterhq maintains a consistent voice, structure, and depth — whether written by a human or AI.

---

## Voice & Tone

### We Are

- **Direct** — Say what something does, not what it "aims to" do
- **Technical but human** — Explain the WHY, not just the HOW
- **Honest about gaps** — If something is undocumented upstream, say so
- **Opinionated when it helps** — "Use Riverpod" is more useful than "you can use any state management"

### We Are NOT

- Academic or formal — No "the aforementioned methodology"
- Condescending — Never "simply do X" (nothing is simple when you're stuck)
- Vague — No "you may want to consider" — say "do this" or "don't do this"
- Fluffy — No filler paragraphs. Every sentence earns its place.

### The Litmus Test
>
> Would this paragraph help a developer at 2am who's debugging a failed transaction?
> If no, rewrite or cut it.

---

## Document Structure

Every documentation page follows this skeleton:

```markdown
# [Technology/Topic Name]

> One-sentence summary of what this is and why you'd use it.

## Overview
2-3 paragraphs max. What is this? When would you reach for it?
If applicable: what's the alternative and why choose this instead?

## Quick Start
Minimum viable code to get something working.
No setup preamble — just the code that matters.

## Core Concepts
### [Concept 1]
Explanation + code + "Why This Matters" callout.

### [Concept 2]
...

## Patterns & Recipes
Real-world usage patterns. Not toy examples — actual patterns
from production apps.

## Common Mistakes
| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
Table format. Quick to scan.

## API Quick Reference
Tables or compact listings for fast lookup.

## Related
Links to other skill files and external resources.
```

---

## Code Examples

### Rules

1. **Every code example must compile** — No pseudo-code, no `...`, no "// rest of your code"
2. **Show imports** — Always include the import statement on first use
3. **Use real types** — `Ed25519HDPublicKey`, not `PublicKey` or `var`
4. **Comment the non-obvious** — Don't comment `// create a client`. DO comment `// 8-byte Anchor discriminator must be skipped`
5. **Show the error case** — If something can fail, show what failure looks like and how to handle it

### Format

```dart
// GOOD: Shows what's happening and why
final pda = await Ed25519HDPublicKey.findProgramAddress(
  seeds: [
    'vault'.codeUnits,           // Must match program's b"vault"
    userPublicKey.bytes,          // 32 bytes of the user's pubkey
  ],
  programId: vaultProgramId,     // The DEPLOYED program ID
);

// BAD: Copy-paste that teaches nothing
final pda = await Ed25519HDPublicKey.findProgramAddress(
  seeds: [seed1, seed2],
  programId: programId,
);
```

---

## Callout Boxes

Use these consistently:

### CRITICAL

For things that will break your app or lose money if ignored.

```markdown
> **CRITICAL**: Never store private keys in SharedPreferences. 
> Use `flutter_secure_storage` with biometric protection.
```

### WHY THIS MATTERS

For explanations that connect code to understanding.

```markdown
> **WHY THIS MATTERS**: Solana accounts must be "rent-exempt" — they need 
> enough SOL deposited to cover 2 years of storage rent. If the balance 
> drops below this threshold, the account gets garbage collected.
```

### GOTCHA

For non-obvious behaviors that waste debugging time.

```markdown
> **GOTCHA**: `getTokenAccountsByOwner` returns ALL token accounts, 
> including those with zero balance. Filter by `amount > 0` in your UI.
```

---

## Naming Conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| File names | kebab-case | `solana-package.md` |
| Page titles | Title Case | `Solana Package Deep Dive` |
| Code variables | Dart conventions | `finalwalletProvider` |
| Program names | As published | `pinocchio-vault` not `Pinocchio Vault` |
| Package refs | Backtick + pub name | `` `solana` `` |

---

## Length Guidelines

| Section | Target Length |
|---------|-------------|
| Overview | 50-150 words |
| Quick Start | Under 30 lines of code |
| Core Concept | 100-300 words + code |
| Common Mistake row | 1-2 sentences per cell |
| Full page | 800-2000 words (excluding code) |

---

## For AI Agents Writing Docs

When generating new documentation pages:

1. **Read existing docs first** — Match the tone and depth of what's already there
2. **Verify code compiles** — Don't invent APIs. Check pub.dev or source code
3. **Include version numbers** — Packages change. Pin the version you're documenting
4. **Link to source** — If you reference a function, link to its pub.dev page or GitHub source
5. **Test your examples** — If you write a code block, mentally trace its execution
6. **Be specific about errors** — "This throws a `FormatException`" not "this might error"

---

*This style guide itself follows its own rules. If something here feels inconsistent, fix it.*
