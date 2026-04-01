"use client";

import Image from "next/image";

// Map display name → public image filename
const IMAGE_MAP: Record<string, string> = {
    "Bitcoin Vision AI": "bitcoin-vision-ai.png",
    "Bitcoin Vision AI Pro": "bitcoin-vision-ai-prop.png",
    "Solflare": "solflare.png",
    "Seed Vault Wallet": "seed-vault-wallet.png",
    "Sol New": "sol new.png",
    "Busha": "busha.png",
    "Chumbucket": "chumbucket.png",
    "Factor": "factor.png",
    "Brick Breaker Master": "brick-breaker-master.png",
    "Cudis": "cudis.png",
    "COS. TV": "cos. tv.png",
    "Converter": "converter.png",
    "Espresso Cash": "espresso-cash.png",
    "Gable Guardians": "gable-guardinans.png",
    "Paily": "paily.png",
    "Qalc Defi": "qalc-defi.png",
    "Qlipper": "qlipper.png",
    "Roam": "roam.png",
    "StepN": "stepn.png",
    "Storj": "storj.png",
    "Symbal": "symbal.png",
    "Taptap": "taptap.png",
    "Tarsolt": "tarsolt.png",
    "To Do": "to do.png",
    "Unbound": "unbound.png",
    "Furrend": "furrend.png",
};

const row1 = [
    "Bitcoin Vision AI", "Bitcoin Vision AI Pro", "Solflare", "Seed Vault Wallet", "Sol New",
    "Busha", "Chumbucket", "Brick Breaker Master", "Cudis", "COS. TV",
    "Converter", "Espresso Cash",

];

const row2 = [
    "Gable Guardians", "Paily", "Qalc Defi", "Qlipper", "Roam", "StepN", "Storj",
    "Symbal", "Taptap", "Tarsolt", "To Do", "Unbound",
    "Factor", "Furrend"
];

const AppCard = ({ name }: { name: string }) => {
    const imageSrc = IMAGE_MAP[name];
    // Fallback monogram if no image
    const words = name.split(' ').filter(w => w.length > 0);
    const monogram = words.length >= 2
        ? (words[0][0] + words[1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase();

    return (
        <div className="group relative w-60 h-80 sm:w-72 sm:h-96 rounded-md bg-[#020202] border border-white/10 overflow-hidden flex flex-col p-6 transition-all duration-700 hover:border-white/40 hover:bg-[#080808] mx-3 sm:mx-4 flex-shrink-0 pointer-events-auto cursor-pointer">
            {/* Top Minimal Branding */}
            <div className="w-full flex justify-between items-start opacity-40 group-hover:opacity-100 transition-opacity duration-700">
                <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-white">
                    App
                </span>
                <div className="w-1.5 h-1.5 rounded-full bg-white/20 group-hover:bg-[#E3FF00] transition-colors duration-700" />
            </div>

            {/* Center — App Logo or Monogram Fallback */}
            <div className="flex-1 flex items-center justify-center">
                {imageSrc ? (
                    <div className="relative w-24 h-24 sm:w-32 sm:h-32 rounded-[22%] overflow-hidden shadow-lg group-hover:shadow-[0_8px_30px_rgba(227,255,0,0.15)] transition-shadow duration-700">
                        <Image
                            src={`/${imageSrc}`}
                            alt={name}
                            fill
                            className="object-cover"
                            sizes="128px"
                        />
                    </div>
                ) : (
                    <span
                        className="text-[6rem] sm:text-[8rem] text-white/50 group-hover:text-white transition-colors duration-700 select-none"
                        style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', letterSpacing: '-0.06em' }}
                    >
                        {monogram}
                    </span>
                )}
            </div>

            {/* Bottom Fashion-style Label */}
            <div className="w-full border-t border-white/10 pt-4 flex items-center justify-between">
                <h3
                    className="text-sm sm:text-base text-white tracking-widest uppercase font-semibold truncate pr-4"
                    style={{ fontFamily: 'var(--font-heading), sans-serif' }}
                >
                    {name}
                </h3>
                <span className="text-[10px] text-white/30 tracking-widest font-mono">
                    01
                </span>
            </div>
        </div>
    );
};

export default function MarqueeSection() {
    return (
        <section id="ecosystem" className="relative w-full pt-[15vh] pb-[10vh] overflow-hidden bg-black flex flex-col items-center">

            {/* Elegant section header overlaying the marquee to provide editorial context */}
            <div className="absolute top-10 left-0 w-full flex justify-center z-20 pointer-events-none opacity-80">
                <span className="text-xs uppercase tracking-[0.5em] text-white/50 font-mono">
                    Ecosystem Showcase
                </span>
            </div>

            {/* Slanted container so the layout matches the clipping/slice precisely */}
            <div className="relative -rotate-[3deg] scale-[1.05] pointer-events-none origin-center opacity-95 z-10 pt-16 pb-16 w-[120vw] flex flex-col gap-6 sm:gap-8">

                {/* Row 1 — moves left */}
                <div className="flex animate-marquee whitespace-nowrap" style={{ animationDuration: '20s' }}>
                    {/* Double the array for seamless infinite loop */}
                    {[...row1, ...row1].map((item, i) => (
                        <AppCard key={`row1-${i}`} name={item} />
                    ))}
                </div>

                {/* Row 2 — moves right */}
                <div className="flex animate-marquee-reverse whitespace-nowrap" style={{ animationDuration: '25s', marginLeft: '-20vw' }}>
                    {/* Double the array for seamless infinite loop */}
                    {[...row2, ...row2].map((item, i) => (
                        <AppCard key={`row2-${i}`} name={item} />
                    ))}
                </div>

            </div>
        </section>
    );
}
