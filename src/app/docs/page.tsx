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

export interface DocManifestEntry {
    slug: string;
    title: string;
    description: string;
    category: string;
    skillSlug?: string;          // matching skill file slug for CTA
    sections?: SectionDef[];
}

export const DOC_MANIFEST: DocManifestEntry[] = [
    { slug: "solana-package", title: "Solana Package", description: "The foundational SDK — keypairs, transactions, RPC communication, and program interaction.", category: "Core", skillSlug: "solana-package" },
    { slug: "borsh", title: "Borsh Serialization", description: "Code generation and runtime types for serializing Solana on-chain data in Borsh binary format.", category: "Core", skillSlug: "borsh" },
    {
        slug: "coral-xyz", title: "coral_xyz", description: "Universal Dart client for Solana programs — Anchor, Quasar, and Pinocchio via IDL.", category: "Core", skillSlug: "coral-xyz",
        sections: [
            { slug: "idl-basics", title: "IDL Basics" },
            { slug: "serialization", title: "Serialization" },
            { slug: "account-resolution", title: "Account Resolution" },
            { slug: "events-and-interface", title: "Events & Interface" },
        ],
    },
    { slug: "solana-mobile", title: "Solana Mobile", description: "MWA, Seed Vault, and dApp Store integration for Saga/Seeker devices.", category: "Mobile", skillSlug: "solana-mobile-client" },
    { slug: "token-ops", title: "Token Operations", description: "Create, transfer, and manage SPL tokens and Token-2022 extensions.", category: "Tokens & NFTs", skillSlug: "spl-token" },
    { slug: "nft-dev", title: "NFT Development", description: "Mint, transfer, and display NFTs using Metaplex and compressed NFTs.", category: "Tokens & NFTs", skillSlug: "metaplex-nft" },
    { slug: "defi-patterns", title: "DeFi Patterns", description: "Swaps, staking, and liquidity provision via Jupiter and native programs.", category: "Patterns", skillSlug: "defi-patterns" },
    { slug: "wallet-ux", title: "Wallet UX", description: "Connection flows, signing UI, and error handling patterns.", category: "Patterns", skillSlug: "wallet-ux" },
    {
        slug: "dartus", title: "Dartus", description: "Walrus SDK for Flutter — HTTP gateways, storage nodes, Sui, and native BLS layers.", category: "Storage", skillSlug: "dartus",
        sections: [
            { slug: "walrus-mental-model", title: "Walrus Mental Model" },
            { slug: "architecture", title: "Architecture" },
            { slug: "app-flows", title: "App Flows" },
            { slug: "native-layers-and-bls", title: "Native Layers & BLS" },
        ],
    },
    { slug: "bls-dart", title: "bls_dart", description: "Native BLS12-381 signatures for Walrus certification and Sui-flavored verification.", category: "Storage", skillSlug: "bls-dart" },
    {
        slug: "light-sdk", title: "light_sdk", description: "ZK Compression for Flutter — store Solana state at 1/1000th cost via compressed accounts and Merkle trees.", category: "ZK", skillSlug: "light-sdk",
        sections: [
            { slug: "zk-compression-mental-model", title: "ZK Compression Mental Model" },
            { slug: "sdk-architecture", title: "SDK Architecture" },
            { slug: "state-trees-and-proofs", title: "State Trees & Proofs" },
            { slug: "rpc-actions-and-transactions", title: "RPC Actions & Transactions" },
            { slug: "mobile-integration", title: "Mobile Integration" },
        ],
    },
    {
        slug: "tld-parser", title: "tld_parser", description: "AllDomains ANS SDK — resolve human-readable .sol/.abc domains to Solana wallets and back.", category: "Naming", skillSlug: "tld-parser",
        sections: [
            { slug: "on-chain-architecture", title: "On-Chain Architecture" },
            { slug: "pda-derivation", title: "PDA Derivation" },
            { slug: "state-and-deserialization", title: "State & Deserialization" },
            { slug: "resolution-and-records", title: "Resolution & Records" },
            { slug: "mobile-integration", title: "Mobile Integration" },
        ],
    },
];

async function readMd(filePath: string, fallbackTitle: string): Promise<string> {
    try {
        return await fs.readFile(filePath, "utf-8");
    } catch {
        return `# ${fallbackTitle}\n\n> Documentation coming soon.`;
    }
}

export async function loadDocs() {
    const guidesDir = path.join(process.cwd(), "docs", "guides");

    return Promise.all(
        DOC_MANIFEST.map(async (entry) => {
            if (entry.sections) {
                const content = await readMd(path.join(guidesDir, entry.slug, "index.md"), entry.title);
                const sections = await Promise.all(
                    entry.sections.map(async (sec) => ({
                        slug: sec.slug,
                        title: sec.title,
                        content: await readMd(path.join(guidesDir, entry.slug, `${sec.slug}.md`), sec.title),
                    }))
                );
                return { slug: entry.slug, title: entry.title, description: entry.description, category: entry.category, skillSlug: entry.skillSlug, content, sections };
            }
            const content = await readMd(path.join(guidesDir, `${entry.slug}.md`), entry.title);
            return { slug: entry.slug, title: entry.title, description: entry.description, category: entry.category, skillSlug: entry.skillSlug, content };
        })
    );
}

export default async function DocsPage() {
    const docs = await loadDocs();
    return <DocsPageClient docs={docs} />;
}
