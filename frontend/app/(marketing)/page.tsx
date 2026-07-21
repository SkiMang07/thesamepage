// Statically generated marketing home page — this is the SEO-facing entry
// point, which is the whole reason this project uses Next.js instead of a
// plain Vite SPA (Prism Tree's stack). No client-side data fetching here.
export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">
        The management judgment nobody trained you on.
      </h1>
      <p className="mt-4 text-lg text-gray-600">
        The Same Page helps first-time managers prep for real 1:1s, remember
        what they promised their team, and handle the conversations they
        never got taught how to have.
      </p>
      <div className="mt-8 flex gap-4">
        <a href="/app/login" className="rounded-md bg-gray-900 px-5 py-3 text-white">
          Get started
        </a>
        <a href="/pricing" className="rounded-md border border-gray-300 px-5 py-3">
          See pricing
        </a>
      </div>
    </main>
  );
}
