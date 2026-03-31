import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import SkillsHero from "@/components/SkillsHero";
import MarqueeSection from "@/components/MarqueeSection";
import DocsSection from "@/components/DocsSection";
import BigBrand from "@/components/BigBrand";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="relative bg-black">
      <Navbar />
      <Hero />

      {/* Foreground layer that slides over the fixed hero */}
      <div
        className="relative z-10 w-full flex flex-col bg-black -mt-[100vh]"
        style={{
          // Slice the top left corner of the entire bottom half to reveal the Shrinking Hero
          clipPath: "polygon(0 8vw, 100% 0, 100% 100%, 0 100%)"
        }}
      >
        <MarqueeSection />
        <SkillsHero />
        <DocsSection />
        <BigBrand />
        <Footer />
      </div>
    </main>
  );
}
