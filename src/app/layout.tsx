import type { Metadata } from "next";
import { Nunito, Fira_Code, Lexend, Bebas_Neue } from "next/font/google";
import "./globals.css";
import SmoothScroll from "@/components/SmoothScroll";

const nunito = Nunito({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const firaCode = Fira_Code({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const lexend = Lexend({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const bebasNeue = Bebas_Neue({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Web3 Flutter HQ — Build Web3 with Flutter",
  description:
    "The ecosystem hub for Flutter × Web3 development. Skills, documentation, and everything you need to build on Solana with Flutter.",
  keywords: [
    "flutter",
    "web3",
    "solana",
    "dart",
    "blockchain",
    "mobile",
    "sdk",
    "wallet",
    "defi",
    "nft",
  ],
  openGraph: {
    title: "Web3 Flutter HQ",
    description: "The Flutter × Web3 ecosystem hub",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    creator: "@web3flutterhq",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${nunito.variable} ${firaCode.variable} ${lexend.variable} ${bebasNeue.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SmoothScroll>
          {children}
        </SmoothScroll>
      </body>
    </html>
  );
}
