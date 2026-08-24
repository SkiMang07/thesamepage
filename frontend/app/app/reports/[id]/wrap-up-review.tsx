"use client";

// Shared wrap-up review screen — used by the prep flow (after the call) and
// the standalone Log a 1:1 page. The AI drafts a summary + commitments from
// raw call notes; nothing is saved until the manager reviews and hits save.

import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { logOneOnOne, CommittedBy, WrapUpCommitment, WrapUpDraft } from "@/lib/api";
import PageShell from "@/components/PageShell";

type EditableCommitment = WrapUpCommitment & { key: number };
type EditableFollowUp = { key: number; text: string };

function ExpandingTextArea({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="min-h-6 min-w-0 flex-1 resize-none overflow-hidden border-0 p-0 leading-6 text-ink-body placeholder-ink-faint focus:outline-none focus:ring-0"
    />
  );
}

export default function WrapUpReview({
  directReportId,
  reportName,
  rawNotes,
  draft,
  onBack,
  backLabel,
  oneOnOneId,
  willRecur = false,
}: {
  directReportId: string;
  reportName: string;
  rawNotes: string;
  draft: WrapUpDraft;
  onBack: () => void;
  backLabel: string;
  // Set when this meeting was prepped (the planned one_on_ones row's id) —
  // saving fills in that row instead of creating a new one. Omitted for
  // ad-hoc logs from the standalone Log a 1:1 flow.
  oneOnOneId?: string;
  willRecur?: boolean;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(draft.summary);
  const [commitments, setCommitments] = useState<EditableCommitment[]>(
    draft.commitments.map((c, i) => ({ ...c, key: i }))
  );
  const [nextKey, setNextKey] = useState(draft.commitments.length);
  const [followUps, setFollowUps] = useState<EditableFollowUp[]>(
    (draft.follow_up_items ?? []).map((text, i) => ({ key: i, text }))
  );
  const [nextFollowUpKey, setNextFollowUpKey] = useState(draft.follow_up_items?.length ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstName = reportName.split(" ")[0] || "Them";

  function updateCommitment(key: number, patch: Partial<WrapUpCommitment>) {
    setCommitments((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function addCommitment() {
    setCommitments((cs) => [
      ...cs,
      { key: nextKey, description: "", committed_by: "manager", due_date: null },
    ]);
    setNextKey((k) => k + 1);
  }

  async function handleSave() {
    if (!summary.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await logOneOnOne({
        direct_report_id: directReportId,
        summary: summary.trim(),
        notes: rawNotes,
        new_commitments: commitments
          .map(({ key: _key, ...c }) => ({ ...c, description: c.description.trim() }))
          .filter((c) => c.description),
        carry_forward_items: followUps.map((item) => item.text.trim()).filter(Boolean),
        one_on_one_id: oneOnOneId,
      });
      router.push(`/app/reports/${directReportId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
      setSaving(false);
    }
  }

  function WhoToggle({ c }: { c: EditableCommitment }) {
    const base = "rounded-full px-3 py-1 text-xs font-medium";
    const on = "bg-brand text-on-brand";
    const off = "bg-sunken text-ink-secondary hover:bg-carbon-200";
    const set = (committed_by: CommittedBy) => updateCommitment(c.key, { committed_by });
    return (
      <div className="flex gap-1">
        <button type="button" onClick={() => set("manager")} className={`${base} ${c.committed_by === "manager" ? on : off}`}>
          You
        </button>
        <button type="button" onClick={() => set("direct_report")} className={`${base} ${c.committed_by === "direct_report" ? on : off}`}>
          {firstName}
        </button>
      </div>
    );
  }

  return (
    <PageShell maxWidth="2xl">
      <button onClick={onBack} className="text-sm text-ink-secondary hover:underline">
        ← {backLabel}
      </button>
      <h1 className="mt-4 text-2xl font-semibold">Review before saving</h1>
      <p className="mt-2 text-ink-secondary">
        Drafted from your notes — fix anything that&apos;s off. The summary shows up in
        history and next time you prep; commitments get tracked until resolved.
      </p>

      <div className="mt-8">
        <label className="block text-sm font-medium text-ink-body">Summary</label>
        {!draft.summary && (
          <p className="mt-1 text-sm text-amber-700">
            Couldn&apos;t draft a summary from these notes — write a quick one below.
          </p>
        )}
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={5}
          className="mt-2 w-full rounded-lg border border-control px-4 py-3 text-ink-body focus:border-brand focus:outline-none"
        />
      </div>

      <div className="mt-8">
        <p className="block text-sm font-medium text-ink-body">
          Carry into the next 1:1{" "}
          <span className="font-normal text-ink-muted">— unresolved topics worth revisiting</span>
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          These are suggestions from your notes. Confirm, edit, or remove them before saving.
        </p>

        {followUps.length === 0 && (
          <p className="mt-3 text-sm text-ink-secondary">
            Nothing was clearly left open. Add a topic if you want it waiting next time.
          </p>
        )}

        <ul className="mt-3 space-y-2">
          {followUps.map((item) => (
            <li key={item.key} className="flex items-start gap-3 rounded-lg border border-hairline px-4 py-3">
              <ExpandingTextArea
                value={item.text}
                onChange={(text) =>
                  setFollowUps((items) =>
                    items.map((current) =>
                      current.key === item.key ? { ...current, text } : current
                    )
                  )
                }
                placeholder="What should you revisit next time?"
                ariaLabel="Follow-up topic"
              />
              <button
                type="button"
                onClick={() => setFollowUps((items) => items.filter((current) => current.key !== item.key))}
                className="text-ink-faint hover:text-ink-secondary"
                title="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => {
            setFollowUps((items) => [...items, { key: nextFollowUpKey, text: "" }]);
            setNextFollowUpKey((key) => key + 1);
          }}
          className="mt-3 text-sm text-ink-secondary hover:underline"
        >
          + Add follow-up topic
        </button>
        <p className="mt-2 text-xs text-ink-muted">
          {willRecur
            ? "Saving completes this meeting and starts the next scheduled 1:1 with these topics ready."
            : "These topics will be saved for the next time you prepare with this person."}
        </p>
      </div>

      <div className="mt-8">
        <p className="block text-sm font-medium text-ink-body">
          Commitments{" "}
          <span className="font-normal text-ink-muted">— who owes what by when</span>
        </p>

        {commitments.length === 0 && (
          <p className="mt-3 text-sm text-ink-secondary">
            None picked up from the notes. Add one below if something was agreed.
          </p>
        )}

        <ul className="mt-3 space-y-3">
          {commitments.map((c) => (
            <li key={c.key} className="rounded-lg border border-hairline px-4 py-3">
              <div className="flex items-start gap-3">
                <ExpandingTextArea
                  value={c.description}
                  onChange={(description) => updateCommitment(c.key, { description })}
                  placeholder="What was agreed?"
                  ariaLabel="Commitment description"
                />
                <button
                  type="button"
                  onClick={() => setCommitments((cs) => cs.filter((x) => x.key !== c.key))}
                  className="text-ink-faint hover:text-ink-secondary"
                  title="Remove"
                >
                  ×
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <WhoToggle c={c} />
                <input
                  type="date"
                  value={c.due_date ?? ""}
                  onChange={(e) => updateCommitment(c.key, { due_date: e.target.value || null })}
                  className="rounded-md border border-hairline px-2 py-1 text-xs text-ink-secondary focus:border-control focus:outline-none"
                />
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={addCommitment}
          className="mt-3 text-sm text-ink-secondary hover:underline"
        >
          + Add commitment
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving || !summary.trim()}
        className="mt-8 w-full rounded-md bg-brand px-4 py-3 font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
      >
        {saving ? "Saving…" : willRecur ? "Save and start next 1:1" : "Save and finish"}
      </button>
    </PageShell>
  );
}
