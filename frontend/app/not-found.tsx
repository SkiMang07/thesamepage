// Site-wide 404 (N-7). Covers unknown marketing URLs and unknown /app/* URLs
// alike, so it links both ways rather than assuming the visitor is signed in.
// Renders under the root layout only, on the light marketing theme.

import Link from "next/link";
import Logo from "@/components/Logo";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <Link href="/" className="mb-10 flex items-center gap-2.5">
        <Logo className="h-8 w-auto text-brand" />
        <span className="text-[15px] font-semibold tracking-tight text-ink">The Same Page</span>
      </Link>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Page not found</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">There’s nothing at this address.</h1>
      <p className="mt-3 text-ink-secondary">The link may be old, or the page may have moved.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/app/dashboard" className="rounded-md bg-brand px-5 py-3 text-white">
          Go to the app
        </Link>
        <Link href="/" className="rounded-md border border-control px-5 py-3 text-ink">
          Home page
        </Link>
      </div>
    </main>
  );
}
