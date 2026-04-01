"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import FadeIn from "./FadeIn";
import KineticHub from "./KineticHub";

export default function Hero() {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: wrapperRef,
        offset: ["start start", "end start"],
    });

    // The wrapper is exactly 200vh, providing exactly 1 screen height (100vh) of overlap scroll.
    // We map the first 50% of the wrapper's scroll (which equals exactly 100vh) to scale down the hero.
    const heroScale = useTransform(scrollYProgress, [0, 0.5], [1, 0.8]);
    const heroRotate = useTransform(scrollYProgress, [0, 0.5], [0, 2]); // Slant backward gently
    const heroOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0.1]);

    return (
        <div ref={wrapperRef} className="relative w-full h-[200vh] bg-black" style={{ zIndex: 1 }}>
            <motion.section
                style={{ scale: heroScale, rotate: heroRotate, opacity: heroOpacity }}
                className="sticky top-0 w-full h-screen flex items-center overflow-hidden bg-background origin-center"
            >
                {/* KineticHub — full background, behind everything */}
                <div className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden w-full h-full pointer-events-none">
                    <div className="w-full h-full min-w-[900px] sm:min-w-[1200px] lg:min-w-[1600px] flex-shrink-0 relative opacity-60 max-w-[2400px]">
                        <KineticHub />
                    </div>
                </div>

                {/* Content layer */}
                <div
                    className="relative z-10 w-full mx-auto px-3 sm:px-8 md:px-10 lg:px-12 pt-20 sm:pt-24 pb-10 pointer-events-none"
                >
                    <div className="flex flex-col items-center">
                        {/* Typography stack: Build / Web3 / Flutter */}
                        {/* WEB3 defines the width; Build pins left and Flutter pins right with matching inset */}
                        <div className="inline-flex w-fit flex-col gap-0">
                            <FadeIn delay={0.1} y={20}>
                                <div className="w-full flex justify-start">
                                    <p
                                        className="text-6xl sm:text-7xl md:text-7xl font-semibold text-foreground tracking-wide uppercase"
                                        style={{ fontFamily: 'var(--font-heading), sans-serif' }}
                                    >
                                        Build
                                    </p>
                                </div>
                            </FadeIn>

                            <FadeIn delay={0.25} y={40} duration={0.8}>
                                {/*
                             * Shared stacking context: W(z-5) < Dash(z-15) < EB3(z-20)
                             * All three siblings under div.relative so z-index interleaves correctly.
                             */}
                                <div className="relative inline-block">
                                    <h1
                                        className="relative text-[13rem] sm:text-[14rem] md:text-[15rem] lg:text-[25rem] xl:text-[40rem] leading-[0.8] tracking-[-0.06em] text-foreground uppercase"
                                        style={{
                                            fontFamily: 'var(--font-display), sans-serif',
                                            WebkitTextStroke: '1.5px currentColor',
                                        }}
                                    >
                                        <span className="relative inline-block" style={{ zIndex: 5 }}>W</span>
                                        <span className="relative inline-block" style={{ zIndex: 20 }}>EB3</span>
                                    </h1>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src="/dash.webp"
                                        alt=""
                                        aria-hidden="true"
                                        className="absolute pointer-events-none drop-shadow-[0_20px_40px_rgba(0,0,0,0.5)]"
                                        style={{
                                            zIndex: 15,
                                            right: '28%',
                                            top: '-6%',
                                            width: '200%',
                                            transform: 'scaleX(-1)',
                                        }}
                                    />
                                </div>
                            </FadeIn>

                            <FadeIn delay={0.4} y={20}>
                                <div className="w-full flex justify-end items-center gap-4 mt-[-30px] sm:mt-[-50px] md:mt-[-50px] pr-2 sm:pr-8">
                                    <span
                                        className="inline-block -rotate-[25deg] text-1xl sm:text-2xl md:text-[3rem] text-accent/90 lowercase"
                                        style={{ fontFamily: '"Brush Script MT", "Caveat", "Comic Sans MS", cursive' }}
                                    >
                                        with
                                    </span>
                                    <span
                                        className="inline-block bg-accent px-6 py-2 text-2xl sm:text-3xl md:text-7xl font-black text-background tracking-[0.16em] uppercase"
                                        style={{
                                            fontFamily: 'var(--font-heading), sans-serif',
                                            borderRadius: '255px 15px 225px 15px/15px 225px 15px 255px',
                                        }}
                                    >
                                        Flutter
                                    </span>
                                </div>
                            </FadeIn>
                        </div>

                        {/* Description */}
                        <FadeIn delay={0.55} y={15}>
                            <p
                                className="mt-5 max-w-3xl text-center text-lg sm:text-1xl md:text-1xl lg:text-1xl text-foreground/70 leading-[1.08]"
                                style={{ fontFamily: 'var(--font-heading), sans-serif' }}
                            >
                                <span className="uppercase">Everything you need to </span>
                                <span
                                    className="italic normal-case"
                                    style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                                >
                                    build
                                </span>
                                <span className="uppercase"> on Solana with </span>
                                <span
                                    className="italic normal-case"
                                    style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                                >
                                    Flutter.
                                </span>
                            </p>
                        </FadeIn>
                    </div>
                </div>
            </motion.section>
        </div>
    );
}
