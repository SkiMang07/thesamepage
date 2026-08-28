"use client";

// Role JD import (Session 44 — see docs/ROLE_JD_IMPORT_SCOPING.md).
//
// Paste a job description (or drop a .pdf/.docx/.txt/.md) → one AI call
// extracts the role identity, proposes where it belongs among the ladders
// already set up, and drafts its expectations → the manager edits all of it
// → one commit. This kills the "type everything by hand" burden that left
// 13 dogfood roles with zero expectations.
//
// The commit uses ONLY endpoints the manual forms already use
// (createRoleFamily / createRoleLevel / updateRoleLevel / the three
// expectation batch calls), orchestrated here on the client — the AI
// drafts, the client confirms. There is no import-specific write endpoint,
// and the draft call saves nothing.
//
// Three states: input → drafting → review. A refusal ("that's a recipe, not
// a job description") returns to input with the pasted text intact rather
// than opening a review screen over an invented role.

import { useState } from "react";
import { INPUT, LABEL, BTN_PRIMARY } from "@/lib/tokens";
import NoteField from "@/components/NoteField";
import {
  RoleFamily,
  RoleImportMatch,
  RoleLevel,
  createRoleFamily,
  createRoleLevel,
  draftRoleImport,
  updateRoleLevel,
} from "@/lib/api";
import {
  DraftExpectationsReview,
  DraftMetricRow,
  DraftSkillRow,
  DraftValueRow,
  commitDraftExpectations,
  draftIncludedCount,
} from "./DraftExpectationRows";

// Local aliases so this file's existing call sites keep working; the value
// itself is the shared token, so restyling happens in one place.
const inputCls = INPUT;
const labelCls = LABEL;
const primaryBtnCls = BTN_PRIMARY;

const CREATE_NEW_FAMILY = "__new_ladder__";
const ACCEPTED_EXTENSIONS = ".pdf,.docx,.txt,.md";

export type RoleImportResult = {
  // Non-null only when this import created a brand-new ladder — the caller
  // merges it into its own roleFamilies state.
  family: RoleFamily | null;
  roleLevel: RoleLevel;
  mode: "created" | "updated";
  expectationsAdded: number;
};

export default function RoleImportPanel({
  roleLevels,
  roleFamilies,
  scopedFamilyId = null,
  onClose,
  onManualFallback,
  onCommitted,
}: {
  roleLevels: RoleLevel[];
  roleFamilies: RoleFamily[];
  // Set when the panel is opened from inside a ladder card ("Import from a
  // JD" on the add-a-level row): that ladder wins over whatever the AI
  // proposes, since the manager already told us where this goes.
  scopedFamilyId?: string | null;
  onClose: () => void;
  // "Start from scratch" — falls back to the manual RoleForm. Omitted at
  // entry points that have no manual form to fall back to.
  onManualFallback?: () => void;
  onCommitted: (result: RoleImportResult) => void | Promise<void>;
}) {
  const [stage, setStage] = useState<"input" | "drafting" | "review">("input");
  const [panelError, setPanelError] = useState<string | null>(null);
  // The honest-refusal line (scoping §3.3) — distinct from panelError so a
  // "this isn't a job description" reads as a verdict, not a crash.
  const [refusal, setRefusal] = useState<string | null>(null);

  // Input state — deliberately never cleared on refusal or failure.
  const [pastedText, setPastedText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  // Review state
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState(1);
  const [familyChoice, setFamilyChoice] = useState<string>(CREATE_NEW_FAMILY);
  const [team, setTeam] = useState("");
  const [responsibilities, setResponsibilities] = useState("");
  const [match, setMatch] = useState<RoleImportMatch | null>(null);
  const [otherRolesNote, setOtherRolesNote] = useState<string | null>(null);
  const [existsTargetId, setExistsTargetId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DraftMetricRow[]>([]);
  const [skills, setSkills] = useState<DraftSkillRow[]>([]);
  const [values, setValues] = useState<DraftValueRow[]>([]);
  const [committing, setCommitting] = useState(false);

  async function runDraft() {
    if (stage === "drafting") return;
    if (!file && !pastedText.trim()) return;
    setStage("drafting");
    setPanelError(null);
    setRefusal(null);
    try {
      const draft = await draftRoleImport(file ? { file } : { text: pastedText.trim() });
      if (!draft.is_job_description || !draft.role) {
        setRefusal(draft.reason ?? "That doesn't look like a job description.");
        setStage("input");
        return;
      }
      setTitle(draft.role.job_role);
      setLevel(draft.role.job_level || 1);
      setTeam(draft.role.functional_team ?? "");
      setResponsibilities(draft.role.job_responsibilities ?? "");
      setMatch(draft.match);
      setOtherRolesNote(draft.other_roles_note);
      // A pinned ladder (opened from inside a ladder card) beats the AI's
      // own match; otherwise take whatever it proposed, falling back to a
      // new ladder when it proposed create_new.
      const proposedFamilyId = scopedFamilyId ?? draft.match?.role_family_id ?? null;
      setFamilyChoice(
        proposedFamilyId && roleFamilies.some((f) => f.id === proposedFamilyId) ? proposedFamilyId : CREATE_NEW_FAMILY
      );
      setExistsTargetId(
        !scopedFamilyId && draft.match?.suggested_action === "exists" ? draft.match.existing_role_level_id : null
      );
      setMetrics(draft.expectations.metrics.map((m) => ({ ...m, included: true })));
      setSkills(draft.expectations.skills.map((s) => ({ ...s, included: true })));
      setValues(draft.expectations.values.map((v) => ({ ...v, included: true })));
      setStage("review");
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : "Couldn't read that job description");
      setStage("input");
    }
  }

  // --- ladder/level resolution + collision handling (scoping §3.2) -------
  const selectedFamilyId = familyChoice === CREATE_NEW_FAMILY ? null : familyChoice;
  const selectedFamily = roleFamilies.find((f) => f.id === selectedFamilyId) ?? null;
  const collision = selectedFamilyId
    ? roleLevels.find((rl) => rl.role_family_id === selectedFamilyId && rl.job_level === level)
    : undefined;
  // Back-fill mode: the level the manager is aiming at already exists and
  // they've said (or the AI proposed) "update that one" rather than "add
  // another". Derived from the current selection, not just the stored id,
  // so editing the ladder or level out from under it silently drops back to
  // create-mode instead of PUTting the wrong row.
  const backfillTarget = collision && collision.id === existsTargetId ? collision : undefined;
  const blockingCollision = collision && !backfillTarget ? collision : undefined;

  function nextFreeLevel(familyId: string): number {
    const levels = roleLevels.filter((rl) => rl.role_family_id === familyId).map((rl) => rl.job_level);
    return levels.length ? Math.max(...levels) + 1 : 1;
  }

  const includedCount = draftIncludedCount(metrics, skills, values);
  const canCommit = !!title.trim() && !blockingCollision && !committing;

  async function commit() {
    if (!canCommit) return;
    setCommitting(true);
    setPanelError(null);
    try {
      let createdFamily: RoleFamily | null = null;
      let roleLevel: RoleLevel;

      if (backfillTarget) {
        // Exists-mode = back-fill. Whole-record PUT, preserving the level's
        // ladder and (unless the manager typed one) its team — same
        // preservation pattern as saveEdit in Settings' RolesSection.
        roleLevel = await updateRoleLevel(backfillTarget.id, {
          job_role: title.trim(),
          job_level: level,
          job_responsibilities: responsibilities.trim() || backfillTarget.job_responsibilities || undefined,
          functional_team: team.trim() || backfillTarget.functional_team || undefined,
          role_family_id: backfillTarget.role_family_id,
        });
      } else {
        let familyId = selectedFamilyId;
        if (!familyId) {
          createdFamily = await createRoleFamily({ name: title.trim() });
          familyId = createdFamily.id;
        }
        roleLevel = await createRoleLevel({
          job_role: title.trim(),
          job_level: level,
          job_responsibilities: responsibilities.trim() || undefined,
          functional_team: team.trim() || undefined,
          role_family_id: familyId,
        });
      }

      if (includedCount > 0) {
        await commitDraftExpectations(roleLevel.id, metrics, skills, values);
      }

      await onCommitted({
        family: createdFamily,
        roleLevel,
        mode: backfillTarget ? "updated" : "created",
        expectationsAdded: includedCount,
      });
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : "Failed to save this role");
    } finally {
      setCommitting(false);
    }
  }

  const pinnedFamily = scopedFamilyId ? roleFamilies.find((f) => f.id === scopedFamilyId) : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-surface p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-medium text-ink">
              {stage === "review" ? "Review this role" : "Start from a job description"}
            </h3>
            <p className="mt-1 text-xs text-ink-secondary">
              {stage === "review"
                ? "Nothing is saved yet. Edit anything that's off, uncheck what doesn't fit."
                : pinnedFamily
                  ? `Adds a level to the ${pinnedFamily.name} ladder, with expectations drafted from the JD.`
                  : "One paste sets up the role and drafts what good looks like for it."}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-sm text-ink-muted hover:text-ink">
            Close
          </button>
        </div>

        {panelError && <p className="mt-3 text-sm text-red-700">{panelError}</p>}

        {/* ---------------------------------------------------------------
            INPUT — paste box + drop zone, one control each. Both survive a
            refusal or a failed call.
            --------------------------------------------------------------- */}
        {stage !== "review" && (
          <div className="mt-4 space-y-3">
            {refusal && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {refusal} Nothing was created — paste the job description and try again.
              </p>
            )}

            <div>
              <label className={labelCls}>Paste the job description</label>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                rows={8}
                disabled={!!file || stage === "drafting"}
                className={`${inputCls} disabled:bg-canvas disabled:text-ink-muted`}
                placeholder="Paste the full job description here — title, responsibilities, requirements."
              />
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) {
                  setFile(dropped);
                  setRefusal(null);
                }
              }}
              className={`rounded-lg border border-dashed px-4 py-5 text-center ${
                dragging ? "border-brand bg-canvas" : "border-control"
              }`}
            >
              {file ? (
                <p className="text-sm text-ink-body">
                  {file.name}
                  <button onClick={() => setFile(null)} className="ml-3 text-xs text-ink-muted hover:text-ink">
                    Remove
                  </button>
                </p>
              ) : (
                <>
                  <p className="text-sm text-ink-secondary">or drop the PDF / Word file here</p>
                  <label className="mt-1 inline-block cursor-pointer text-xs font-medium text-brand hover:text-brand-hover">
                    choose a file
                    <input
                      type="file"
                      accept={ACCEPTED_EXTENSIONS}
                      className="hidden"
                      onChange={(e) => {
                        const chosen = e.target.files?.[0];
                        if (chosen) {
                          setFile(chosen);
                          setRefusal(null);
                        }
                      }}
                    />
                  </label>
                  <p className="mt-1 text-xs text-ink-muted">.pdf, .docx, .txt or .md — 25MB max</p>
                </>
              )}
            </div>

            <div className="flex items-center gap-4 pt-1">
              <button
                onClick={runDraft}
                disabled={stage === "drafting" || (!file && !pastedText.trim())}
                className={primaryBtnCls}
              >
                {stage === "drafting" ? "Reading the job description…" : "Read the job description"}
              </button>
              {onManualFallback && stage !== "drafting" && (
                <button onClick={onManualFallback} className="text-sm text-ink-secondary hover:text-ink">
                  or start from scratch
                </button>
              )}
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------
            REVIEW — role identity card, then the same draft-review rows the
            coverage grid's "Draft with AI" panel uses.
            --------------------------------------------------------------- */}
        {stage === "review" && (
          <>
            <div className="mt-4 rounded-lg border border-hairline p-4">
              {match?.rationale && <p className="mb-3 text-xs text-ink-secondary">{match.rationale}</p>}
              {otherRolesNote && (
                <p className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  {otherRolesNote} Only the first one is set up here — import the others one at a time.
                </p>
              )}

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={labelCls}>Title</label>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
                </div>
                <div className="w-24">
                  <label className={labelCls}>Level</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={level}
                    onChange={(e) => setLevel(parseInt(e.target.value || "1", 10))}
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="mt-3 flex gap-3">
                <div className="flex-1">
                  <label className={labelCls}>Ladder</label>
                  <select
                    value={familyChoice}
                    onChange={(e) => setFamilyChoice(e.target.value)}
                    className={inputCls}
                  >
                    <option value={CREATE_NEW_FAMILY}>Create new ladder: {title.trim() || "this role"}</option>
                    {roleFamilies.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  {pinnedFamily && (
                    <p className="mt-1 text-xs text-ink-muted">
                      Pinned to {pinnedFamily.name} — you opened this from that ladder.
                    </p>
                  )}
                  {!pinnedFamily && match?.confidence === "medium" && match.suggested_action !== "create_new" && (
                    <p className="mt-1 text-xs text-ink-muted">
                      Not a confident match — creating a new ladder is just as likely to be right.
                    </p>
                  )}
                </div>
                <div className="flex-1">
                  <label className={labelCls}>Team (optional)</label>
                  <input
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    className={inputCls}
                    placeholder="Only if the JD names one"
                  />
                </div>
              </div>

              {blockingCollision && (
                <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <p>
                    L{level} already exists in {selectedFamily?.name ?? "this ladder"}
                    {blockingCollision.job_role && selectedFamily && blockingCollision.job_role !== selectedFamily.name
                      ? ` (${blockingCollision.job_role})`
                      : ""}{" "}
                    — attach to it instead?
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={() => setExistsTargetId(blockingCollision.id)}
                      className="rounded-md bg-amber-500 px-2.5 py-1 font-medium text-on-attention hover:bg-amber-400"
                    >
                      Update L{level} instead
                    </button>
                    <button
                      onClick={() => selectedFamilyId && setLevel(nextFreeLevel(selectedFamilyId))}
                      className="font-medium text-amber-800 hover:underline"
                    >
                      Add as L{selectedFamilyId ? nextFreeLevel(selectedFamilyId) : level + 1}
                    </button>
                  </div>
                </div>
              )}

              {backfillTarget && (
                <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-xs text-ink-secondary">
                  Updating the existing L{level} in {selectedFamily?.name ?? "this ladder"} — its job description is
                  replaced with this one and the expectations below are added to it.{" "}
                  <button onClick={() => setExistsTargetId(null)} className="font-medium text-ink-body hover:underline">
                    Add a new level instead
                  </button>
                </p>
              )}

              <div className="mt-3">
                <label className={labelCls}>Responsibilities (stored on the role, grounds future drafts)</label>
                <NoteField
                  value={responsibilities}
                  onChange={setResponsibilities}
                  rows={4}
                  baseClassName={inputCls}
                  placeholder="What this role owns"
                />
              </div>
            </div>

            <DraftExpectationsReview
              metrics={metrics}
              setMetrics={setMetrics}
              skills={skills}
              setSkills={setSkills}
              values={values}
              setValues={setValues}
              emptyHints={{
                metrics: "No metrics drafted from this JD — you can add them after the role is created.",
                skills: "No skills drafted from this JD — you can add them after the role is created.",
                values:
                  "No role-specific values drafted — that's usually correct, since company-wide values already apply to every role.",
              }}
            />

            <div className="mt-6 flex items-center gap-3 border-t border-divider pt-4">
              <button onClick={commit} disabled={!canCommit} className={primaryBtnCls}>
                {committing
                  ? "Saving..."
                  : backfillTarget
                    ? `Update role + add ${includedCount} expectation${includedCount === 1 ? "" : "s"}`
                    : `Create role + ${includedCount} expectation${includedCount === 1 ? "" : "s"}`}
              </button>
              <button onClick={() => setStage("input")} className="text-sm text-ink-secondary hover:text-ink">
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
