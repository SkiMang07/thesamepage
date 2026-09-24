"use client";

// Shown when some of a page's sections failed to load (see lib/sectionLoader.ts).
// Names what's missing so an empty card isn't read as "nothing here".
export default function PartialLoadNotice({ failed, className = "" }: { failed: string[]; className?: string }) {
  if (failed.length === 0) return null;
  const list =
    failed.length === 1
      ? failed[0]
      : `${failed.slice(0, -1).join(", ")} and ${failed[failed.length - 1]}`;
  return (
    <p role="status" className={`rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 ${className}`}>
      Couldn&rsquo;t load {list}. Everything else is up to date.{" "}
      <button type="button" onClick={() => window.location.reload()} className="underline underline-offset-2">
        Refresh to try again
      </button>
      .
    </p>
  );
}
