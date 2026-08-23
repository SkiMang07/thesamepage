"use client";

// Standalone "Log a 1:1" — for conversations that happened without prep
// (hallway chats, ad-hoc calls). Same notes → AI wrap-up → review flow as
// the prep page, minus the prep sheet.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDirectReport, wrapUpOneOnOne, WrapUpDraft } from "@/lib/api";
import PageShell from "@/components/PageShell";
import { SECTION_GAP } from "@/components/ZoneMap";
import WrapUpReview from "../wrap-up-review";

export default function LogOneOnOnePage() {
  const { id } = useParams<{ id: string }>();

  const [notes, setNotes] = useState("");
  const [reportName, setReportName] = useState("");
  const [wrappingUp, setWrappingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<WrapUpDraft | null>(null);

  useEffect(() => {
    getDirectReport(id)
      .then((dr) => setReportName(dr.name))
      .catch(() => {});
  }, [id]);

  async function handleWrapUp(e: React.FormEvent) {
    e.preventDefault();
    if (!notes.trim()) return;
    setWrappingUp(true);
    setError(null);
    try {
      const result = await wrapUpOneOnOne({ direct_report_id: id, raw_notes: notes });
      setDraft(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setWrappingUp(false);
    }
  }

  if (draft) {
    return (
      <WrapUpReview
        directReportId={id}
        reportName={reportName}
        rawNotes={notes}
        draft={draft}
        onBack={() => setDraft(null)}
        backLabel="Back to notes"
      />
    );
  }

  return (
    <PageShell maxWidth="2xl">
      <Link href={`/app/reports/${id}`} className="text-sm text-ink-secondary hover:underline">
        ← Back
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">
        Log a 1:1{reportName && ` with ${reportName.split(" ")[0]}`}
      </h1>
      <p className="mt-2 text-ink-secondary">
        For conversations that happened without prep. Type what you talked
        about, or paste your notes from Granola or whatever you record with —
        we&apos;ll draft the summary and pull out the commitments for you to review.
      </p>

      <form onSubmit={handleWrapUp} className={SECTION_GAP}>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={"– Caught up after standup about the Acme renewal\n– I'll pull the usage numbers before Thursday\n– She'll set up a call with their new champion"}
          rows={10}
          className="w-full rounded-lg border border-control px-4 py-3 text-ink-body placeholder-ink-faint focus:border-brand focus:outline-none"
        />
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={wrappingUp || !notes.trim()}
          className="mt-4 w-full rounded-md bg-brand px-4 py-3 font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
        >
          {wrappingUp ? "Drafting your log…" : "Wrap up & log →"}
        </button>
      </form>
    </PageShell>
  );
}
