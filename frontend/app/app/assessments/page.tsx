"use client";

// Assessments overview — start, resume or open a period assessment for each
// person. Quarterly or biannual, or off-cycle when there's a reason; this is
// not a weekly rating tool, so nothing here goes "stale" and nobody is
// ranked. A legacy rolling rating shows as context, never as a completed
// period assessment. See docs/systems/assessments.md.

import { useEffect, useState } from "react";
import Link from "next/link";
import { getTeamAssessments, TeamAssessmentItem } from "@/lib/api";
import PageShell from "@/components/PageShell";
import { SkeletonSection } from "@/components/Skeleton";
import { formatDay } from "@/lib/assessment-periods";
import { BTN_PRIMARY_SM, BTN_SECONDARY } from "@/lib/tokens";

const STAGE_LABEL: Record<string, string> = {
  picture: "checking the picture",
  draft: "draft & discuss",
  review: "final review",
};

export default function AssessmentsPage() {
  const [team, setTeam] = useState<TeamAssessmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTeamAssessments()
      .then(setTeam)
      .catch(() => setError("Assessments couldn’t be loaded. This is a connection problem, not an empty team."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell maxWidth="6xl">
      <h1 className="font-serif text-[2.3rem] font-normal leading-none tracking-[-0.03em] text-ink sm:text-[2.6rem]">Assessments</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-secondary">
        Quarterly or biannual — or off-cycle when there’s a reason. AI brings the period together and drafts against each role’s expectations; you decide every judgment.
      </p>

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      {loading ? (
        <SkeletonSection label="Loading assessments" variant="list" className="mt-6" />
      ) : !error && team.length === 0 ? (
        <p className="mt-6 text-ink-secondary">
          No direct reports yet.{" "}
          <Link href="/app/dashboard" className="underline hover:text-ink-body">
            Add your first one
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-divider rounded-xl border border-hairline bg-surface">
          {team.map((r) => {
            const open = r.open_review;
            const last = r.last_review;
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <Link href={`/app/assessments/${r.id}`} className="font-medium text-ink hover:underline">
                    {r.name}
                  </Link>
                  {r.role_title && <p className="text-sm text-ink-secondary">{r.role_title}</p>}
                </div>
                <div className="flex flex-1 flex-wrap items-center justify-end gap-x-6 gap-y-2 text-sm">
                  <div className="text-right">
                    {open ? (
                      <p className="text-amber-700">In progress · {open.review_period.split(" · ")[0]} · {STAGE_LABEL[open.stage] || "draft"}</p>
                    ) : null}
                    {last ? (
                      <p className="text-ink-body">
                        {last.review_period.split(" · ")[0]}
                        {r.latest_from_review && r.latest_level_label ? ` · ${r.latest_level_label}` : ""}
                        <span className="text-ink-muted"> · completed {formatDay(last.completed_at)}</span>
                      </p>
                    ) : r.latest_level_label ? (
                      <p className="text-ink-secondary">
                        Latest rating {r.latest_level_label}
                        <span className="text-ink-muted"> · {formatDay(r.assessed_at)} · not a period assessment</span>
                      </p>
                    ) : (
                      !open && <p className="text-ink-muted">No assessments yet</p>
                    )}
                  </div>
                  {open ? (
                    <Link href={`/app/assessments/${r.id}/${open.id}`} className={BTN_PRIMARY_SM}>
                      Resume
                    </Link>
                  ) : (
                    <Link href={`/app/assessments/${r.id}`} className={last ? BTN_SECONDARY : BTN_PRIMARY_SM}>
                      Start assessment
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
