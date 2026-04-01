import { promises as fs } from "fs";
import path from "path";
import type { Metadata } from "next";
import DocsPageClient from "./DocsPageClient";

export const metadata: Metadata = {
    title: "Docs — Web3 Flutter HQ",
    description: "Deep-dive technical documentation for building Web3 apps with Flutter on Solana.",
};

interface SectionDef {
    slug: string;
    title: string;
}

interface DocManifestEntry {
    slug: string;
    title: string;
    description: string;
    category: string;
    sections?: SectionDef[];
}

const DOC_MANIFEST: DocManifestEntry[] = [
    { slug: "solana-package", title: "Solana Package", description: "The foundational SDK — keypairs, transactions, RPC communication, and program interaction.", category: "Core" },
    { slug: "borsh", title: "Borsh Serialization", description: "Code generation and runtime types for serializing Solana on-chain data in Borsh binary format.", category: "Core" },
    {
        slug: "coral-xyz", title: "coral_xyz", description: "Universal Dart client for Solana programs — Anchor, Quasar, and Pinocchio via IDL.", category: "Core",
        sections: [
            { slug: "idl-basics", title: "IDL Basics" },
            { slug: "serialization", title: "Serialization" },
            { slug: "account-resolution", title: "Account Resolution" },
            { slug: "events-and-interface", title: "Events & Interface" },
        ],
    },
    { slug: "solana-mobile", title: "Solana Mobile", description: "MWA, Seed Vault, and dApp Store integration for Saga/Seeker devices.", category: "Mobile" },
    { slug: "token-ops", title: "Token Operations", description: "Create, transfer, and manage SPL tokens and Token-2022 extensions.", category: "Tokens & NFTs" },
    { slug: "nft-dev", title: "NFT Development", description: "Mint, transfer, and display NFTs using Metaplex and compressed NFTs.", category: "Tokens & NFTs" },
    { slug: "defi-patterns", title: "DeFi Patterns", description: "Swaps, staking, and liquidity provision via Jupiter and native programs.", category: "Patterns" },
    { slug: "wallet-ux", title: "Wallet UX", description: "Connection flows, signing UI, and error handling patterns.", category: "Patterns" },
];

async function readMd(filePath: string, fallbackTitle: string): Promise<string> {
    try {
        return await fs.readFile(filePath, "utf-8");
    } catch {
        return `# ${fallbackTitle}\n\n> Documentation coming soon.`;
    }
}

export default async function DocsPage() {
    const guidesDir = path.join(process.cwd(), "docs", "guides");

    const docs = await Promise.all(
        DOC_MANIFEST.map(async (entry) => {
            if (entry.sections) {
                // Multi-section guide: directory with index.md + section files
                const content = await readMd(path.join(guidesDir, entry.slug, "index.md"), entry.title);
                const sections = await Promise.all(
                    entry.sections.map(async (sec) => ({
                        slug: sec.slug,
                        title: sec.title,
                        content: await readMd(path.join(guidesDir, entry.slug, `${sec.slug}.md`), sec.title),
                    }))
                );
                return { slug: entry.slug, title: entry.title, description: entry.description, category: entry.category, content, sections };
            }
            // Single-file guide
            const content = await readMd(path.join(guidesDir, `${entry.slug}.md`), entry.title);
            return { slug: entry.slug, title: entry.title, description: entry.description, category: entry.category, content };
        })
    );

    return <DocsPageClient docs={docs} />;
}
