"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { prepOneOnOne, logOneOnOne, PrepResponse, AgendaItem } from "@/lib/api";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AgendaCard({ item, index }: { item: AgendaItem; index: number }) {
  const [open, setOpen] = useState(index === 0); // first card open by default

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between px-5 py-4 text-left"
      >
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            {index + 1}
          </span>
          <p className="mt-0.5 font-medium text-gray-900">{item.title}</p>
        </div>
        <span className="ml-4 mt-1 shrink-0 text-gray-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 pb-5 pt-4">
          <p className="text-sm text-gray-500 italic">{item.rationale}</p>
          <ul className="mt-4 space-y-3">
            {item.suggested_questions.map((q, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 shrink-0 text-gray-300">→</span>
                <p className="text-gray-800">{q}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main prep flow
// ---------------------------------------------------------------------------

type Step = 1 | 2 | 3;

export default function PrepPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [step, setStep] = useState<Step>(1);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrep] = useState<PrepResponse | null>(null);

  // Step 3 fields
  const [summary, setSummary] = useState("");
  const [rawCommitments, setRawCommitments] = useState("");
  const [saving, setSaving] = useState(false);

  // Step 1 → 2: call AI prep endpoint
  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!notes.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await prepOneOnOne({ direct_report_id: id, raw_notes: notes });
      setPrep(result);
      setStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  // Step 3: log the 1:1
  async function handleLog(e: React.FormEvent) {
    e.preventDefault();
    if (!summary.trim()) return;
    setSaving(true);
    try {
      const new_commitments = rawCommitments
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      await logOneOnOne({ direct_report_id: id, summary, new_commitments });
      router.push(`/app/reports/${id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 1 — Notes input
  // ---------------------------------------------------------------------------
  if (step === 1) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <Link href={`/app/reports/${id}`} className="text-sm text-gray-500 hover:underline">
          ← Back
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">Prep for 1:1</h1>
        <p className="mt-2 text-gray-500">
          Jot down what's on your mind before the meeting — what's going on with
          this person, anything you're worried about, anything you want to celebrate.
          The more specific, the better the prep sheet.
        </p>

        <form onSubmit={handleGenerate} className="mt-8">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. She's been quiet in standups lately. She closed the Acme deal last week — worth calling out. There's a commitment from two weeks ago about the onboarding doc I need to follow up on."
            rows={8}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-800 placeholder-gray-400 focus:border-gray-900 focus:outline-none"
          />
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading || !notes.trim()}
            className="mt-4 w-full rounded-md bg-gray-900 px-4 py-3 font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          >
            {loading ? "Generating prep sheet…" : "Generate prep sheet →"}
          </button>
        </form>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Step 2 — Prep sheet
  // ---------------------------------------------------------------------------
  if (step === 2 && prep) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="flex items-center justify-between">
          <button onClick={() => setStep(1)} className="text-sm text-gray-500 hover:underline">
            ← Edit notes
          </button>
          <button
            onClick={() => setStep(3)}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Log this 1:1 →
          </button>
        </div>

        <h1 className="mt-6 text-2xl font-semibold">Your prep sheet</h1>

        {/* Situation summary */}
        <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-400">
            Where things stand
          </p>
          <p className="mt-2 text-gray-800">{prep.situation_summary}</p>
        </div>

        {/* Open commitments reminder */}
        {prep.open_commitments_to_check.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-500">
              Open commitments — follow up today
            </p>
            <ul className="mt-2 space-y-1">
              {prep.open_commitments_to_check.map((c, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-700">
                  <span className="text-amber-400">•</span>
                  <span>
                    {c.description}
                    {c.due_date && (
                      <span className="ml-1 text-gray-400">(due {c.due_date})</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Agenda items */}
        <div className="mt-8 space-y-3">
          <p className="text-sm font-medium uppercase tracking-wide text-gray-400">
            Agenda — {prep.agenda_items.length} items
          </p>
          {prep.agenda_items.map((item, i) => (
            <AgendaCard key={i} item={item} index={i} />
          ))}
        </div>

        <button
          onClick={() => setStep(3)}
          className="mt-8 w-full rounded-md bg-gray-900 px-4 py-3 font-medium text-white hover:bg-gray-700"
        >
          Log this 1:1 →
        </button>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Step 3 — Log the meeting
  // ---------------------------------------------------------------------------
  if (step === 3) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <button onClick={() => setStep(2)} className="text-sm text-gray-500 hover:underline">
          ← Back to prep sheet
        </button>
        <h1 className="mt-4 text-2xl font-semibold">Log the 1:1</h1>
        <p className="mt-2 text-gray-500">
          Write a quick summary of what you actually discussed, and note any new
          commitments you made. You'll see these next time you prep.
        </p>

        <form onSubmit={handleLog} className="mt-8 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Meeting summary
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What did you talk about? Any decisions made, concerns raised, wins celebrated?"
              rows={5}
              className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-800 placeholder-gray-400 focus:border-gray-900 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              New commitments{" "}
              <span className="font-normal text-gray-400">(one per line)</span>
            </label>
            <textarea
              value={rawCommitments}
              onChange={(e) => setRawCommitments(e.target.value)}
              placeholder={"Send intro to the design team by Friday\nShare onboarding doc template"}
              rows={4}
              className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-800 placeholder-gray-400 focus:border-gray-900 focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={saving || !summary.trim()}
            className="w-full rounded-md bg-gray-900 px-4 py-3 font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save and finish"}
          </button>
        </form>
      </main>
    );
  }

  return null;
}
