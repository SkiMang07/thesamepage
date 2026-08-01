"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getDirectReport,
  getOneOnOneHistory,
  getCommitments,
  updateCommitment,
  expectationName,
  DirectReport,
  OneOnOne,
  Commitment,
  Expectation,
} from "@/lib/api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ExpectationGroup({ label, items }: { label: string; items: Expectation[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</h3>
      <ul className="mt-2 space-y-2">
        {items.map((e) => (
          <li key={e.id} className="rounded-lg border border-gray-200 px-4 py-2.5">
            <p className="text-sm font-medium text-gray-800">{expectationName(e)}</p>
            {(e.expectation || e.description) && (
              <p className="mt-0.5 text-sm text-gray-500">{e.expectation || e.description}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function isOverdue(dueDate: string | null) {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate + "T00:00:00") < today;
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<DirectReport | null>(null);
  const [history, setHistory] = useState<OneOnOne[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getDirectReport(id),
      getOneOnOneHistory(id),
      getCommitments({ directReportId: id }),
    ])
      .then(([dr, h, c]) => {
        setReport(dr);
        setHistory(h);
        setCommitments(c);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function setStatus(commitmentId: string, status: Commitment["status"]) {
    setUpdatingId(commitmentId);
    try {
      const updated = await updateCommitment(commitmentId, status);
      setCommitments((cs) => cs.map((c) => (c.id === commitmentId ? { ...c, ...updated } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update commitment");
    } finally {
      setUpdatingId(null);
    }
  }

  if (loading) return <p className="p-8 text-gray-500">Loading...</p>;
  if (error) return <p className="p-8 text-red-500">{error}</p>;
  if (!report) return null;

  const open = commitments.filter((c) => c.status === "open");
  const resolved = commitments.filter((c) => c.status !== "open");

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link href="/app/dashboard" className="text-sm text-gray-500 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{report.name}</h1>
          {report.role_title && (
            <p className="mt-1 text-gray-500">{report.role_title}</p>
          )}
        </div>
        <Link
          href={`/app/reports/${id}/prep`}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Start 1:1 prep →
        </Link>
      </div>

      {/* Notes */}
      {report.notes && (
        <div className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">About</h2>
          <p className="mt-2 text-gray-700">{report.notes}</p>
        </div>
      )}

      {/* Role expectations — only when a role is assigned in Settings */}
      {report.expectations && (
        <div className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
            Expectations
          </h2>
          <p className="mt-2 text-gray-700">
            {report.expectations.role_level.job_role} · Level {report.expectations.role_level.job_level}
            {report.expectations.role_level.functional_team &&
              ` · ${report.expectations.role_level.functional_team}`}
          </p>
          {report.expectations.metrics.length +
            report.expectations.skills.length +
            report.expectations.values.length ===
          0 ? (
            <p className="mt-3 text-gray-500">
              No expectations configured for this role yet.{" "}
              <Link href="/app/settings" className="underline hover:text-gray-700">
                Add them in Settings
              </Link>
              .
            </p>
          ) : (
            <>
              <ExpectationGroup label="Metrics" items={report.expectations.metrics} />
              <ExpectationGroup label="Skills" items={report.expectations.skills} />
              <ExpectationGroup label="Values" items={report.expectations.values} />
            </>
          )}
        </div>
      )}

      {/* Open commitments */}
      <div className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
          Open commitments{open.length > 0 && ` (${open.length})`}
        </h2>

        {open.length === 0 ? (
          <p className="mt-4 text-gray-500">
            Nothing outstanding. Commitments you make in 1:1s show up here.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {open.map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-3 rounded-lg border border-gray-200 px-4 py-3"
              >
                <input
                  type="checkbox"
                  checked={false}
                  disabled={updatingId === c.id}
                  onChange={() => setStatus(c.id, "done")}
                  aria-label={`Mark done: ${c.description}`}
                  className="mt-1 h-4 w-4 cursor-pointer rounded border-gray-300"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-gray-800">{c.description}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {c.due_date ? (
                      <span className={isOverdue(c.due_date) ? "font-medium text-red-500" : ""}>
                        Due {formatDate(c.due_date + "T00:00:00")}
                        {isOverdue(c.due_date) && " — overdue"}
                      </span>
                    ) : (
                      <>Added {formatDate(c.created_at)}</>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setStatus(c.id, "dropped")}
                  disabled={updatingId === c.id}
                  className="text-xs text-gray-400 hover:text-gray-600"
                  title="No longer relevant"
                >
                  Drop
                </button>
              </li>
            ))}
          </ul>
        )}

        {resolved.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowResolved((s) => !s)}
              className="text-sm text-gray-500 hover:underline"
            >
              {showResolved ? "Hide" : "Show"} resolved ({resolved.length})
            </button>
            {showResolved && (
              <ul className="mt-3 space-y-2">
                {resolved.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-4 py-1 text-sm">
                    <span className="mt-0.5 text-gray-400">
                      {c.status === "done" ? "✓" : "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-500 line-through decoration-gray-300">
                        {c.description}
                      </p>
                      <p className="text-xs text-gray-400">
                        {c.status === "done"
                          ? `Done${c.completed_at ? ` ${formatDate(c.completed_at)}` : ""}`
                          : "Dropped"}
                      </p>
                    </div>
                    <button
                      onClick={() => setStatus(c.id, "open")}
                      disabled={updatingId === c.id}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Reopen
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 1:1 History */}
      <div className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">1:1 History</h2>

        {history.length === 0 ? (
          <p className="mt-4 text-gray-500">No 1:1s logged yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-200">
            {history.map((h) => (
              <li key={h.id} className="py-4">
                <p className="text-xs text-gray-400">{formatDate(h.created_at)}</p>
                <p className="mt-1 text-gray-700">{h.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
