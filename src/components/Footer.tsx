"use client";

import Image from "next/image";

export default function Footer() {
    return (
        <footer className="relative py-20 bg-[#E3FF00] text-black">
            <div className="max-w-7xl mx-auto px-6">
                <div className="grid md:grid-cols-4 gap-12 mb-16">
                    {/* Brand */}
                    <div className="md:col-span-2">
                        <div className="flex items-center gap-3 mb-4">
                            <Image
                                src="/logo.png"
                                alt="Web3 Flutter HQ"
                                width={32}
                                height={32}
                                className="rounded-lg"
                            />
                            <span className="font-semibold text-lg">
                                web3flutter<span className="text-black opacity-50">hq</span>
                            </span>
                        </div>
                        <p className="text-sm text-black/60 max-w-sm leading-relaxed">
                            The ecosystem hub for Flutter × Web3 development. AI-ready skill
                            files and comprehensive docs proving Flutter belongs in Web3.
                        </p>
                        <div className="flex items-center gap-4 mt-6">
                            <a
                                href="https://x.com/web3flutterhq"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-black/60 hover:text-black transition-colors"
                            >
                                <svg
                                    width="18"
                                    height="18"
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                >
                                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                </svg>
                            </a>
                            <a
                                href="https://github.com/immadominion"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-black/60 hover:text-black transition-colors"
                            >
                                <svg
                                    width="18"
                                    height="18"
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                >
                                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                                </svg>
                            </a>
                        </div>
                    </div>

                    {/* Resources */}
                    <div>
                        <p className="spaced-text text-xs text-black/60 mb-4">Resources</p>
                        <ul className="space-y-3">
                            <li>
                                <a
                                    href="#skills"
                                    className="text-sm text-black/60 hover:text-black transition-colors"
                                >
                                    Skills File
                                </a>
                            </li>
                            <li>
                                <a
                                    href="#docs"
                                    className="text-sm text-black/60 hover:text-black transition-colors"
                                >
                                    Documentation
                                </a>
                            </li>
                            <li>
                                <a
                                    href="#ecosystem"
                                    className="text-sm text-black/60 hover:text-black transition-colors"
                                >
                                    Ecosystem Map
                                </a>
                            </li>
                        </ul>
                    </div>

                    {/* Packages */}
                    <div>
                        <p className="spaced-text text-xs text-black/60 mb-4">Packages</p>
                        <ul className="space-y-3">
                            <li>
                                <a
                                    href="https://pub.dev/packages/solana"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-black/60 hover:text-black transition-colors"
                                >
                                    solana
                                </a>
                            </li>
                            <li>
                                <a
                                    href="https://pub.dev/packages/solana_mobile_client"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-black/60 hover:text-black transition-colors"
                                >
                                    solana_mobile_client
                                </a>
                            </li>
                            <li>
                                <a
                                    href="https://pub.dev/packages/borsh"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-black/60 hover:text-black transition-colors"
                                >
                                    borsh
                                </a>
                            </li>
                            <li>
                                <a
                                    href="https://pub.dev/packages/coral_xyz"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-black/60 hover:text-black transition-colors"
                                >
                                    coral_xyz
                                </a>
                            </li>
                        </ul>
                    </div>
                </div>

                {/* Bottom bar */}
                <div className="pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
                    <p className="text-xs text-black/60">
                        &copy; {new Date().getFullYear()} web3flutterhq. Building the Flutter
                        × Web3 ecosystem.
                    </p>
                    <p className="text-xs text-black/60">
                        Made with Flutter spirit &amp; shipped with Next.js
                    </p>
                </div>
            </div>
        </footer>
    );
}
