"use client";

import { useEffect, useState } from "react";
import { getDirectReports, createDirectReport } from "@/lib/api";

type DirectReport = { id: string; name: string; role_title: string | null };

export default function DashboardPage() {
  const [reports, setReports] = useState<DirectReport[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    getDirectReports().then(setReports).catch(console.error);
  }, []);

  async function addReport(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const created = await createDirectReport({ name });
    setReports((r) => [...r, created]);
    setName("");
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Your team</h1>

      <form onSubmit={addReport} className="mt-6 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a direct report"
          className="flex-1 rounded-md border border-gray-300 px-4 py-2"
        />
        <button type="submit" className="rounded-md bg-gray-900 px-4 py-2 text-white">
          Add
        </button>
      </form>

      <ul className="mt-8 divide-y divide-gray-200">
        {reports.map((r) => (
          <li key={r.id} className="py-3">
            <a href={`/app/reports/${r.id}`} className="font-medium">{r.name}</a>
            {r.role_title && <span className="ml-2 text-gray-500">{r.role_title}</span>}
          </li>
        ))}
        {reports.length === 0 && <p className="py-3 text-gray-500">No one added yet.</p>}
      </ul>
    </main>
  );
}
