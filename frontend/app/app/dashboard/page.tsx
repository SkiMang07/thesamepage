"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getTeamOverview, createDirectReport, TeamOverviewItem } from "@/lib/api";

// Matches the prep prompt's cadence logic in one_on_ones.py — past 21 days
// we stop assuming last meeting's context still holds.
const CADENCE_DAYS = 21;

function daysSince(iso: string) {
  const then = new Date(iso).getTime();
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

function lastOneOnOneLabel(iso: string | null) {
  if (!iso) return "No 1:1s yet";
  const d = daysSince(iso);
  if (d === 0) return "Last 1:1 today";
  if (d === 1) return "Last 1:1 yesterday";
  return `Last 1:1 ${d} days ago`;
}

function needsOneOnOne(item: TeamOverviewItem) {
  if (!item.last_one_on_one_at) return true;
  return daysSince(item.last_one_on_one_at) > CADENCE_DAYS;
}

export default function DashboardPage() {
  const [team, setTeam] = useState<TeamOverviewItem[]>([]);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getTeamOverview()
      .then(setTeam)
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function addReport(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || adding) return;
    setAdding(true);
    try {
      const created = await createDirectReport({ name: name.trim() });
      setTeam((t) => [
        ...t,
        { id: created.id, name: created.name, role_title: created.role_title, last_one_on_one_at: null, open_commitment_count: 0 },
      ]);
      setName("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  }

  const dueCount = team.filter(needsOneOnOne).length;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Your team</h1>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <Link href="/app/goals" className="hover:text-gray-900">
            Goals
          </Link>
          <Link href="/app/projects" className="hover:text-gray-900">
            Projects
          </Link>
          <Link href="/app/org" className="hover:text-gray-900">
            Org
          </Link>
          <Link href="/app/settings" className="hover:text-gray-900">
            Settings
          </Link>
        </div>
      </div>
      {!loading && team.length > 0 && (
        <p className="mt-1 text-sm text-gray-500">
          {dueCount === 0
            ? "You're up to date with everyone."
            : `${dueCount} ${dueCount === 1 ? "person is" : "people are"} due for a 1:1.`}
        </p>
      )}

      <form onSubmit={addReport} className="mt-6 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a direct report"
          className="flex-1 rounded-md border border-gray-300 px-4 py-2"
        />
        <button
          type="submit"
          disabled={adding}
          className="rounded-md bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {loadError && <p className="mt-4 text-sm text-red-500">{loadError}</p>}
      {loading && <p className="mt-8 text-gray-500">Loading...</p>}

      <ul className="mt-8 space-y-3">
        {team.map((r) => {
          const due = needsOneOnOne(r);
          return (
            <li key={r.id}>
              <Link
                href={`/app/reports/${r.id}`}
                className="block rounded-lg border border-gray-200 px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-50"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{r.name}</p>
                    {r.role_title && (
                      <p className="text-sm text-gray-500">{r.role_title}</p>
                    )}
                  </div>
                  {due && (
                    <span className="shrink-0 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-600">
                      Time for a 1:1
                    </span>
                  )}
                </div>
                <div className="mt-3 flex gap-4 text-xs text-gray-400">
                  <span className={due ? "text-amber-600" : ""}>
                    {lastOneOnOneLabel(r.last_one_on_one_at)}
                  </span>
                  {r.open_commitment_count > 0 && (
                    <span>
                      {r.open_commitment_count} open commitment
                      {r.open_commitment_count === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
        {!loading && team.length === 0 && (
          <p className="py-3 text-gray-500">
            No one added yet. Add your first direct report above to get started.
          </p>
        )}
      </ul>
    </main>
  );
}
