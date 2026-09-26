"use client";

// Company values: defined once, included in every role (value_configs with
// role_level_id IS NULL — fetch_role_expectations unions them into every
// role's expectations). Moved here from Settings with the same behaviour:
// add, edit, remove, and an AI draft that saves nothing until you choose
// what to keep.

import { useState } from "react";
import {
  ApiError,
  batchCreateExpectations,
  createExpectation,
  deleteExpectation,
  draftOrgValues,
  updateExpectation,
} from "@/lib/api";
import { BTN_GHOST, BTN_PRIMARY_SM, BTN_SECONDARY, CARD, INPUT, LABEL } from "@/lib/tokens";

type Value = { id: string; name: string; description: string | null };
type DraftRow = { name: string; description: string; included: boolean };

export default function CompanyValues({ values, onChanged }: { values: Value[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRows, setDraftRows] = useState<DraftRow[] | null>(null);
  const [drafting, setDrafting] = useState(false);

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof ApiError && e.status < 500 ? e.detail : fallback);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function startDraft() {
    setDrafting(true);
    setError(null);
    try {
      const draft = await draftOrgValues();
      setDraftRows(draft.values.map((v) => ({ name: v.name, description: v.description ?? "", included: true })));
    } catch {
      setError("A draft couldn't be written just now. You can add values yourself below.");
    } finally {
      setDrafting(false);
    }
  }

  const includedCount = draftRows?.filter((r) => r.included && r.name.trim()).length ?? 0;

  return (
    <section className={`${CARD} p-5`} aria-labelledby="company-values-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="company-values-heading" className="text-base font-semibold text-ink">
            Shared across your company
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">Company values are defined once and included in every role.</p>
        </div>
        <div className="flex gap-2">
          {!draftRows && (
            <button type="button" onClick={startDraft} disabled={drafting} className={BTN_GHOST}>
              {drafting ? "Drafting…" : "Suggest values"}
            </button>
          )}
          {!adding && (
            <button type="button" onClick={() => setAdding(true)} className={BTN_SECONDARY}>
              + Add a value
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {values.length === 0 && !adding && !draftRows && (
        <p className="mt-4 text-sm text-ink-muted">No company values yet. Roles work without them; add them when you have them.</p>
      )}

      {values.length > 0 && (
        <ul className="mt-4 divide-y divide-divider">
          {values.map((v) =>
            editing === v.id ? (
              <li key={v.id} className="py-3">
                <label className={LABEL} htmlFor={`value-name-${v.id}`}>
                  Value
                </label>
                <input id={`value-name-${v.id}`} value={editName} onChange={(e) => setEditName(e.target.value)} className={INPUT} />
                <label className={`${LABEL} mt-2`} htmlFor={`value-desc-${v.id}`}>
                  What living it looks like
                </label>
                <input id={`value-desc-${v.id}`} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className={INPUT} />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy || !editName.trim()}
                    className={BTN_PRIMARY_SM}
                    onClick={async () => {
                      const ok = await run(
                        () =>
                          updateExpectation("values", v.id, {
                            name: editName.trim(),
                            role_level_id: null,
                            description: editDescription.trim() || undefined,
                            value_type: "company",
                            order_type: "primary",
                          }),
                        "Couldn't save that value"
                      );
                      if (ok) setEditing(null);
                    }}
                  >
                    Save
                  </button>
                  <button type="button" className={BTN_GHOST} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </li>
            ) : (
              <li key={v.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{v.name}</p>
                  {v.description && <p className="mt-0.5 text-sm text-ink-secondary">{v.description}</p>}
                </div>
                <div className="flex shrink-0 gap-3">
                  <button
                    type="button"
                    className="text-xs text-ink-muted hover:text-ink-body"
                    onClick={() => {
                      setEditing(v.id);
                      setEditName(v.name);
                      setEditDescription(v.description ?? "");
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-xs text-ink-muted hover:text-red-700"
                    onClick={() => run(() => deleteExpectation("values", v.id), "This value has assessment history and can’t be removed.")}
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      )}

      {draftRows && (
        <div className="mt-4 rounded-lg border border-blue-600/30 bg-blue-50 p-4">
          <p className="text-sm font-medium text-ink">Suggested from your company name — keep only what’s true for you.</p>
          {draftRows.length === 0 && <p className="mt-2 text-sm text-ink-secondary">Nothing to suggest. Add your own below.</p>}
          <ul className="mt-3 space-y-2">
            {draftRows.map((row, i) => (
              <li key={i} className="flex items-start gap-2 rounded-md bg-surface p-2">
                <input
                  type="checkbox"
                  checked={row.included}
                  aria-label={`Keep ${row.name}`}
                  onChange={(e) => setDraftRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, included: e.target.checked } : r)))}
                  className="mt-2"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <input
                    value={row.name}
                    aria-label="Value"
                    onChange={(e) => setDraftRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                    className={INPUT}
                  />
                  <input
                    value={row.description}
                    aria-label="What living it looks like"
                    onChange={(e) => setDraftRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))}
                    className={INPUT}
                  />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || includedCount === 0}
              className={BTN_PRIMARY_SM}
              onClick={async () => {
                const rows = draftRows.filter((r) => r.included && r.name.trim());
                const ok = await run(
                  () =>
                    batchCreateExpectations(
                      "values",
                      null,
                      rows.map((r) => ({ name: r.name.trim(), description: r.description.trim() || null, value_type: "company", order_type: "primary" }))
                    ),
                  "Couldn't add those values"
                );
                if (ok) setDraftRows(null);
              }}
            >
              Add {includedCount} value{includedCount === 1 ? "" : "s"}
            </button>
            <button type="button" className={BTN_GHOST} onClick={() => setDraftRows(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {adding && (
        <form
          className="mt-4 grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const ok = await run(
              () =>
                createExpectation("values", {
                  name: name.trim(),
                  role_level_id: null,
                  order_type: "primary",
                  description: description.trim() || undefined,
                  value_type: "company",
                }),
              "Couldn't add that value"
            );
            if (ok) {
              setName("");
              setDescription("");
              setAdding(false);
            }
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Close the loop" aria-label="Value" className={INPUT} autoFocus />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What living it looks like (optional)"
            aria-label="What living it looks like"
            className={INPUT}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !name.trim()} className={BTN_PRIMARY_SM}>
              Add
            </button>
            <button type="button" className={BTN_GHOST} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
