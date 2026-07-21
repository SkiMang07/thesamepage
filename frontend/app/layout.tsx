import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Same Page — a management OS for first-time managers",
  description:
    "Prep for 1:1s, track commitments, and get judgment you weren't taught — built for managers who never got management training.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased text-gray-900">{children}</body>
    </html>
  );
}
