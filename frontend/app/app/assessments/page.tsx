"use client";

// Assessments — the ratings/status layer (Session 16, 2026-08-04). Own
// top-level page, same reasoning as Goals/Projects/Org/Capacity: this gets
// written to regularly, not configured once. See docs/SESSION_HISTORY.md
// and the assessments_scoping project memory note for the scoping
// conversation with Andrew.
//
// This page is the team-wide list — current overall rating per report,
// click through to /app/assessments/[reportId] for the full scorecard
// (per-metric/skill/value scores + the AI-draft flow).

import { useEffect, useState } from "react";
import Link from "next/link";
import { getTeamAssessments, TeamAssessmentItem } from "@/lib/api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Warmer color the higher the ordinal reads relative to a 1-5 scale — a
// rough visual cue, not a precise mapping to whatever labels the org set.
function levelStyle(ordinal: number | null): string {
  if (ordinal === null) return "bg-gray-100 text-gray-400";
  if (ordinal <= 1) return "bg-red-50 text-red-600";
  if (ordinal === 2) return "bg-amber-50 text-amber-600";
  if (ordinal === 3) return "bg-gray-100 text-gray-600";
  if (ordinal === 4) return "bg-green-50 text-green-600";
  return "bg-blue-50 text-blue-600";
}

export default function AssessmentsPage() {
  const [team, setTeam] = useState<TeamAssessmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTeamAssessments()
      .then(setTeam)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Assessments</h1>
      <p className="mt-1 text-sm text-gray-500">
        How each person is doing against their role&apos;s configured expectations — metrics, skills, and values.
      </p>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
      {loading ? (
        <p className="mt-8 text-gray-500">Loading...</p>
      ) : team.length === 0 ? (
        <p className="mt-8 text-gray-500">
          No direct reports yet.{" "}
          <Link href="/app/dashboard" className="underline hover:text-gray-700">
            Add your first one
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {team.map((r) => (
            <li key={r.id}>
              <Link
                href={`/app/assessments/${r.id}`}
                className="block rounded-lg border border-gray-200 px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-50"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{r.name}</p>
                    {r.role_title && <p className="text-sm text-gray-500">{r.role_title}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${levelStyle(r.latest_level_ordinal)}`}>
                    {r.latest_level_label ?? "Not yet assessed"}
                  </span>
                </div>
                {r.assessed_at && (
                  <p className="mt-2 text-xs text-gray-400">Last assessed {formatDate(r.assessed_at)}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
