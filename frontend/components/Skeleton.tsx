// Loading skeletons (N-7). The shape of a page arriving, in place of a bare
// "Loading..." line. Same visual language as Mission Control's
// ActionBriefLoading and /app/1-1s's LoadingState: `animate-pulse`, `bg-sunken`
// for text-sized bars, `bg-surface` for card-sized blocks, one role="status"
// with a label that names what is loading.
//
// - SkeletonSection: the content area only, for pages that already render
//   their own title and intro while data loads.
// - PageSkeleton: a whole page (PageShell + title bars + a section), for
//   pages that return early before anything is on screen.

import PageShell, { PageShellMaxWidth } from "@/components/PageShell";

export type SkeletonVariant = "cards" | "columns" | "list" | "rows";

function Bar({ className }: { className: string }) {
  return <div className={`rounded bg-sunken ${className}`} />;
}

function Block({ className }: { className: string }) {
  return <div className={`rounded-xl bg-surface ${className}`} />;
}

function Body({ variant }: { variant: SkeletonVariant }) {
  switch (variant) {
    case "cards":
      return (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Block key={i} className="h-20" />
            ))}
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Block key={i} className="h-56" />
            ))}
          </div>
        </>
      );
    case "columns":
      return (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Block className="h-72" />
          <Block className="h-96" />
        </div>
      );
    case "list":
      return (
        <div className="space-y-2.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Block key={i} className="h-16" />
          ))}
        </div>
      );
    case "rows":
      return (
        <div className="space-y-2">
          <Bar className="h-4 w-3/4" />
          <Bar className="h-4 w-2/3" />
          <Bar className="h-4 w-1/2" />
        </div>
      );
  }
}

export function SkeletonSection({
  label,
  variant = "cards",
  className = "",
}: {
  label: string;
  variant?: SkeletonVariant;
  className?: string;
}) {
  return (
    <div className={`animate-pulse ${className}`.trim()} role="status" aria-label={label}>
      <Body variant={variant} />
    </div>
  );
}

export function PageSkeleton({
  label,
  variant = "columns",
  maxWidth = "7xl",
}: {
  label: string;
  variant?: SkeletonVariant;
  maxWidth?: PageShellMaxWidth;
}) {
  return (
    <PageShell maxWidth={maxWidth}>
      <div className="animate-pulse" role="status" aria-label={label}>
        <Bar className="h-7 w-48" />
        <Bar className="mt-3 h-4 w-80 max-w-full" />
        <div className="mt-5">
          <Body variant={variant} />
        </div>
      </div>
    </PageShell>
  );
}
