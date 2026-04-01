# Skill File Authoring Guide

> This guide is for AI models tasked with writing new skill files for web3flutterhq. Follow it exactly so the content works on the website, in agent context windows, and as standalone documentation — all without modification.

---

## What Is a Skill File?

A skill file is a Markdown document that teaches AI coding agents how to use a specific Dart/Flutter package or pattern for Web3 development on Solana. It's consumed by AI agents via `fetch_webpage` or direct file read as context for code generation.

**Skills are NOT the same as docs.** The `/docs` page at web3flutter.dev serves human-facing guides from `docs/guides/`. Skill files live in `docs/skills/` and are served via the `/api/skills/` API for bots. They can overlap in topic, but the audience and tone are different:

| | Skills (`docs/skills/`) | Guides (`docs/guides/`) |
|---|---|---|
| **Audience** | AI coding agents | Human developers |
| **Served via** | `/api/skills/{slug}` (raw text) | `/docs` page (rendered HTML) |
| **Tone** | Terse, structured, code-heavy | Narrative, explains WHY, teaches mental models |
| **Goal** | Enable correct code generation | Enable human understanding |

---

## File Location & Naming

```
docs/skills/{slug}.md
```

- Use **kebab-case** for the filename: `solana-package.md`, `wallet-ux.md`
- The slug must be added to the API allowlist in `src/app/api/skills/[slug]/route.ts`
- The slug must be added to the manifest in `src/app/docs/page.tsx`

---

## Guide File Location & Structure

Human-facing guides live in `docs/guides/` and support two formats:

### Single-file guides (simple topics)

```
docs/guides/{slug}.md
```

### Multi-section guides (complex topics)

```
docs/guides/{slug}/
├── index.md               ← overview / intro
├── {section-slug-1}.md    ← section 1
├── {section-slug-2}.md    ← section 2
└── ...
```

Use multi-section when a topic has 3+ distinct subtopics that each warrant their own page. For example, `coral-xyz` has sections for IDL basics, serialization, account resolution, and events.

When using multi-section, declare the sections in the `DOC_MANIFEST` in `src/app/docs/page.tsx`:

```typescript
{
    slug: "coral-xyz",
    title: "coral_xyz",
    description: "...",
    category: "Core",
    sections: [
        { slug: "idl-basics", title: "IDL Basics" },
        { slug: "serialization", title: "Serialization" },
        { slug: "account-resolution", title: "Account Resolution" },
        { slug: "events-and-interface", title: "Events & Interface" },
    ],
},
```

---

## Required Structure

Every skill file must follow this exact skeleton:

```markdown
# {Package/Topic Name} — {One-Phrase Summary}

> {One sentence: what this is and when you'd use it.}

## Overview

{2-3 paragraphs. What is this package/pattern? When would you reach for it?
If there's an alternative, explain why choose this instead.}

## Quick Start

{Minimum viable code. pubspec.yaml dependency + the simplest working example.
No preamble — just code that compiles.}

## Core Concepts

### {Concept 1}

{Explanation + code example + callout box}

### {Concept 2}

{...}

## Patterns & Recipes

{Real-world usage patterns pulled from production apps.
Not toy examples.}

## Common Mistakes

| Mistake | Why It Happens | Fix |
|---------|---------------|-----|
| ... | ... | ... |

## Related

- {Links to other skill files}
- {Links to pub.dev, GitHub, or external docs}
```

---

## Writing Rules

### Voice

- **Direct**. Say "do this" not "you may want to consider".
- **Technical but human**. Explain WHY, not just HOW.
- **Honest**. If something is undocumented or broken upstream, say so.
- No filler. Every sentence earns its place.

### The Litmus Test

> Would this paragraph help a developer at 2am debugging a failed transaction?
> If no, rewrite or cut it.

### Code Examples

1. **Must compile** — No pseudo-code, no `...`, no `// rest of your code`
2. **Show imports** — Include the import on first use
3. **Use real types** — `Ed25519HDPublicKey`, not `PublicKey` or `var`
4. **Comment the non-obvious** — Don't comment `// create a client`. Do comment `// 8-byte Anchor discriminator`
5. **Show the error case** — If it can fail, show what failure looks like

### Callout Boxes

Use blockquotes with bold prefixes. The docs renderer styles these automatically:

```markdown
> **CRITICAL**: For things that break your app or lose money.

> **WHY THIS MATTERS**: For explanations connecting code to understanding.

> **GOTCHA**: For non-obvious behaviors that waste debugging time.
```

### Tables

Use GitHub-flavored Markdown tables. The renderer handles them:

```markdown
| Column A | Column B |
|----------|----------|
| Value 1  | Value 2  |
```

### Code Blocks

Always specify the language for syntax context:

````markdown
```dart
final client = RpcClient('https://api.devnet.solana.com');
```

```yaml
dependencies:
  solana: ^0.31.0
```

```text
Diagram or ASCII art
```
````

---

## Adding a New Skill File

### Step 1: Write the file

Create `docs/skills/{slug}.md` following the structure above.

### Step 2: Register in the API

Open `src/app/api/skills/[slug]/route.ts` and add your slug to the `ALLOWED_SLUGS` set:

```typescript
const ALLOWED_SLUGS = new Set([
    "solana-package",
    "borsh",
    // ... existing entries
    "your-new-slug",    // ← add here
]);
```

### Step 3: Register in the docs page

Open `src/app/docs/page.tsx` and add an entry to `DOC_MANIFEST`:

```typescript
{ slug: "your-new-slug", title: "Your Package", description: "One-sentence description.", category: "Core" },
```

Categories: `Core`, `Mobile`, `Tokens & NFTs`, `Patterns`, or create a new one if needed.

Then create a matching human-facing guide at `docs/guides/your-new-slug.md`. Guides use a narrative tone and explain WHY things work the way they do — see existing guides in `docs/guides/` for examples. The docs page reads from `docs/guides/`, not `docs/skills/`.

### Step 4: Add to the main skill index

Open `public/skills.md` and add a row to the Deep-Dive Skill Files table:

```markdown
| Your Package | What it covers | `https://web3flutter.dev/api/skills/your-new-slug` |
```

---

## Length Guidelines

| Section | Target |
|---------|--------|
| Overview | 50-150 words |
| Quick Start | Under 30 lines of code |
| Core Concept (each) | 100-300 words + code |
| Common Mistake row | 1-2 sentences per cell |
| Full file | 800-2000 words (excluding code blocks) |

---

## Checklist Before Submitting

- [ ] Skill file is at `docs/skills/{slug}.md`
- [ ] Matching human guide is at `docs/guides/{slug}.md` (single-file) or `docs/guides/{slug}/index.md` + section files (multi-section)
- [ ] If multi-section, `sections` array is declared in `DOC_MANIFEST` in `page.tsx`
- [ ] Starts with `# Title — Summary` and a `>` description line
- [ ] Has all required sections: Overview, Quick Start, Core Concepts, Common Mistakes
- [ ] Every code block specifies a language (`dart`, `yaml`, `text`, etc.)
- [ ] Every code example would compile if pasted into a real project
- [ ] Package version is pinned (e.g., `solana: ^0.31.0`)
- [ ] Uses CRITICAL / GOTCHA / WHY THIS MATTERS callouts where appropriate
- [ ] Slug is added to API allowlist, docs manifest, and main skill index
- [ ] No filler, no placeholder text, no `TODO` comments
