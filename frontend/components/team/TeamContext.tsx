"use client";

// Must-knows and Training focus — two quiet, manager-only text blocks beside
// the meeting, one per exact scope (including a separate All teams block).
// Each is overwritten in place (team_callouts / team_dev_focus); there is no
// history and nothing is sent to anyone. Edit swaps the text for the same
// field, in place.

import { useEffect, useState } from "react";
import NoteField from "@/components/NoteField";
import {
  TeamCallout,
  TeamDevFocus,
  updateTeamCallout,
  updateTeamDevFocus,
} from "@/lib/api";
import { BTN_PRIMARY_SM, ERROR_TEXT } from "@/lib/tokens";

type Block = TeamCallout | TeamDevFocus;

export default function TeamContext({
  callout,
  devFocus,
  scopeLabel,
  onCalloutSaved,
  onDevFocusSaved,
}: {
  callout: TeamCallout;
  devFocus: TeamDevFocus;
  scopeLabel: string;
  onCalloutSaved: (row: TeamCallout) => void;
  onDevFocusSaved: (row: TeamDevFocus) => void;
}) {
  return (
    <div>
      <ContextBlock
        title="Must-knows"
        block={callout}
        scopeLabel={scopeLabel}
        asBullets
        emptyText="Nothing recorded."
        placeholder={"One per line, e.g.\nEnterprise tier scope is cut this quarter.\nQ3 roadmap draft due Friday."}
        disclosure="Context & scope"
        explanation="Your private reminders for this scope. Saving replaces this scope's text; it isn't an announcement and nothing is sent to your team."
        save={(text, orgUnitId) => updateTeamCallout(text, orgUnitId)}
        onSaved={onCalloutSaved}
      />
      <div className="my-5 border-t border-hairline" />
      <ContextBlock
        title="Training focus"
        block={devFocus}
        scopeLabel={scopeLabel}
        emptyText="No training focus set."
        placeholder="e.g. Practising escalation conversations with a clear request and owner."
        disclosure="Practice & scope"
        explanation="What you want this team to practise, in your words. It isn't an assessment and nothing is inferred from it."
        save={(text, orgUnitId) => updateTeamDevFocus(text, orgUnitId)}
        onSaved={onDevFocusSaved}
      />
    </div>
  );
}

function ContextBlock<T extends Block>({
  title,
  block,
  scopeLabel,
  asBullets = false,
  emptyText,
  placeholder,
  disclosure,
  explanation,
  save,
  onSaved,
}: {
  title: string;
  block: T;
  scopeLabel: string;
  asBullets?: boolean;
  emptyText: string;
  placeholder: string;
  disclosure: string;
  explanation: string;
  save: (text: string, orgUnitId: string | null) => Promise<T>;
  onSaved: (row: T) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(block.message);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The block stays mounted across team switches; without this a half-written
  // draft for one team could be saved against another.
  useEffect(() => {
    setEditing(false);
    setDraft(block.message);
    setError(null);
  }, [block.org_unit_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await save(draft, block.org_unit_id));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? "Couldn't save. Your text is still here — try again." : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const lines = block.message.split("\n").map((l) => l.trim()).filter(Boolean);
  const headingId = `context-${title.toLowerCase().replace(/\W+/g, "-")}`;

  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-sm font-medium text-ink">
          {title}
        </h3>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(block.message);
              setError(null);
              setEditing(true);
            }}
            className="rounded px-1 text-sm text-brand hover:text-brand-hover"
            aria-label={`Edit ${title}`}
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-2">
          <p className="mb-1.5 text-2xs text-ink-muted">{scopeLabel} · private to you</p>
          <NoteField value={draft} onChange={setDraft} rows={5} placeholder={placeholder} className="w-full text-sm" aria-label={title} />
          {error && <p className={`${ERROR_TEXT} mt-1`}>{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-md px-3 py-1.5 text-sm text-ink-secondary hover:bg-sunken hover:text-ink"
            >
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={saving} className={BTN_PRIMARY_SM}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : lines.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{emptyText}</p>
      ) : asBullets && lines.length > 1 ? (
        <ul className="mt-2 space-y-1.5 text-sm leading-6 text-ink-secondary">
          {lines.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-ink-faint" aria-hidden="true">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-ink-secondary">{block.message}</p>
      )}

      {!editing && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-brand hover:text-brand-hover">{disclosure}</summary>
          <p className="mt-1.5 leading-5 text-ink-muted">{explanation}</p>
          <p className="mt-1 text-ink-muted">{scopeLabel} · only visible to you</p>
        </details>
      )}
    </section>
  );
}
