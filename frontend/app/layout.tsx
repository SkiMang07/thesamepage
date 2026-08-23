import type { Metadata, Viewport } from "next";
import "./globals.css";
import { HEX } from "@/lib/tokens";

export const metadata: Metadata = {
  title: "The Same Page — a management OS for first-time managers",
  description:
    "Prep for 1:1s, track commitments, and get judgment you weren't taught — built for managers who never got management training.",
  icons: {
    // SVG first for modern browsers; the PNG is the iOS home-screen icon.
    // Both use the widened-channel small cut knocked out of a teal tile —
    // the full mark closes up into a blob below ~32px.
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: HEX.brand,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-canvas text-ink">{children}</body>
    </html>
  );
}
