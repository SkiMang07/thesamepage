// Statically generated marketing home page — this is the SEO-facing entry
// point, which is the whole reason this project uses Next.js instead of a
// plain Vite SPA (Prism Tree's stack). No client-side data fetching here.
import Logo from "@/components/Logo";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      {/* Logo is a plain server component (inline SVG, no hooks), so it stays
          SSG-renderable here — see docs/DESIGN.md on the marketing routes. */}
      <div className="mb-10 flex items-center gap-2.5">
        <Logo className="h-8 w-auto text-brand" />
        <span className="text-[15px] font-semibold tracking-tight text-ink">The Same Page</span>
      </div>
      <h1 className="text-4xl font-semibold tracking-tight">
        The management judgment nobody trained you on.
      </h1>
      <p className="mt-4 text-lg text-ink-secondary">
        The Same Page helps first-time managers prep for real 1:1s, remember
        what they promised their team, and handle the conversations they
        never got taught how to have.
      </p>
      <div className="mt-8 flex gap-4">
        <a href="/app/login" className="rounded-md bg-brand px-5 py-3 text-white">
          Get started
        </a>
        <a href="/pricing" className="rounded-md border border-control px-5 py-3">
          See pricing
        </a>
      </div>
    </main>
  );
}
