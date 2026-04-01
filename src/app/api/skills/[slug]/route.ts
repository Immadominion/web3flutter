import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const ALLOWED_SLUGS = new Set([
    "solana-package",
    "borsh",
    "coral-xyz",
    "solana-mobile",
    "token-ops",
    "nft-dev",
    "defi-patterns",
    "wallet-ux",
]);

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ slug: string }> }
) {
    const { slug } = await params;

    // Allowlist to prevent path traversal
    if (!ALLOWED_SLUGS.has(slug)) {
        return new NextResponse("Not found", { status: 404 });
    }

    const filePath = path.join(process.cwd(), "docs", "skills", `${slug}.md`);

    if (!fs.existsSync(filePath)) {
        return new NextResponse("Not found", { status: 404 });
    }

    const content = fs.readFileSync(filePath, "utf-8");

    return new NextResponse(content, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600, s-maxage=86400",
        },
    });
}
