"use client";

// Your next move on one project — private to the manager, never assigned or
// sent, and independent of the project's status. One open move at a time:
// write it, edit it, mark it done, then set the next one. Completed moves are
// kept below. Reopening is refused while a newer move is open.

import { useCallback, useEffect, useState } from "react";
import NoteField from "@/components/NoteField";
import {
  ApiError,
  createProjectFollowThrough,
  getProjectFollowThrough,
  updateProjectFollowThrough,
  type Project,
  type ProjectFollowThrough,
} from "@/lib/api";
import { BTN_GHOST, BTN_PRIMARY_SM, BTN_SECONDARY, LABEL } from "@/lib/tokens";
import { formatMoment } from "@/lib/projects";

function message(e: unknown, fallback: string) {
  if (e instanceof ApiError && e.status < 500) return e.detail || fallback;
  return fallback;
}

export default function FollowThroughPanel({
  project,
  draft,
  onDraftChange,
  onChanged,
  onClose,
  vocabulary,
}: {
  project: Project;
  draft: string | undefined;
  onDraftChange: (text: string | undefined) => void;
  /** A confirmed write: the page updates the brief/overview from it. */
  onChanged: (open: ProjectFollowThrough | null, receipt: string) => void;
  onClose: () => void;
  vocabulary?: string;
}) {
  const open = project.next_move ?? null;
  const [editing, setEditing] = useState(!open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ProjectFollowThrough[] | null>(null);
  const [doneError, setDoneError] = useState(false);
  const id = `project-${project.id}-next`;
  const text = draft ?? (editing && open ? open.body : "");

  const loadDone = useCallback(() => {
    setDoneError(false);
    getProjectFollowThrough(project.id)
      .then((rows) => setDone(rows.filter((r) => r.status === "done")))
      .catch(() => setDoneError(true));
  }, [project.id]);
  useEffect(() => loadDone(), [loadDone]);

  useEffect(() => {
    if (!open) setEditing(true);
  }, [open]);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return setError("Write the next move first.");
    void run(async () => {
      try {
        const saved = open
          ? await updateProjectFollowThrough(open.id, { body })
          : await createProjectFollowThrough(project.id, body);
        onDraftChange(undefined);
        setEditing(false);
        onChanged(saved, open ? "Your next move is updated." : "Your next move is saved. Only you can see it.");
      } catch (err) {
        setError(message(err, "Your next move wasn't saved. Your text is still here — try again."));
      }
    });
  };

  const markDone = () =>
    void run(async () => {
      if (!open) return;
      try {
        const saved = await updateProjectFollowThrough(open.id, { status: "done" });
        setDone((cur) => [saved, ...(cur ?? []).filter((d) => d.id !== saved.id)]);
        onDraftChange(undefined);
        setEditing(true);
        onChanged(null, "Marked done. Project status is unchanged.");
      } catch (err) {
        setError(message(err, "That wasn't saved. Try again."));
      }
    });

  const reopen = (item: ProjectFollowThrough) =>
    void run(async () => {
      try {
        const saved = await updateProjectFollowThrough(item.id, { status: "open" });
        setDone((cur) => (cur ?? []).filter((d) => d.id !== saved.id));
        onDraftChange(undefined);
        setEditing(false);
        onChanged(saved, "That move is open again.");
      } catch (err) {
        setError(message(err, "That wasn't reopened. Try again."));
      }
    });

  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-brand">Private · your next move</p>
      <p className="mt-1 text-xs text-ink-muted">
        One thing you intend to do for this project. It’s yours, not the project owner’s — nothing is assigned or sent.
      </p>

      {open && !editing ? (
        <div className="mt-3 rounded-md border-l-2 border-brand bg-canvas px-4 py-3">
          <p className="whitespace-pre-wrap break-words text-sm text-ink">{open.body}</p>
          <p className="mt-1 text-xs text-ink-muted">Set {formatMoment(open.created_at)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={markDone} disabled={busy} className={BTN_PRIMARY_SM}>
              Mark done
            </button>
            <button type="button" onClick={() => setEditing(true)} disabled={busy} className={BTN_SECONDARY}>
              Edit wording
            </button>
            <button type="button" onClick={onClose} className={BTN_GHOST}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <form noValidate onSubmit={save} className="mt-3">
          <label htmlFor={id} className={LABEL}>
            {open ? "Edit your next move" : done?.length ? "What’s your next move now?" : "What will you do?"}
          </label>
          <NoteField
            id={id}
            value={text}
            onChange={(v) => onDraftChange(v)}
            rows={2}
            vocabulary={vocabulary}
            placeholder="e.g. Agree who owns the first customer call"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className={BTN_PRIMARY_SM}>
              {busy ? "Saving..." : open ? "Save wording" : "Save my next move"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (open) {
                  onDraftChange(undefined);
                  setEditing(false);
                } else onClose();
              }}
              className="text-sm text-ink-secondary hover:text-ink"
            >
              {open ? "Cancel" : "Close"}
            </button>
          </div>
        </form>
      )}
      <div role="alert" aria-live="assertive">
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </div>

      {doneError ? (
        <p className="mt-4 text-xs text-ink-muted">
          Completed moves couldn’t load.{" "}
          <button type="button" onClick={loadDone} className="underline">
            Try again
          </button>
        </p>
      ) : done && done.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-ink-secondary hover:text-ink">Completed · {done.length}</summary>
          <ul className="mt-2 space-y-2">
            {done.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-divider pt-2">
                <span className="min-w-0 break-words text-sm text-ink-secondary">
                  <span aria-hidden>✓ </span>
                  {d.body}
                  <span className="ml-2 text-xs text-ink-muted">Done {d.completed_at ? formatMoment(d.completed_at) : ""}</span>
                </span>
                <button type="button" onClick={() => reopen(d)} disabled={busy} className="text-xs text-brand hover:text-brand-hover">
                  Reopen
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
