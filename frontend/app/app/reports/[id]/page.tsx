"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDirectReport, getOneOnOneHistory, DirectReport, OneOnOne } from "@/lib/api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<DirectReport | null>(null);
  const [history, setHistory] = useState<OneOnOne[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getDirectReport(id), getOneOnOneHistory(id)])
      .then(([dr, h]) => {
        setReport(dr);
        setHistory(h);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="p-8 text-gray-500">Loading...</p>;
  if (error) return <p className="p-8 text-red-500">{error}</p>;
  if (!report) return null;

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
