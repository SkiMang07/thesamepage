// Load a page's data section by section instead of all-or-nothing.
//
// Pages that fan out a dozen GETs used to wrap them in one Promise.all, so a
// single failed request threw away every other result and replaced the page
// with an error line. A page now keeps its essential request(s) bare (if the
// page can't render without it, failing loudly is right) and wraps every
// other request in `optional()`, which swaps a failure for a fallback and
// records a readable label. The page shows <PartialLoadNotice> with those
// labels, so an empty section is never silently passed off as "no data".
//
// This file makes no backend calls itself; those stay in lib/api.ts.

export type SectionLoader = {
  optional: <T>(label: string, request: Promise<T>, fallback: T) => Promise<T>;
  failed: () => string[];
};

export function createSectionLoader(): SectionLoader {
  const failed: string[] = [];
  return {
    optional<T>(label: string, request: Promise<T>, fallback: T): Promise<T> {
      return request.catch((e: unknown) => {
        console.error(`[load] ${label} failed`, e);
        failed.push(label);
        return fallback;
      });
    },
    failed: () => [...failed],
  };
}
