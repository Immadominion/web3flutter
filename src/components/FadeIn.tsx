"use client";

import { useRef, useEffect, useState, type ReactNode } from "react";

interface FadeInProps {
    children: ReactNode;
    className?: string;
    delay?: number;
    duration?: number;
    y?: number;
    once?: boolean;
    threshold?: number;
    as?: "div" | "section" | "span" | "p" | "h2" | "h3";
}

export default function FadeIn({
    children,
    className = "",
    delay = 0,
    duration = 0.6,
    y = 30,
    once = true,
    threshold = 0.1,
    as: Tag = "div",
}: FadeInProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    if (once) observer.disconnect();
                }
            },
            { threshold }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, [once, threshold]);

    return (
        <Tag
            ref={ref as never}
            className={className}
            style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateY(0)" : `translateY(${y}px)`,
                transition: `opacity ${duration}s ease ${delay}s, transform ${duration}s ease ${delay}s`,
            }}
        >
            {children}
        </Tag>
    );
}
