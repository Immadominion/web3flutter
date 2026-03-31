"use client";

import Image from "next/image";

export default function BigBrand() {
    return (
        <section className="relative bg-black overflow-hidden select-none">
            <div className="relative flex min-h-[150vh] flex-col items-center justify-center py-[10vh]">
                {/* Bigger WEB3 Text */}
                <div className="relative inline-block mt-16 mb-[-32] text-center px-4">
                    <h1
                        className="relative text-[13vw] sm:text-[10vw] md:text-[9vw] lg:text-[9rem] xl:text-[10rem] leading-[0.9] tracking-[-0.04em] text-white uppercase text-center flex flex-col md:block"
                        style={{
                            fontFamily: 'var(--font-display), sans-serif',
                            WebkitTextStroke: '1.5px currentColor',
                            // wordSpacing: '0.17em',
                        }}
                    >
                        Build in WEB3 with
                    </h1>
                </div>

                {/* Wavy FLUTTER image — properly framed context for 9:16 */}
                <div className="relative w-[90vw] sm:w-[70vw] lg:w-[75vw] max-w-[1000px] aspect-[9/16]">
                    <Image
                        src="/flutter-txt.png"
                        alt="FLUTTER"
                        fill
                        className="object-contain"
                        priority
                    />
                </div>
            </div>
        </section>
    );
}
