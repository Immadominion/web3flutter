"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, BookOpen, X } from "lucide-react";

const navLinks = [
    { href: "#skills", label: "Skills", desc: "Let AI build on Solana" },
    { href: "#ecosystem", label: "Ecosystem", desc: "The full Flutter × Web3 map" },
    { href: "#docs", label: "Docs", desc: "Learn Flutter on Solana" },
];

function NavLink({ href, label, desc, onClick }: { href: string; label: string; desc: string; onClick: () => void }) {
    const [hovered, setHovered] = useState(false);
    return (
        <a
            href={href}
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="relative py-4 border-b border-background/10 last:border-0 overflow-hidden block"
            style={{ height: '3.2rem' }}
        >
            <div className="relative" style={{ perspective: '400px' }}>
                {/* Default text */}
                <motion.span
                    animate={{
                        rotateX: hovered ? -90 : 0,
                        opacity: hovered ? 0 : 1,
                    }}
                    transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                    className="block text-background font-bold text-base uppercase tracking-wider"
                    style={{ transformOrigin: 'bottom center', fontFamily: 'var(--font-heading), sans-serif' }}
                >
                    {label}
                </motion.span>
                {/* Hovered text — italic serif description */}
                <motion.span
                    animate={{
                        rotateX: hovered ? 0 : 90,
                        opacity: hovered ? 1 : 0,
                    }}
                    transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                    className="absolute top-0 left-0 block text-background font-bold text-base italic tracking-wider"
                    style={{ transformOrigin: 'top center', fontFamily: 'Georgia, "Times New Roman", serif' }}
                >
                    {desc}
                </motion.span>
            </div>
        </a>
    );
}

export default function Navbar() {
    const [isScrolled, setIsScrolled] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const handleScroll = () => setIsScrolled(window.scrollY > 20);
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const handleQuickCopy = useCallback(async () => {
        try {
            const response = await fetch("/skills.md");
            const text = await response.text();
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // silent fail
        }
    }, []);

    return (
        <nav
            className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 pointer-events-none`}
        >
            <div className="max-w-7xl mx-auto px-42 h-16 flex items-center justify-between pointer-events-auto">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-2 group">
                    <Image
                        src="/icon.png"
                        alt="Web3 Flutter HQ"
                        width={32}
                        height={32}
                        className="rounded-full shadow-md"
                    />
                    <span className="font-bold text-lg tracking-tight uppercase">
                        Web3<span className="text-accent">Flutter</span>
                    </span>
                </Link>

                {/* Center — Flow-style blob tab + dropdown */}
                <div className="hidden md:block fixed top-0 left-1/2 -translate-x-1/2 z-[60]">
                    <div className="relative flex flex-col items-center">
                        {/* Single unified blob — slides from tab to full panel */}
                        <motion.div
                            animate={{
                                width: menuOpen ? 340 : 140,
                                height: menuOpen ? 320 : 48,
                                y: menuOpen ? 14 : 0,
                                borderRadius: menuOpen ? "20px 20px 0 0" : "0px 0px 0 0",
                            }}
                            transition={{ type: "spring", stiffness: 300, damping: 28 }}
                            className="relative overflow-hidden"
                        >
                            {/* SVG shape — no viewBox so coordinates = actual pixels, both animate in sync */}
                            {/* Both paths share identical structure for smooth interpolation */}
                            <svg
                                width="100%"
                                height="100%"
                                fill="none"
                                className="absolute inset-0"
                            >
                                <motion.path
                                    animate={{
                                        d: menuOpen
                                            ? "M0 0 H340 V252 C340 266 332 272 320 272 L240 272 C240 272 240 280 230 290 C220 300 215 310 200 314 C190 316.5 180 318 170 318 C160 318 150 316.5 140 314 C125 310 120 300 110 290 C100 280 100 272 100 272 L20 272 C8 272 0 266 0 252 V0 Z"
                                            : "M0 0 H140 V0 C0 0 0 0 0 0 L140 0 C140 0 140 8 130 18 C120 28 115 38 100 42 C90 44.5 80 46 70 46 C60 46 50 44.5 40 42 C25 38 20 28 10 18 C0 8 0 0 0 0 L0 0 C0 0 0 0 0 0 V0 Z",
                                    }}
                                    transition={{ type: "spring", stiffness: 300, damping: 28 }}
                                    fill="#E3FF00"
                                />
                            </svg>

                            {/* Toggle button — always at top center */}
                            <button
                                onClick={() => setMenuOpen(!menuOpen)}
                                className="absolute top-0 left-1/2 -translate-x-1/2 z-20 w-full flex items-center justify-center"
                                style={{ height: '44px' }}
                                aria-label="Toggle menu"
                            >
                                <AnimatePresence mode="wait">
                                    {menuOpen ? (
                                        <motion.div
                                            key="close"
                                            initial={{ rotate: -90, opacity: 0 }}
                                            animate={{ rotate: 0, opacity: 1 }}
                                            exit={{ rotate: 90, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                        >
                                            <X size={20} className="text-background" />
                                        </motion.div>
                                    ) : (
                                        <motion.div
                                            key="hamburger"
                                            initial={{ rotate: 90, opacity: 0 }}
                                            animate={{ rotate: 0, opacity: 1 }}
                                            exit={{ rotate: -90, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                        >
                                            <svg width="22" height="14" viewBox="0 0 22 14" fill="none">
                                                <rect y="0" width="22" height="2.2" rx="1.1" fill="#5333FF" />
                                                <rect y="5.8" width="22" height="2.2" rx="1.1" fill="#5333FF" />
                                                <rect y="11.6" width="22" height="2.2" rx="1.1" fill="#5333FF" />
                                            </svg>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </button>

                            {/* Panel content — fades in when open */}
                            <AnimatePresence>
                                {menuOpen && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ delay: 0.1, duration: 0.2 }}
                                        className="absolute left-0 right-0 px-8 flex flex-col"
                                        style={{ top: '44px' }}
                                    >
                                        <div className="flex flex-col">
                                            {navLinks.map((link) => (
                                                <NavLink
                                                    key={link.href}
                                                    href={link.href}
                                                    label={link.label}
                                                    desc={link.desc}
                                                    onClick={() => setMenuOpen(false)}
                                                />
                                            ))}
                                        </div>
                                        {/* Social */}
                                        <div className="flex items-center justify-center gap-5 pt-6 pb-2">
                                            <a
                                                href="https://x.com/web3flutterhq"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-background/50 hover:text-background transition-colors"
                                            >
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                                </svg>
                                            </a>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    </div>

                    {/* Click-away overlay */}
                    {menuOpen && (
                        <div
                            className="fixed inset-0 -z-10"
                            onClick={() => setMenuOpen(false)}
                        />
                    )}
                </div>

                {/* Right — CTAs */}
                <div className="hidden md:flex items-center gap-2">
                    <button
                        onClick={handleQuickCopy}
                        className="group flex items-center gap-2 px-5 py-2.5 rounded-full border border-foreground/20 text-foreground text-sm font-semibold hover:bg-foreground hover:text-background transition-all duration-200"
                    >
                        {copied ? "Copied!" : "Copy Skills"}
                        <Copy size={14} className={`transition-transform ${copied ? 'scale-110' : 'group-hover:scale-110'}`} />
                    </button>
                    <a
                        href="#docs"
                        className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-foreground text-background text-sm font-semibold hover:bg-foreground/90 transition-all duration-200"
                    >
                        Get Started
                        <BookOpen size={14} />
                    </a>
                </div>

                {/* Mobile Toggle */}
                <button
                    onClick={() => setIsMobileOpen(!isMobileOpen)}
                    className="md:hidden w-8 h-8 flex flex-col items-center justify-center gap-1.5"
                >
                    <motion.div
                        animate={isMobileOpen ? { rotate: 45, y: 6 } : { rotate: 0, y: 0 }}
                        className="w-5 h-px bg-foreground"
                    />
                    <motion.div
                        animate={isMobileOpen ? { opacity: 0 } : { opacity: 1 }}
                        className="w-5 h-px bg-foreground"
                    />
                    <motion.div
                        animate={isMobileOpen ? { rotate: -45, y: -6 } : { rotate: 0, y: 0 }}
                        className="w-5 h-px bg-foreground"
                    />
                </button>
            </div>

            {/* Mobile Menu */}
            <AnimatePresence>
                {isMobileOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="md:hidden bg-surface border-b border-border overflow-hidden"
                    >
                        <div className="px-6 py-4 flex flex-col gap-4">
                            {navLinks.map((link) => (
                                <a
                                    key={link.href}
                                    href={link.href}
                                    onClick={() => setIsMobileOpen(false)}
                                    className="text-sm text-muted hover:text-foreground transition-colors spaced-text"
                                >
                                    {link.label}
                                </a>
                            ))}
                            <div className="flex flex-col gap-3 pt-3 border-t border-border">
                                <button
                                    onClick={handleQuickCopy}
                                    className="flex items-center gap-2 px-4 py-3 rounded-xl bg-accent text-background text-sm font-bold"
                                >
                                    <Copy size={14} />
                                    {copied ? "Copied!" : "Copy Skills.md"}
                                </button>
                                <a
                                    href="#docs"
                                    onClick={() => setIsMobileOpen(false)}
                                    className="flex items-center gap-2 px-4 py-3 rounded-xl border border-foreground/20 text-foreground text-sm font-bold"
                                >
                                    <BookOpen size={14} />
                                    Get Started
                                </a>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </nav>
    );
}
