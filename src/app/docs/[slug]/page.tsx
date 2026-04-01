import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOC_MANIFEST, loadDocs } from "../page";
import DocsPageClient from "../DocsPageClient";

interface Props {
    params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
    return DOC_MANIFEST.map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    const entry = DOC_MANIFEST.find((d) => d.slug === slug);
    if (!entry) return { title: "Not Found — Web3 Flutter HQ" };
    return {
        title: `${entry.title} — Web3 Flutter Docs`,
        description: entry.description,
    };
}

export default async function DocSlugPage({ params }: Props) {
    const { slug } = await params;
    if (!DOC_MANIFEST.some((d) => d.slug === slug)) notFound();

    const docs = await loadDocs();
    return <DocsPageClient docs={docs} initialSlug={slug} />;
}
