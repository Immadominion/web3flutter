"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useRef } from "react";

// ── Path control points ──
// Each cubic bezier segment: [cp1x, cp1y, cp2x, cp2y, endX, endY]
// The path starts with a Move to the first point, then chains C segments.

interface PathPoint {
    x: number;
    y: number;
    label: string;
}

const INITIAL_POINTS: PathPoint[] = [
    // M start
    { x: -250, y: 350, label: "M start" },
    // C1: sweeping entrance curve
    { x: 213, y: 153, label: "C1-cp1" },
    { x: 500, y: 400, label: "C1-cp2" },
    { x: 750, y: 500, label: "C1-end" },
    // C2: lead into the loop
    { x: 945, y: 610, label: "C2-cp1" },
    { x: 1400, y: 707, label: "C2-cp2" },
    { x: 1414, y: 570, label: "C2-end" },
    // C3: the lasso loop (top arc)
    { x: 1423, y: 488, label: "C3-cp1" },
    { x: 1294, y: 489, label: "C3-cp2" },
    { x: 1312, y: 574, label: "C3-end" },
    // C4: loop reconnection & exit
    { x: 1319, y: 613, label: "C4-cp1" },
    { x: 1372, y: 668, label: "C4-cp2" },
    { x: 1850, y: 650, label: "C4-end" },
];

function buildPath(pts: PathPoint[]): string {
    const [m, ...rest] = pts;
    let d = `M ${m.x} ${m.y}`;
    for (let i = 0; i < rest.length; i += 3) {
        const cp1 = rest[i];
        const cp2 = rest[i + 1];
        const end = rest[i + 2];
        if (cp1 && cp2 && end) {
            d += ` C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;
        }
    }
    return d;
}

// Compute visual center of the lasso loop: average of curve midpoint (t=0.5) and chord midpoint
function getLoopCenter(pts: PathPoint[]) {
    const p0 = pts[6], p1 = pts[7], p2 = pts[8], p3 = pts[9];
    // Bezier at t=0.5
    const t = 0.5, mt = 0.5;
    const curveMidX = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x;
    const curveMidY = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y;
    // Chord midpoint (straight line between C2-end and C3-end)
    const chordMidX = (p0.x + p3.x) / 2;
    const chordMidY = (p0.y + p3.y) / 1.7;
    return { cx: (curveMidX + chordMidX) / 2, cy: (curveMidY + chordMidY) / 2 };
}

const POP_MESSAGES = [
    { text: "Press SHIFT + D \nto see magic", rotate: 0 },
    { text: "Solana is home", rotate: -8 },
    { text: "DM Heisjoel0x on X \nto build Apps", rotate: 0 },
    { text: "Own your Storage", rotate: 8 },
];

export default function KineticHub() {
    const [bars, setBars] = useState(Array(11).fill(1));
    const [points, setPoints] = useState<PathPoint[]>(INITIAL_POINTS);
    const [designMode, setDesignMode] = useState(false);
    const [popIndex, setPopIndex] = useState(0);
    const [popVisible, setPopVisible] = useState(false);
    const draggingRef = useRef<number | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const pointsRef = useRef<PathPoint[]>(INITIAL_POINTS);

    // Keep pointsRef in sync
    useEffect(() => {
        pointsRef.current = points;
    }, [points]);

    useEffect(() => {
        const interval = setInterval(() => {
            setBars((prev) =>
                prev.map((_, i) => {
                    const distFromCenter = Math.abs(i - 5) / 5;
                    const baseHeight = 1 - distFromCenter;
                    return Math.max(0.15, baseHeight * (0.3 + Math.random() * 0.7));
                })
            );
        }, 200);
        return () => clearInterval(interval);
    }, []);

    // Pop-up text cycling behind the pill
    useEffect(() => {
        let cancelled = false;
        const cycle = async () => {
            if (cancelled) return;
            setPopVisible(true);
            await new Promise(r => setTimeout(r, 1500));
            if (cancelled) return;
            setPopVisible(false);
            await new Promise(r => setTimeout(r, 1000));
            if (cancelled) return;
            setPopIndex(prev => (prev + 1) % POP_MESSAGES.length);
            if (!cancelled) cycle();
        };
        const init = setTimeout(() => { if (!cancelled) cycle(); }, 2500);
        return () => { cancelled = true; clearTimeout(init); };
    }, []);

    // Toggle design mode with Shift+D
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.shiftKey && e.key === "D") {
                setDesignMode((prev) => {
                    const next = !prev;
                    if (next) {
                        console.log(
                            "%c[KineticHub Designer] ON — drag points to reshape. Path logged on every move.",
                            "color: #E3FF00; font-weight: bold; background: #333; padding: 4px 8px; border-radius: 4px;"
                        );
                        console.log("Current path:", buildPath(pointsRef.current));
                        console.log("Points:", JSON.stringify(pointsRef.current, null, 2));
                    } else {
                        console.log(
                            "%c[KineticHub Designer] OFF",
                            "color: #999; font-weight: bold;"
                        );
                    }
                    return next;
                });
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    const svgCoords = useCallback(
        (clientX: number, clientY: number) => {
            const svg = svgRef.current;
            if (!svg) return { x: 0, y: 0 };
            const pt = svg.createSVGPoint();
            pt.x = clientX;
            pt.y = clientY;
            const ctm = svg.getScreenCTM();
            if (!ctm) return { x: 0, y: 0 };
            const svgPt = pt.matrixTransform(ctm.inverse());
            return { x: Math.round(svgPt.x), y: Math.round(svgPt.y) };
        },
        []
    );

    // Window-level drag handlers so pointer capture doesn't block events
    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            const idx = draggingRef.current;
            if (idx === null) return;
            const { x, y } = svgCoords(e.clientX, e.clientY);
            setPoints((prev) => {
                const next = [...prev];
                next[idx] = { ...next[idx], x, y };
                console.log(
                    `%c[Point ${idx}: ${next[idx].label}] x:${x} y:${y}`,
                    "color: #E3FF00;"
                );
                console.log("Path:", buildPath(next));
                return next;
            });
        };

        const onUp = () => {
            if (draggingRef.current !== null) {
                console.log(
                    "%c[KineticHub] Final path data:",
                    "color: #00ff88; font-weight: bold;"
                );
                console.log("Path string:", buildPath(pointsRef.current));
                console.log("Points JSON:", JSON.stringify(pointsRef.current));
                draggingRef.current = null;
            }
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
    }, [svgCoords]);

    const handlePointerDown = useCallback((idx: number) => {
        draggingRef.current = idx;
    }, []);

    const pathD = buildPath(points);
    const loopCenter = getLoopCenter(points);

    const textNode =
        "FLUTTER × SOLANA · BUILD WEB3 MOBILE · DART SDK · WALLETS · DEFI · NFTs · ANCHOR · BORSH · PDAs · SPL TOKENS · RPC · dApps · STAKING · SWAPS · SKILL FILES · OPEN SOURCE · ";
    const fullText = textNode.repeat(8);

    // Pill position: on the path near C1-end / C2-cp1 junction
    const pillPoint = {
        x: (points[3].x + points[4].x) / 6.44,
        y: (points[3].y + points[4].y) / 3.8,
    };

    return (
        <div className="relative w-full h-full">
            <svg
                ref={svgRef}
                viewBox="0 0 1600 900"
                className="absolute inset-0 w-full h-full overflow-visible"
                preserveAspectRatio="xMidYMid slice"
            >
                <defs>
                    <path id="kineticPath" d={pathD} pathLength={100} />
                </defs>

                {/* Dark Green Ribbon Background — only after the pill */}
                <use
                    href="#kineticPath"
                    stroke="#0a3622"
                    strokeWidth="24"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray="0 19 82 200"
                />

                {/* Thin white border outline — only after the pill */}
                <use
                    href="#kineticPath"
                    stroke="rgba(255, 255, 255, 0.15)"
                    strokeWidth="26"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray="0 19 82 200"
                />
                <use
                    href="#kineticPath"
                    stroke="#0a3622"
                    strokeWidth="23"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray="0 19 82 200"
                />

                {/* Monospace Scrolling Text */}
                <text
                    fill="#ffffff"
                    fontSize="10.5"
                    fontFamily="monospace"
                    fontWeight="600"
                    dy="3.5"
                    style={{ letterSpacing: "1.5px" }}
                >
                    <textPath href="#kineticPath" startOffset="0%">
                        <animate
                            attributeName="startOffset"
                            from="-100%"
                            to="0%"
                            dur="150s"
                            repeatCount="indefinite"
                        />
                        {fullText}
                    </textPath>
                </text>

                {/* Cinematic Glow Trail */}
                <use
                    href="#kineticPath"
                    stroke="#E3FF00"
                    strokeWidth="2.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray="100 4000"
                    className="blur-[1.5px]"
                >
                    <animate
                        attributeName="stroke-dashoffset"
                        from="2500"
                        to="0"
                        dur="15s"
                        repeatCount="indefinite"
                    />
                </use>

                {/* Pill Visualizer — positioned on the path */}
                <foreignObject
                    x={pillPoint.x - 75}
                    y={pillPoint.y - 25}
                    width={150}
                    height={50}
                    style={{ overflow: 'visible' }}
                >
                    <div style={{ position: 'relative', transform: 'rotate(12deg)', display: 'inline-flex' }}>
                        {/* Pop-up text from behind the pill */}
                        <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)' }} className="pointer-events-none">
                            <AnimatePresence mode="wait">
                                {popVisible && (
                                    <motion.span
                                        key={popIndex}
                                        initial={{ y: 6, opacity: 0, scale: 0.4, rotate: POP_MESSAGES[popIndex].rotate }}
                                        animate={{ y: -20, opacity: 1, scale: 1, rotate: POP_MESSAGES[popIndex].rotate }}
                                        exit={{ y: 6, opacity: 0, scale: 0.4, rotate: POP_MESSAGES[popIndex].rotate }}
                                        transition={{ type: "spring", stiffness: 50, damping: 12, mass: 0.6 }}
                                        className="whitespace-pre text-[11px] font-mono text-white/70 select-none block text-center"
                                        style={{ transformOrigin: 'center bottom', textAlign: 'center' }}
                                    >
                                        {POP_MESSAGES[popIndex].text}
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </div>
                        {/* Pill body */}
                        <div className="bg-[#faf9f0] px-3.5 py-2 rounded-full inline-flex items-center gap-[2.5px] shadow-[0_0_20px_rgba(0,0,0,0.6)] border border-white/20">
                            {bars.map((scale, i) => (
                                <motion.div
                                    key={i}
                                    animate={{ scaleY: scale }}
                                    transition={{ duration: 0.12 }}
                                    className="w-[3.5px] bg-[#0a3622] rounded-full origin-center"
                                    style={{ height: "24px" }}
                                />
                            ))}
                        </div>
                    </div>
                </foreignObject>

                {/* ── Design Mode: draggable control points ── */}
                {designMode &&
                    points.map((pt, i) => {
                        const isEndpoint = i === 0 || (i > 0 && (i - 1) % 3 === 2);
                        const color = isEndpoint ? "#00ff88" : "#ff9900";
                        return (
                            <g key={i}>
                                {i > 0 && (i - 1) % 3 !== 2 && (
                                    <line
                                        x1={pt.x}
                                        y1={pt.y}
                                        x2={
                                            (i - 1) % 3 === 0
                                                ? points[i - 1]?.x ?? pt.x
                                                : points[i + 1]?.x ?? pt.x
                                        }
                                        y2={
                                            (i - 1) % 3 === 0
                                                ? points[i - 1]?.y ?? pt.y
                                                : points[i + 1]?.y ?? pt.y
                                        }
                                        stroke={color}
                                        strokeWidth="1"
                                        strokeDasharray="4 4"
                                        opacity="0.6"
                                    />
                                )}
                                <circle
                                    cx={pt.x}
                                    cy={pt.y}
                                    r={isEndpoint ? 10 : 7}
                                    fill={color}
                                    fillOpacity={0.8}
                                    stroke="#fff"
                                    strokeWidth="2"
                                    style={{ cursor: "grab", pointerEvents: "all" }}
                                    onPointerDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handlePointerDown(i);
                                    }}
                                />
                                <text
                                    x={pt.x + 14}
                                    y={pt.y - 8}
                                    fill="#fff"
                                    fontSize="9"
                                    fontFamily="monospace"
                                    opacity="0.7"
                                >
                                    {i}: {pt.label}
                                </text>
                            </g>
                        );
                    })}
            </svg>
        </div>
    );
}
