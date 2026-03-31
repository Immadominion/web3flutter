# web3flutterhq

The ecosystem hub for Flutter × Web3 development on Solana and beyond.

## What This Is

- **Website** — A professionally designed landing page for Flutter × Web3 development
- **Skills File** — A comprehensive `skills.md` that AI agents can use to correctly build Web3 Flutter apps
- **Documentation** — Deep-dive guides that explain not just HOW but WHY things work (and break)

## Project Structure

```
web3flutter/
├── public/
│   └── skills.md              # THE skill file — copyable from the website
├── docs/
│   ├── WRITING_STYLE.md       # Documentation writing style guide
│   └── skills/
│       ├── solana-package.md  # Solana SDK deep dive
│       ├── dartus-borsh.md    # Borsh serialization guide
│       ├── coral-anchor.md    # Anchor framework client
│       ├── solana-mobile.md   # Solana Mobile Stack
│       ├── token-ops.md       # SPL Token operations
│       ├── nft-dev.md         # NFT development
│       ├── defi-patterns.md   # DeFi integration patterns
│       └── wallet-ux.md       # Wallet UX patterns
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout
│   │   ├── page.tsx           # Landing page
│   │   └── globals.css        # Design system tokens
│   └── components/
│       ├── Navbar.tsx          # Fixed navigation
│       ├── Hero.tsx            # Hero with copy CTA
│       ├── MarqueeSection.tsx  # Scrolling text marquee
│       ├── SkillsHero.tsx     # Skills file preview + copy
│       ├── EcosystemMap.tsx   # Package decision tree
│       ├── DocsSection.tsx    # Documentation cards
│       └── Footer.tsx         # Footer with links
└── package.json
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Styling | Tailwind CSS v4 |
| Animations | Framer Motion |
| Fonts | Space Grotesk + JetBrains Mono |
| Icons | Lucide React |
| Docs Format | Markdown (MDX-ready) |

## Development

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # Production build
```

## Design Philosophy

Inspired by:

- **[anubi.io](https://anubi.io)** — Elegant layout, spaced typography, smooth scroll, project showcases
- **[joinflowparty.com](https://www.joinflowparty.com)** — Bold community energy, marquee text, vibrant 3D elements

Applied with:

- Solana color palette (purple `#9945FF` / green `#14F195`) on deep dark backgrounds
- Grid background patterns with floating gradient orbs
- Parallax scroll effects and intersection-triggered animations
- Typography: Space Grotesk for headings, JetBrains Mono for code

## Assets Needed

- [ ] Rive animation files for interactive elements (fluffy Dash mascot, loading states)
- [ ] OG image for social media sharing (1200x630)
- [ ] Favicon set (16, 32, 180, 192, 512)

## Contributing Docs

All documentation must follow [docs/WRITING_STYLE.md](docs/WRITING_STYLE.md). Key rules:

- Every code example must compile
- Explain WHY, not just HOW
- Include common mistakes table
- Use consistent callout types (CRITICAL, GOTCHA, WHY THIS MATTERS)

## Links

- X: [@web3flutterhq](https://x.com/web3flutterhq)
- Skills file: [public/skills.md](public/skills.md)
