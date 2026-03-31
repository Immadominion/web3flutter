"use client";

import { useRef, useState, useEffect } from "react";
import { motion, useScroll, useTransform, useMotionValue, useSpring } from "framer-motion";
import FadeIn from "./FadeIn";

const TIDE_PATH = "M 0 200 L 0 100 C 120 50, 240 50, 360 100 S 600 150, 720 100 S 960 50, 1080 100 S 1320 150, 1440 100 S 1680 50, 1800 100 S 2040 150, 2160 100 S 2400 50, 2520 100 S 2760 150, 2880 100 L 2880 200 Z";

const DRAG_CARDS = [
    {
        id: "mwa",
        tag: "MOBILE",
        title: ["MOBILE WALLET", "ADAPTER"],
        subtitle: "SOLANA MWA",
        date: "PROTOCOL",
        bg: "bg-[#5333FF]",
        text: "text-white",
        overview: "A protocol specification that facilitates secure connections between mobile dApps and local wallet apps on a device.",
        objectives: [
            "Seamless native signing",
            "No browser extensions",
            "Secure message authorization"
        ]
    },
    {
        id: "client",
        tag: "CLIENT",
        title: ["NATIVE SOLANA", "CLIENT"],
        subtitle: "DARTUS / FLUTTER",
        date: "LIBRARY",
        bg: "bg-[#FF3366]",
        text: "text-white",
        overview: "Native libraries to interact directly with the Solana blockchain from Dart code.",
        objectives: [
            "Direct RPC interactions",
            "Cross-platform capability",
            "Native data serialization"
        ]
    },
    {
        id: "walrus",
        tag: "STORAGE",
        title: ["DECENTRALIZED", "STORAGE"],
        subtitle: "WALRUS PROTOCOL",
        date: "NETWORK",
        bg: "bg-[#111111]",
        text: "text-white",
        overview: "A decentralized, highly scalable data storage network optimized for handling large data blobs.",
        objectives: [
            "Cost-effective blob storage",
            "High availability",
            "Fully decentralized"
        ]
    },
    {
        id: "tld",
        tag: "IDENTITY",
        title: ["HUMAN READABLE", "IDENTITY"],
        subtitle: "ALL DOMAINS",
        date: "NAMING",
        bg: "bg-white",
        text: "text-black",
        overview: "A decentralized naming service that issues custom Top-Level Domains (TLDs) on the blockchain.",
        objectives: [
            "Replace complex addresses",
            "Seamless identity management",
            "Cross-dApp interoperability"
        ]
    }
];

export default function DocsSection() {
    const containerRef = useRef<HTMLElement>(null);
    const carouselRef = useRef<HTMLDivElement>(null);

    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start end", "start start"],
    });

    const tideX = useTransform(scrollYProgress, [0, 1], ["0%", "-25%"]);

    const [dragConstraints, setDragConstraints] = useState({ right: 0, left: 0 });

    useEffect(() => {
        const updateConstraints = () => {
            if (carouselRef.current) {
                const scrollWidth = carouselRef.current.scrollWidth;
                const clientWidth = carouselRef.current.parentElement?.clientWidth || window.innerWidth;
                const leftConstraint = Math.min(0, -(scrollWidth - clientWidth));
                setDragConstraints({ right: 0, left: leftConstraint });
            }
        };

        const timeout = setTimeout(updateConstraints, 500);
        window.addEventListener('resize', updateConstraints);
        return () => {
            clearTimeout(timeout);
            window.removeEventListener('resize', updateConstraints);
        };
    }, []);

    const cursorX = useMotionValue(-100);
    const cursorY = useMotionValue(-100);
    const springConfig = { damping: 25, stiffness: 300, mass: 0.5 };
    const cursorXSpring = useSpring(cursorX, springConfig);
    const cursorYSpring = useSpring(cursorY, springConfig);

    const [isHovering, setIsHovering] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const moveCursor = (e: MouseEvent) => {
            cursorX.set(e.clientX);
            cursorY.set(e.clientY);
        };
        if (isHovering) {
            window.addEventListener("mousemove", moveCursor);
        }
        return () => {
            window.removeEventListener("mousemove", moveCursor);
        };
    }, [isHovering, cursorX, cursorY]);

    return (
        <section ref={containerRef} id="docs" className="relative z-20 -mt-[100vh] bg-[#E3FF00] pt-12 sm:pt-16 pb-0 overflow-x-clip">
            <div className="absolute top-0 left-0 w-full overflow-hidden transform -translate-y-[99%] pointer-events-none">
                <motion.svg
                    style={{ x: tideX }}
                    className="w-[400%] h-[100px] sm:h-[150px] md:h-[220px] origin-left"
                    viewBox="0 0 2880 200"
                    preserveAspectRatio="none"
                >
                    <path fill="#E3FF00" d={TIDE_PATH} />
                </motion.svg>
            </div>

            <motion.div
                style={{
                    x: cursorXSpring,
                    y: cursorYSpring,
                    translateX: "-50%",
                    translateY: "-50%",
                    opacity: isHovering ? 1 : 0,
                    scale: isHovering ? (isDragging ? 0.9 : 1) : 0,
                }}
                className="fixed top-0 left-0 z-50 pointer-events-none flex items-center justify-center bg-white text-black rounded-full px-5 py-2.5 shadow-2xl font-bold text-[10px] sm:text-xs tracking-widest border border-black/5 whitespace-nowrap"
            >
                ◀ DRAG ▶
            </motion.div>

            <div className="relative max-w-7xl mx-auto px-6 mb-12 sm:mb-16 pointer-events-auto">
                <FadeIn className="text-center sm:text-left">
                    <p className="spaced-text text-[#5333FF] text-xs mb-4 font-bold">
                        D O C U M E N T A T I O N
                    </p>
                    <h2 className="text-4xl md:text-6xl font-bold mb-4 text-black" style={{ fontFamily: 'var(--font-heading), sans-serif' }}>
                        Docs that <span className="text-[#5333FF] italic" style={{ fontFamily: 'Georgia, serif' }}>actually explain.</span>
                    </h2>
                    <p className="text-black/60 text-lg max-w-2xl">
                        Not just API references. We explain the WHY — why things work the
                        way they do, why they break, and how to fix them.
                    </p>
                </FadeIn>
            </div>

            <div
                className="w-full relative"
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
            >
                <div className="w-full relative">
                    <motion.div
                        ref={carouselRef}
                        drag="x"
                        dragConstraints={dragConstraints}
                        dragElastic={0.05}
                        onPointerDown={() => setIsDragging(true)}
                        onPointerUp={() => setIsDragging(false)}
                        className="flex flex-nowrap w-fit select-none cursor-none"
                    >
                        {DRAG_CARDS.map((course, i) => (
                            <div
                                key={course.id}
                                className={`relative flex-shrink-0 w-[90vw] sm:w-[500px] md:w-[600px] lg:w-[650px] h-[75vh] min-h-[600px] md:min-h-[750px] p-8 sm:p-12 flex flex-col justify-between ${course.bg} ${course.text} ${i !== DRAG_CARDS.length - 1 ? (course.text.includes('text-white') ? 'border-r border-white/10' : 'border-r border-black/5') : ''}`}
                            >
                                <div className="flex justify-between items-start w-full">
                                    <div className="uppercase tracking-wide">
                                        <p className="font-bold text-xs sm:text-sm tracking-widest opacity-90">{course.subtitle}</p>
                                        <p className="font-medium text-[10px] sm:text-xs opacity-50 mt-1.5">{course.date}</p>
                                    </div>
                                    <div className={`border rounded-full px-4 py-1.5 text-[10px] sm:text-xs font-bold tracking-widest ${course.text.includes('text-white') ? 'border-white/30 text-white' : 'border-black/20 text-black'}`}>
                                        {course.tag}
                                    </div>
                                </div>

                                <div className="flex flex-col gap-8 mt-16 sm:mt-24 mb-24 z-10 relative pointer-events-none flex-grow justify-center">
                                    <div className="max-w-[400px]">
                                        <p className="text-base sm:text-xl font-medium leading-relaxed opacity-95">
                                            {course.overview}
                                        </p>
                                        <ul className="mt-10 space-y-4">
                                            {course.objectives.map((obj, j) => (
                                                <li key={j} className="flex items-center gap-4 text-sm font-medium opacity-70">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 flex-shrink-0" />
                                                    {obj}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>

                                <div className="flex justify-between items-end w-full relative z-10 mt-auto">
                                    <h3
                                        className="text-[12vw] sm:text-[4rem] md:text-[5rem] lg:text-[5.5rem] font-bold uppercase leading-[0.8] tracking-[-0.04em]"
                                        style={{ fontFamily: 'var(--font-heading), sans-serif' }}
                                    >
                                        {course.title.map((line, k) => (
                                            <span key={k} className="block">{line}</span>
                                        ))}
                                    </h3>
                                    <div className="flex-shrink-0 ml-4 pb-1 sm:pb-3 opacity-60">
                                        <svg className="w-8 h-8 sm:w-12 sm:h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 7L7 17M17 7H8M17 7v9" />
                                        </svg>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </motion.div>
                </div>
            </div>
        </section>
    );
}


