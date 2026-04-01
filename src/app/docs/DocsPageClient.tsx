"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, LucideSearch, BookOpen, ChevronRight, LucideX, Copy, Check, Sparkles } from "lucide-react";

interface DocSection {
    slug: string;
    title: string;
    content: string;
}

interface DocEntry {
    slug: string;
    title: string;
    description: string;
    category: string;
    content: string;
    skillSlug?: string;
    sections?: DocSection[];
}

/* ── Simple Markdown renderer ── */
function renderMarkdown(md: string) {
    const lines = md.split("\n");
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeLines: string[] = [];
    let codeLang = "";
    let inTable = false;
    let tableRows: string[][] = [];
    let tableAlign: string[] = [];

    const flushTable = () => {
        if (tableRows.length === 0) return;
        elements.push(
            <div key={`table-${elements.length}`} className="my-6 overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr>
                            {tableRows[0].map((cell, j) => (
                                <th
                                    key={j}
                                    className="text-left py-2 px-3 border-b-2 border-white/20 text-white/80 font-bold uppercase text-xs tracking-wider"
                                    style={{ textAlign: (tableAlign[j] as "left" | "center" | "right") || "left" }}
                                >
                                    {cell.trim()}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {tableRows.slice(1).map((row, i) => (
                            <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                {row.map((cell, j) => (
                                    <td
                                        key={j}
                                        className="py-2 px-3 text-white/60"
                                        style={{ textAlign: (tableAlign[j] as "left" | "center" | "right") || "left" }}
                                    >
                                        {renderInline(cell.trim())}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
        tableRows = [];
        tableAlign = [];
        inTable = false;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Code blocks
        if (line.startsWith("```")) {
            if (inCodeBlock) {
                elements.push(
                    <div key={`code-${elements.length}`} className="my-4 rounded-xl bg-[#0a0a0a] border border-white/10 overflow-hidden">
                        {codeLang && (
                            <div className="px-4 py-1.5 border-b border-white/5 text-[10px] font-mono text-white/30 uppercase tracking-wider">
                                {codeLang}
                            </div>
                        )}
                        <pre className="p-4 overflow-x-auto text-sm leading-relaxed">
                            <code className="text-white/70 font-mono">{codeLines.join("\n")}</code>
                        </pre>
                    </div>
                );
                inCodeBlock = false;
                codeLines = [];
                codeLang = "";
            } else {
                if (inTable) flushTable();
                inCodeBlock = true;
                codeLang = line.slice(3).trim();
            }
            continue;
        }

        if (inCodeBlock) {
            codeLines.push(line);
            continue;
        }

        // Tables
        if (line.trim().startsWith("|")) {
            const cells = line.split("|").slice(1, -1);
            // Check if it's a separator row
            if (cells.every((c) => /^[\s:-]+$/.test(c))) {
                tableAlign = cells.map((c) => {
                    const t = c.trim();
                    if (t.startsWith(":") && t.endsWith(":")) return "center";
                    if (t.endsWith(":")) return "right";
                    return "left";
                });
                continue;
            }
            if (!inTable) inTable = true;
            tableRows.push(cells.map((c) => c.trim()));
            continue;
        } else if (inTable) {
            flushTable();
        }

        // Blank lines
        if (line.trim() === "") continue;

        // Headings
        if (line.startsWith("# ")) {
            // Skip the top-level H1 — it's the page title
            continue;
        }
        if (line.startsWith("## ")) {
            elements.push(
                <h2 key={`h2-${elements.length}`} className="mt-12 mb-4 text-2xl font-bold text-white tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
                    {line.slice(3)}
                </h2>
            );
            continue;
        }
        if (line.startsWith("### ")) {
            elements.push(
                <h3 key={`h3-${elements.length}`} className="mt-8 mb-3 text-lg font-bold text-white/90" style={{ fontFamily: "var(--font-heading)" }}>
                    {line.slice(4)}
                </h3>
            );
            continue;
        }

        // Blockquotes (callouts)
        if (line.startsWith("> ")) {
            const text = line.slice(2);
            const isCritical = text.startsWith("**CRITICAL**");
            const isGotcha = text.startsWith("**GOTCHA**");
            const isWhy = text.startsWith("**WHY THIS MATTERS**");

            let borderColor = "border-white/20";
            let bgColor = "bg-white/5";
            if (isCritical) { borderColor = "border-red-500/40"; bgColor = "bg-red-500/5"; }
            if (isGotcha) { borderColor = "border-yellow-500/40"; bgColor = "bg-yellow-500/5"; }
            if (isWhy) { borderColor = "border-blue-500/40"; bgColor = "bg-blue-500/5"; }

            elements.push(
                <blockquote key={`bq-${elements.length}`} className={`my-4 border-l-2 ${borderColor} ${bgColor} py-3 px-4 rounded-r-lg text-sm text-white/60 leading-relaxed`}>
                    {renderInline(text)}
                </blockquote>
            );
            continue;
        }

        // List items
        if (/^(\d+\.|-|\*)\s/.test(line.trim())) {
            elements.push(
                <li key={`li-${elements.length}`} className="ml-4 text-white/60 text-sm leading-relaxed list-disc">
                    {renderInline(line.replace(/^(\d+\.|-|\*)\s/, "").trim())}
                </li>
            );
            continue;
        }

        // Horizontal rule
        if (/^---+$/.test(line.trim())) {
            elements.push(<hr key={`hr-${elements.length}`} className="my-8 border-white/10" />);
            continue;
        }

        // Paragraph
        elements.push(
            <p key={`p-${elements.length}`} className="my-3 text-sm text-white/60 leading-relaxed">
                {renderInline(line)}
            </p>
        );
    }

    if (inTable) flushTable();

    return elements;
}

function renderInline(text: string): React.ReactNode {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
        // Find the first special pattern
        const codeIdx = remaining.indexOf("`");
        const boldIdx = remaining.indexOf("**");

        // Determine which comes first
        let firstIdx = remaining.length;
        let firstType = "";

        if (codeIdx >= 0 && codeIdx < firstIdx) { firstIdx = codeIdx; firstType = "code"; }
        if (boldIdx >= 0 && boldIdx < firstIdx) { firstIdx = boldIdx; firstType = "bold"; }

        // No patterns found — emit rest as text
        if (!firstType) {
            parts.push(<span key={key++}>{remaining}</span>);
            break;
        }

        // Emit text before the pattern
        if (firstIdx > 0) {
            parts.push(<span key={key++}>{remaining.slice(0, firstIdx)}</span>);
            remaining = remaining.slice(firstIdx);
        }

        if (firstType === "code") {
            const end = remaining.indexOf("`", 1);
            if (end < 0) { parts.push(<span key={key++}>{remaining}</span>); break; }
            parts.push(
                <code key={key++} className="px-1.5 py-0.5 rounded bg-white/10 text-[#E3FF00] text-xs font-mono">
                    {remaining.slice(1, end)}
                </code>
            );
            remaining = remaining.slice(end + 1);
        } else if (firstType === "bold") {
            const end = remaining.indexOf("**", 2);
            if (end < 0) { parts.push(<span key={key++}>{remaining}</span>); break; }
            parts.push(
                <strong key={key++} className="text-white font-semibold">
                    {remaining.slice(2, end)}
                </strong>
            );
            remaining = remaining.slice(end + 2);
        }
    }

    return parts;
}

/* ── Sidebar item ── */
function SidebarItem({
    doc,
    isActive,
    activeSection,
    onClick,
    onSectionClick,
}: {
    doc: DocEntry;
    isActive: boolean;
    activeSection: string | null;
    onClick: () => void;
    onSectionClick?: (sectionSlug: string) => void;
}) {
    const hasSections = doc.sections && doc.sections.length > 0;

    return (
        <div>
            <button
                onClick={onClick}
                className={`w-full text-left px-4 py-3 rounded-xl transition-all duration-200 group ${isActive
                    ? "bg-white/10 text-white"
                    : "text-white/40 hover:text-white/70 hover:bg-white/5"
                    }`}
            >
                <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold tracking-wide" style={{ fontFamily: "var(--font-heading)" }}>
                        {doc.title}
                    </span>
                    <ChevronRight
                        size={14}
                        className={`transition-transform ${isActive ? "rotate-90 text-[#E3FF00]" : "opacity-0 group-hover:opacity-50"}`}
                    />
                </div>
                {isActive && (
                    <p className="mt-1 text-xs text-white/40 leading-snug">{doc.description}</p>
                )}
            </button>

            {/* Sub-sections */}
            {isActive && hasSections && (
                <div className="ml-4 mt-1 mb-2 border-l border-white/10 pl-3 space-y-0.5">
                    <button
                        onClick={onClick}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${activeSection === null
                            ? "text-[#E3FF00] bg-[#E3FF00]/5"
                            : "text-white/40 hover:text-white/60"
                            }`}
                    >
                        Overview
                    </button>
                    {doc.sections!.map((sec) => (
                        <button
                            key={sec.slug}
                            onClick={() => onSectionClick?.(sec.slug)}
                            className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${activeSection === sec.slug
                                ? "text-[#E3FF00] bg-[#E3FF00]/5"
                                : "text-white/40 hover:text-white/60"
                                }`}
                        >
                            {sec.title}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ── Main ── */
export default function DocsPageClient({ docs, initialSlug }: { docs: DocEntry[]; initialSlug?: string }) {
    const router = useRouter();
    const [activeSlug, setActiveSlug] = useState(initialSlug ?? docs[0]?.slug ?? "");
    const [activeSection, setActiveSection] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [skillCopied, setSkillCopied] = useState(false);

    const categories = useMemo(() => {
        const map: Record<string, DocEntry[]> = {};
        docs.forEach((d) => {
            if (!map[d.category]) map[d.category] = [];
            map[d.category].push(d);
        });
        return map;
    }, [docs]);

    const filteredDocs = useMemo(() => {
        if (!searchQuery) return docs;
        const q = searchQuery.toLowerCase();
        return docs.filter(
            (d) =>
                d.title.toLowerCase().includes(q) ||
                d.description.toLowerCase().includes(q) ||
                d.content.toLowerCase().includes(q)
        );
    }, [docs, searchQuery]);

    const activeDoc = docs.find((d) => d.slug === activeSlug);
    const displayedContent = activeSection && activeDoc?.sections
        ? activeDoc.sections.find((s) => s.slug === activeSection)?.content ?? activeDoc.content
        : activeDoc?.content ?? "";
    const displayedTitle = activeSection && activeDoc?.sections
        ? activeDoc.sections.find((s) => s.slug === activeSection)?.title ?? activeDoc?.title
        : activeDoc?.title;

    const selectDoc = (slug: string) => {
        setActiveSlug(slug);
        setActiveSection(null);
        setSkillCopied(false);
        router.push(`/docs/${slug}`, { scroll: false });
    };

    const selectSection = (slug: string, sectionSlug: string) => {
        setActiveSlug(slug);
        setActiveSection(sectionSlug);
        setSkillCopied(false);
        router.push(`/docs/${slug}`, { scroll: false });
    };

    const handleCopySkillUrl = useCallback(async (skillSlug: string) => {
        try {
            await navigator.clipboard.writeText(`https://web3flutter.dev/api/skills/${skillSlug}`);
            setSkillCopied(true);
            setTimeout(() => setSkillCopied(false), 2000);
        } catch { /* ignore */ }
    }, []);

    return (
        <div className="min-h-screen bg-[#050505]">
            {/* Top bar */}
            <header className="sticky top-0 z-50 border-b border-white/5 bg-[#050505]/90 backdrop-blur-xl">
                <div className="max-w-[90rem] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/"
                            className="flex items-center gap-2 text-white/50 hover:text-white transition-colors"
                        >
                            <ArrowLeft size={16} />
                            <span className="text-sm font-semibold tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
                                Web3<span className="text-[#E3FF00]">Flutter</span>
                            </span>
                        </Link>
                        <span className="text-white/20">|</span>
                        <span className="text-xs font-bold tracking-widest uppercase text-white/30" style={{ fontFamily: "var(--font-heading)" }}>
                            Documentation
                        </span>
                    </div>

                    {/* Search */}
                    <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 w-64">
                        <LucideSearch size={14} className="text-white/30" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search docs..."
                            className="bg-transparent text-sm text-white placeholder:text-white/20 outline-none w-full"
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery("")} className="text-white/30 hover:text-white">
                                <LucideX size={12} />
                            </button>
                        )}
                    </div>

                    {/* Mobile sidebar toggle */}
                    <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="sm:hidden flex items-center gap-1.5 text-white/50 text-xs font-bold uppercase tracking-wider"
                    >
                        <BookOpen size={14} />
                        Topics
                    </button>
                </div>
            </header>

            <div className="max-w-[90rem] mx-auto flex">
                {/* Sidebar — desktop */}
                <aside className="hidden sm:block w-64 flex-shrink-0 border-r border-white/5 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-6 px-3">
                    {Object.entries(categories).map(([category, catDocs]) => (
                        <div key={category} className="mb-6">
                            <p className="px-4 mb-2 text-[10px] font-mono text-white/20 uppercase tracking-[0.3em]">
                                {category}
                            </p>
                            {catDocs
                                .filter((d) =>
                                    !searchQuery ||
                                    filteredDocs.some((fd) => fd.slug === d.slug)
                                )
                                .map((doc) => (
                                    <SidebarItem
                                        key={doc.slug}
                                        doc={doc}
                                        isActive={doc.slug === activeSlug}
                                        activeSection={doc.slug === activeSlug ? activeSection : null}
                                        onClick={() => selectDoc(doc.slug)}
                                        onSectionClick={(sec) => selectSection(doc.slug, sec)}
                                    />
                                ))}
                        </div>
                    ))}
                </aside>

                {/* Mobile sidebar */}
                <AnimatePresence>
                    {mobileMenuOpen && (
                        <motion.div
                            initial={{ x: "-100%" }}
                            animate={{ x: 0 }}
                            exit={{ x: "-100%" }}
                            transition={{ type: "spring", damping: 25, stiffness: 250 }}
                            className="fixed inset-0 z-40 bg-[#050505] sm:hidden pt-14 overflow-y-auto"
                        >
                            <div className="p-4">
                                {/* Mobile search */}
                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 mb-6">
                                    <LucideSearch size={14} className="text-white/30" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search docs..."
                                        className="bg-transparent text-sm text-white placeholder:text-white/20 outline-none w-full"
                                    />
                                </div>

                                {Object.entries(categories).map(([category, catDocs]) => (
                                    <div key={category} className="mb-6">
                                        <p className="px-4 mb-2 text-[10px] font-mono text-white/20 uppercase tracking-[0.3em]">
                                            {category}
                                        </p>
                                        {catDocs
                                            .filter((d) =>
                                                !searchQuery ||
                                                filteredDocs.some((fd) => fd.slug === d.slug)
                                            )
                                            .map((doc) => (
                                                <SidebarItem
                                                    key={doc.slug}
                                                    doc={doc}
                                                    isActive={doc.slug === activeSlug}
                                                    activeSection={doc.slug === activeSlug ? activeSection : null}
                                                    onClick={() => {
                                                        selectDoc(doc.slug);
                                                        setMobileMenuOpen(false);
                                                    }}
                                                    onSectionClick={(sec) => {
                                                        selectSection(doc.slug, sec);
                                                        setMobileMenuOpen(false);
                                                    }}
                                                />
                                            ))}
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Content */}
                <main className="flex-1 min-w-0 px-6 sm:px-10 md:px-16 py-10 sm:py-14">
                    <AnimatePresence mode="wait">
                        {activeDoc && (
                            <motion.article
                                key={`${activeDoc.slug}-${activeSection ?? "overview"}`}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -12 }}
                                transition={{ duration: 0.25 }}
                                className="max-w-3xl"
                            >
                                {/* Category badge + breadcrumb */}
                                <div className="flex items-center gap-2 mb-4 flex-wrap">
                                    <span className="inline-block text-[10px] font-mono text-[#E3FF00]/60 uppercase tracking-[0.3em] border border-[#E3FF00]/20 px-2.5 py-1 rounded">
                                        {activeDoc.category}
                                    </span>
                                    {activeSection && activeDoc.sections && (
                                        <>
                                            <span className="text-white/20 text-xs">/</span>
                                            <button
                                                onClick={() => setActiveSection(null)}
                                                className="text-[10px] font-mono text-white/30 hover:text-white/60 uppercase tracking-[0.2em] transition-colors"
                                            >
                                                {activeDoc.title}
                                            </button>
                                        </>
                                    )}
                                </div>

                                {/* Title */}
                                <h1
                                    className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-2"
                                    style={{ fontFamily: "var(--font-heading)" }}
                                >
                                    {activeSection ? displayedTitle : activeDoc.title}
                                </h1>

                                {/* Description (only on overview) */}
                                {!activeSection && (
                                    <p className="text-base text-white/40 mb-10 leading-relaxed">
                                        {activeDoc.description}
                                    </p>
                                )}

                                {/* Section tabs (for multi-section guides) */}
                                {activeDoc.sections && activeDoc.sections.length > 0 && (
                                    <div className="flex gap-1 mb-8 overflow-x-auto pb-2 -mx-1 px-1">
                                        <button
                                            onClick={() => setActiveSection(null)}
                                            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeSection === null
                                                ? "bg-[#E3FF00]/10 text-[#E3FF00] border border-[#E3FF00]/20"
                                                : "text-white/30 hover:text-white/60 border border-transparent"
                                                }`}
                                        >
                                            Overview
                                        </button>
                                        {activeDoc.sections.map((sec) => (
                                            <button
                                                key={sec.slug}
                                                onClick={() => setActiveSection(sec.slug)}
                                                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeSection === sec.slug
                                                    ? "bg-[#E3FF00]/10 text-[#E3FF00] border border-[#E3FF00]/20"
                                                    : "text-white/30 hover:text-white/60 border border-transparent"
                                                    }`}
                                            >
                                                {sec.title}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {/* Rendered markdown */}
                                <div className="prose-custom">
                                    {renderMarkdown(displayedContent)}
                                </div>

                                {/* Prev/Next section navigation */}
                                {activeDoc.sections && activeDoc.sections.length > 0 && (
                                    <div className="mt-12 pt-6 border-t border-white/10 flex justify-between">
                                        {(() => {
                                            const allSections = [{ slug: null, title: "Overview" }, ...activeDoc.sections.map(s => ({ slug: s.slug as string | null, title: s.title }))];
                                            const currentIdx = allSections.findIndex(s => s.slug === activeSection);
                                            const prev = currentIdx > 0 ? allSections[currentIdx - 1] : null;
                                            const next = currentIdx < allSections.length - 1 ? allSections[currentIdx + 1] : null;
                                            return (
                                                <>
                                                    {prev ? (
                                                        <button
                                                            onClick={() => setActiveSection(prev.slug)}
                                                            className="text-left group"
                                                        >
                                                            <span className="text-[10px] uppercase tracking-wider text-white/20">Previous</span>
                                                            <p className="text-sm text-white/50 group-hover:text-white/80 transition-colors">{prev.title}</p>
                                                        </button>
                                                    ) : <span />}
                                                    {next ? (
                                                        <button
                                                            onClick={() => setActiveSection(next.slug)}
                                                            className="text-right group"
                                                        >
                                                            <span className="text-[10px] uppercase tracking-wider text-white/20">Next</span>
                                                            <p className="text-sm text-white/50 group-hover:text-white/80 transition-colors">{next.title}</p>
                                                        </button>
                                                    ) : <span />}
                                                </>
                                            );
                                        })()}
                                    </div>
                                )}

                                {/* Skill file CTA */}
                                {activeDoc.skillSlug && (
                                    <div className="mt-10 rounded-xl border border-[#E3FF00]/20 bg-[#E3FF00]/5 p-5">
                                        <div className="flex items-start gap-3">
                                            <Sparkles size={18} className="text-[#E3FF00] mt-0.5 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-semibold text-white mb-1">
                                                    Building with {activeDoc.title}?
                                                </p>
                                                <p className="text-xs text-white/40 leading-relaxed mb-3">
                                                    Give your AI agent the full skill file — paste the link into your conversation or save it to your project.
                                                </p>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <button
                                                        onClick={() => handleCopySkillUrl(activeDoc.skillSlug!)}
                                                        className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${skillCopied
                                                            ? "bg-green-500/20 text-green-400"
                                                            : "bg-[#E3FF00] text-black hover:bg-[#E3FF00]/90"
                                                            }`}
                                                    >
                                                        {skillCopied ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy Skill URL</>}
                                                    </button>
                                                    <code className="text-[10px] text-white/25 font-mono truncate">
                                                        web3flutter.dev/api/skills/{activeDoc.skillSlug}
                                                    </code>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </motion.article>
                        )}
                    </AnimatePresence>
                </main>
            </div>
        </div>
    );
}
