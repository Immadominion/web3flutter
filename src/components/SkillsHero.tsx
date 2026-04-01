"use client";

import { useCallback, useRef, useState } from "react";
import { motion, useMotionTemplate, useScroll, useTransform } from "framer-motion";
import { Check, Copy, Download, FileText } from "lucide-react";
import FadeIn from "./FadeIn";

const PREVIEW_CONTENT = `# Web3 Flutter — Agent Skill File
# Copy into your project as SKILL.md or .instructions.md

---
description: "Index skill file for Web3 Flutter on Solana.
  References 16 deep-dive skill files."
globs: "**/*.dart"
---

## Deep-Dive Skill Files (16)

| Skill                | URL                                              |
|----------------------|--------------------------------------------------|
| Solana Core SDK      | web3flutter.dev/api/skills/solana-core            |
| Solana Package       | web3flutter.dev/api/skills/solana-package         |
| Borsh                | web3flutter.dev/api/skills/borsh                  |
| coral_xyz            | web3flutter.dev/api/skills/coral-xyz              |
| Solana Mobile Client | web3flutter.dev/api/skills/solana-mobile-client   |
| Solana Mobile Wallet | web3flutter.dev/api/skills/solana-mobile-wallet   |
| Solana Seed Vault    | web3flutter.dev/api/skills/solana-seed-vault      |
| SPL Token            | web3flutter.dev/api/skills/spl-token              |
| Metaplex NFT         | web3flutter.dev/api/skills/metaplex-nft           |
| Token Operations     | web3flutter.dev/api/skills/token-ops              |
| NFT Development      | web3flutter.dev/api/skills/nft-dev                |
| DeFi Patterns        | web3flutter.dev/api/skills/defi-patterns          |
| Jupiter Aggregator   | web3flutter.dev/api/skills/jupiter-aggregator     |
| Wallet UX            | web3flutter.dev/api/skills/wallet-ux              |
| Tx Building          | web3flutter.dev/api/skills/transaction-building   |
| Security             | web3flutter.dev/api/skills/flutter-web3-security  |
| Dartus (Walrus)      | web3flutter.dev/api/skills/dartus                 |
| bls_dart             | web3flutter.dev/api/skills/bls-dart               |
| light_sdk (ZK)       | web3flutter.dev/api/skills/light-sdk              |
| tld_parser (ANS)     | web3flutter.dev/api/skills/tld-parser             |
| Stake Program        | web3flutter.dev/api/skills/stake-program          |

> AGENT: Fetch only the skill URLs relevant to the task.

## Decision Tree

\`\`\`
Any Solana Flutter app → \`solana\` (always needed)
├── Anchor/Quasar programs? → + coral_xyz
├── Raw programs? → + borsh
├── Mobile signing? → + solana_mobile_client
├── DEX swaps? → + jupiter-aggregator
├── ZK Compression? → + light_sdk
├── Domain names? → + tld_parser
└── Walrus storage? → + dartus + bls_dart
\`\`\`

## Critical Rules · Common Errors · Architecture
## Security · Program IDs · Quick Reference...`;

// No wave path needed here anymore

export default function SkillsHero() {
    const [copied, setCopied] = useState(false);
    const containerRef = useRef<HTMLElement>(null);
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start start", "end end"],
    });

    // Start the transition when DocsSection starts covering it
    const transitionProgress = useTransform(scrollYProgress, [0.5, 1], [0, 1]);
    const textY = useTransform(scrollYProgress, [0, 0.5], ["0%", "-65%"]);

    // Sticky upper layer recedes as DocsSection slides over
    const contentScale = useTransform(transitionProgress, [0, 1], [1, 0.9]);
    const contentY = useTransform(transitionProgress, [0, 1], ["0px", "-40px"]);
    const contentBlur = useTransform(transitionProgress, [0, 1], [0, 4]);
    const contentBrightness = useTransform(transitionProgress, [0, 1], [1, 0.5]);
    const contentFilter = useMotionTemplate`blur(${contentBlur}px) brightness(${contentBrightness})`;

    const headerY = useTransform(transitionProgress, [0, 0.8], ["0px", "-150px"]);
    const headerOpacity = useTransform(transitionProgress, [0, 0.6], [1, 0]);

    const boxY = useTransform(transitionProgress, [0, 0.8], ["0px", "150px"]);
    const boxOpacity = useTransform(transitionProgress, [0, 0.6], [1, 0]);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText("https://web3flutter.dev/skills.md");
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            handleDownload();
        }
    }, []);

    const handleDownload = useCallback(() => {
        const link = document.createElement("a");
        link.href = "/skills.md";
        link.download = "web3-flutter-skills.md";
        link.click();
    }, []);

    return (
        <section
            ref={containerRef}
            id="skills"
            className="relative h-[320vh] bg-black pointer-events-none z-10"
        >
            <div className="sticky top-0 z-0 h-screen w-full overflow-hidden pointer-events-none">
                {/* Content layer */}
                <motion.div
                    className="relative z-10 flex h-full w-full flex-col items-center justify-center"
                    style={{ y: contentY, scale: contentScale, filter: contentFilter, transformOrigin: "center center" }}
                >
                    <div className="relative mx-auto w-full max-w-5xl px-6">
                        <motion.div style={{ y: headerY, opacity: headerOpacity }} className="text-center sm:mb-12 mb-10 w-full flex-shrink-0">
                            <FadeIn>
                                <p className="spaced-text mb-4 text-xs uppercase text-accent font-bold tracking-widest">
                                    The Skill File
                                </p>
                                <h2
                                    className="mb-4 text-4xl font-bold md:text-6xl text-foreground"
                                    style={{ fontFamily: "var(--font-heading), sans-serif" }}
                                >
                                    One file.{" "}
                                    <span className="gradient-text italic opacity-90" style={{ fontFamily: "Georgia, serif" }}>
                                        Complete knowledge.
                                    </span>
                                </h2>
                                <p className="mx-auto max-w-2xl text-lg text-foreground/70" style={{ fontFamily: "var(--font-geist-sans)" }}>
                                    Copy this into your project and your AI assistant instantly knows
                                    how to build Web3 with Flutter, every package, every pattern,
                                    every pitfall.
                                </p>
                            </FadeIn>
                        </motion.div>

                        <motion.div style={{ y: boxY, opacity: boxOpacity }} className="mx-auto max-w-5xl w-full origin-bottom flex-shrink-0 pointer-events-auto">
                            <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#0a0a0a] shadow-[0_40px_100px_rgba(0,0,0,0.8)] transition-shadow duration-500">
                                <div className="flex items-center justify-between gap-4 border-b border-white/5 bg-white/5 px-5 py-4 sm:px-6">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <FileText size={18} className="text-accent" />
                                        <span className="truncate font-mono text-sm text-foreground/70 font-semibold tracking-wide">
                                            skills.md
                                        </span>
                                        <span className="rounded-full border border-accent/30 bg-accent/20 px-3 py-1 text-[10px] font-black tracking-widest uppercase text-accent">
                                            Agent Ready
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleDownload}
                                            className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-foreground/70 transition-all hover:bg-white/10 hover:text-foreground"
                                        >
                                            <Download size={14} />
                                            <span className="hidden sm:inline">Download</span>
                                        </button>
                                        <button
                                            onClick={handleCopy}
                                            className={`flex items-center gap-2 rounded-lg px-5 py-2 text-xs font-bold uppercase tracking-wider transition-all ${copied
                                                ? "bg-accent-secondary/20 text-accent-secondary"
                                                : "bg-accent text-background hover:bg-accent/90"
                                                }`}
                                        >
                                            {copied ? (
                                                <>
                                                    <Check size={14} />
                                                    Copied URL!
                                                </>
                                            ) : (
                                                <>
                                                    <Copy size={14} />
                                                    Copy Link
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Custom scroll logic driven by scrollYProgress to prevent scrolling bugs */}
                                <div className="h-[28rem] relative overflow-hidden bg-black border-t border-black pointer-events-auto cursor-default">
                                    <motion.pre
                                        style={{ y: textY, fontFamily: "var(--font-geist-mono), monospace", background: "black", border: "none", borderRadius: 0 }}
                                        className="p-8 text-sm absolute w-full leading-loose text-white/80 font-medium"
                                    >
                                        <code>{PREVIEW_CONTENT}</code>
                                    </motion.pre>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </motion.div>
            </div>
        </section>
    );
}
