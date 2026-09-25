"use client";

// "Record an update" — opens in place on a project brief. Status, optional
// whole-number completion %, optional note. Blank completion means no new
// value (the earlier one keeps its own date); 0 is a real value.
//
// The draft lives in the page, per project, so a failed save or a close keeps
// what was typed. `requestId` is the idempotency key: a retry after a network
// failure re-sends it and the server returns the row it may already have
// written instead of saving twice.

import { useEffect, useRef, useState } from "react";
import NoteField from "@/components/NoteField";
import type { Project, ProjectStatus } from "@/lib/api";
import { BTN_PRIMARY_SM, INPUT, LABEL } from "@/lib/tokens";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_ORDER, formatMoment, parseCompletion } from "@/lib/projects";

export type UpdateDraft = { status: ProjectStatus; completion: string; note: string; requestId: string };

export function isUpdateDirty(d: UpdateDraft, p: Project) {
  return d.status !== p.status || d.completion.trim() !== "" || d.note.trim() !== "";
}

export default function ProjectUpdateForm({
  project,
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
  vocabulary,
}: {
  project: Project;
  draft: UpdateDraft;
  onDraftChange: (d: UpdateDraft) => void;
  onSubmit: (parsed: { status: ProjectStatus; progress: number | null; note: string | null }) => Promise<void>;
  onCancel: () => void;
  vocabulary?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const id = `project-${project.id}-update`;

  useEffect(() => noteRef.current?.focus({ preventScroll: true }), []);
  const set = (patch: Partial<UpdateDraft>) => onDraftChange({ ...draft, ...patch });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const completion = parseCompletion(draft.completion);
    if (!completion.ok) return setError(completion.error);
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ status: draft.status, progress: completion.value, note: draft.note.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The update wasn't saved. Your entries are still here — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !saving && !(e.target instanceof HTMLTextAreaElement)) {
          e.stopPropagation();
          onCancel();
        }
      }}
      aria-labelledby={`${id}-heading`}
    >
      <h3 id={`${id}-heading`} className="text-sm font-semibold text-ink">
        What changed?
      </h3>
      <div className="mt-3">
        <label htmlFor={`${id}-note`} className={LABEL}>
          Update · optional
        </label>
        <NoteField
          id={`${id}-note`}
          ref={noteRef}
          value={draft.note}
          onChange={(note) => set({ note })}
          rows={3}
          vocabulary={vocabulary}
          placeholder="What moved forward, what’s uncertain, what needs a decision?"
        />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-status`} className={LABEL}>
            Status
          </label>
          <select
            id={`${id}-status`}
            value={draft.status}
            onChange={(e) => set({ status: e.target.value as ProjectStatus })}
            className={INPUT}
          >
            {PROJECT_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-completion`} className={LABEL}>
            Completion % · optional
          </label>
          <input
            id={`${id}-completion`}
            type="number"
            inputMode="numeric"
            step={1}
            min={0}
            max={100}
            value={draft.completion}
            onChange={(e) => set({ completion: e.target.value })}
            placeholder={project.progress != null ? `Last: ${project.progress}%` : "Leave blank"}
            aria-describedby={`${id}-completion-help`}
            className={INPUT}
          />
        </div>
      </div>
      <p id={`${id}-completion-help`} className="mt-2 text-xs text-ink-muted">
        {project.progress != null && project.progress_at
          ? `Blank keeps ${project.progress}% from ${formatMoment(project.progress_at)} with its own date.`
          : "Blank means no completion value. 0 is recorded as 0%."}{" "}
        Saving adds a dated entry to the record. Nothing is sent.
      </p>
      <div role="alert" aria-live="assertive">
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={saving} className={BTN_PRIMARY_SM}>
          {saving ? "Saving..." : "Save update"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="text-sm text-ink-secondary hover:text-ink">
          Keep draft &amp; close
        </button>
      </div>
    </form>
  );
}
