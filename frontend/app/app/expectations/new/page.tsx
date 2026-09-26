"use client";

// Define a role: start from the job description. One AI call proposes where
// the role belongs and writes a first draft with a few focused questions;
// the manager confirms the placement and lands in the draft workspace.
// Nothing about expectations is saved until the draft is stored, and nothing
// becomes active until it is approved. ?family= pins a ladder; ?assign=
// assigns a person (from Settings → People) to the role once it exists.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  RoleCompose,
  RoleFamily,
  RoleLevel,
  assignReportRole,
  composeRoleFromJd,
  createRoleFamily,
  createRoleLevel,
  getDirectReports,
  getRoleFamilies,
  getRoleLevels,
  openRoleDraft,
} from "@/lib/api";
import PageShell from "@/components/PageShell";
import JdInput from "@/components/expectations/JdInput";
import { Notice } from "@/components/expectations/shared";
import { BTN_GHOST, BTN_PRIMARY, CARD, EYEBROW, INPUT, LABEL } from "@/lib/tokens";

export default function DefineRolePage() {
  return (
    <Suspense>
      <DefineRole />
    </Suspense>
  );
}

type Step = "input" | "working" | "placement";
const NEW_LADDER = "__new__";
const NO_LADDER = "__none__";

function DefineRole() {
  const router = useRouter();
  const params = useSearchParams();
  const pinnedFamily = params.get("family");
  const assignId = params.get("assign");

  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composed, setComposed] = useState<RoleCompose | null>(null);
  const [families, setFamilies] = useState<RoleFamily[]>([]);
  const [levels, setLevels] = useState<RoleLevel[]>([]);

  // placement
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState(1);
  const [ladder, setLadder] = useState<string>(NEW_LADDER);
  const [ladderName, setLadderName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getRoleFamilies(), getRoleLevels()])
      .then(([f, l]) => {
        setFamilies(f);
        setLevels(l);
        if (pinnedFamily && f.some((x) => x.id === pinnedFamily)) setLadder(pinnedFamily);
      })
      .catch(() => setError("Your ladders couldn’t be loaded. Refresh to try again."));
  }, [pinnedFamily]);

  const collision = useMemo(() => {
    if (ladder === NEW_LADDER || ladder === NO_LADDER) return null;
    return levels.find((l) => l.role_family_id === ladder && l.job_level === level) ?? null;
  }, [ladder, level, levels]);

  async function compose() {
    setError(null);
    setStep("working");
    try {
      const out = await composeRoleFromJd(file ? { file } : { text: text.trim() });
      if (!out.is_job_description) {
        setError(out.reason || "That doesn’t look like a job description.");
        setStep("input");
        return;
      }
      setComposed(out);
      setTitle(out.role?.job_role ?? "");
      setLevel(out.role?.job_level ?? 1);
      const matchFamily = out.match?.role_family_id;
      if (pinnedFamily && families.some((f) => f.id === pinnedFamily)) setLadder(pinnedFamily);
      else if (matchFamily && out.match?.suggested_action !== "create_new") setLadder(matchFamily);
      else {
        setLadder(NEW_LADDER);
        setLadderName(out.role?.job_role ?? "");
      }
      if (out.match?.suggested_action === "exists" && out.match.existing_role_level_id) {
        const existing = levels.find((l) => l.id === out.match?.existing_role_level_id);
        if (existing) setLevel(existing.job_level);
      }
      setStep("placement");
    } catch (e) {
      setError(
        e instanceof ApiError && e.status < 500 && e.status !== 502
          ? e.detail
          : "The first draft couldn’t be written just now. Your job description is still here — try again, or start without a draft."
      );
      setStep("input");
    }
  }

  function startWithoutDraft() {
    setComposed(null);
    setError(null);
    if (pinnedFamily && families.some((f) => f.id === pinnedFamily)) setLadder(pinnedFamily);
    setStep("placement");
  }

  async function openDraft() {
    if (!title.trim()) {
      setError("Give the role a title.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let roleLevelId = collision?.id ?? null;
      if (!roleLevelId) {
        let familyId: string | null = null;
        if (ladder === NEW_LADDER) {
          const fam = await createRoleFamily({ name: (ladderName || title).trim() });
          familyId = fam.id;
        } else if (ladder !== NO_LADDER) {
          familyId = ladder;
        }
        const created = await createRoleLevel({ job_role: title.trim(), job_level: level, role_family_id: familyId });
        roleLevelId = created.id;
      }
      const sourceText = composed?.source_text ?? (file ? null : text.trim() || null);
      await openRoleDraft({
        role_level_id: roleLevelId,
        source_text: sourceText,
        source_label: composed?.source_label ?? (file ? file.name : sourceText ? "Pasted job description" : null),
        items: composed?.items,
        questions: composed?.questions,
        notes: composed?.notes,
      });
      if (assignId) {
        try {
          const reports = await getDirectReports();
          const person = reports.find((r) => r.id === assignId);
          if (person) await assignReportRole(person.id, person, roleLevelId);
        } catch {
          /* assignment is a convenience; the role and draft exist either way */
        }
      }
      router.push(`/app/expectations/${roleLevelId}`);
    } catch (e) {
      setError(e instanceof ApiError && e.status < 500 ? e.detail : "The role couldn’t be created just now. Nothing was lost — try again.");
      setSaving(false);
    }
  }

  const canCompose = !!file || text.trim().length > 40;
  const questionCount = composed?.questions.filter((q) => q.status === "open").length ?? 0;

  return (
    <PageShell maxWidth="4xl">
      <Link href="/app/expectations" className="text-sm text-ink-secondary hover:text-ink">
        ← All roles &amp; expectations
      </Link>
      <p className={`${EYEBROW} mt-5`}>Define a role</p>
      <h1 className="mt-1.5 font-serif text-[2.2rem] font-normal leading-tight tracking-[-0.02em] text-ink">Start from the job description.</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-secondary">
        You’ll get a first draft in plain language and a few focused questions where the description leaves something open. Numbers only come from what you supply — a missing target stays missing until you set it.
      </p>

      {error && (
        <div className="mt-5">
          <Notice tone="amber" onClose={() => setError(null)}>
            {error}
          </Notice>
        </div>
      )}

      {step !== "placement" && (
        <section className={`${CARD} mt-6 p-5 sm:p-6`}>
          <JdInput text={text} onText={setText} file={file} onFile={setFile} disabled={step === "working"} />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={startWithoutDraft} disabled={step === "working"} className={BTN_GHOST}>
              Start without a draft
            </button>
            <button type="button" onClick={compose} disabled={!canCompose || step === "working"} className={BTN_PRIMARY}>
              {step === "working" ? "Reading and drafting…" : "Write the first draft"}
            </button>
          </div>
          {step === "working" && (
            <p className="mt-4 text-sm text-ink-secondary" role="status" aria-live="polite">
              Reading the job description, finding where the role fits, and drafting what good looks like. This usually takes under a minute.
            </p>
          )}
        </section>
      )}

      {step === "placement" && (
        <section className={`${CARD} mt-6 p-5 sm:p-6`} aria-labelledby="placement-heading">
          <h2 id="placement-heading" className="text-base font-semibold text-ink">
            Where does this role belong?
          </h2>
          {composed?.match?.rationale && <p className="mt-1 text-sm text-ink-secondary">{composed.match.rationale}</p>}
          {composed?.other_roles_note && <p className="mt-1 text-sm text-amber-700">{composed.other_roles_note}</p>}

          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_7rem]">
            <div>
              <label className={LABEL} htmlFor="role-title">
                Role title
              </label>
              <input id="role-title" value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} placeholder="e.g. Customer Success Manager" />
            </div>
            <div>
              <label className={LABEL} htmlFor="role-level">
                Level
              </label>
              <input
                id="role-level"
                type="number"
                min={1}
                max={10}
                value={level}
                onChange={(e) => setLevel(Math.max(1, Math.min(10, parseInt(e.target.value || "1", 10))))}
                className={INPUT}
              />
            </div>
          </div>
          <div className="mt-4">
            <label className={LABEL} htmlFor="role-ladder">
              Ladder
            </label>
            <select id="role-ladder" value={ladder} onChange={(e) => setLadder(e.target.value)} className={INPUT}>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
              <option value={NEW_LADDER}>A new ladder…</option>
              <option value={NO_LADDER}>Not on a ladder</option>
            </select>
          </div>
          {ladder === NEW_LADDER && (
            <div className="mt-3">
              <label className={LABEL} htmlFor="ladder-name">
                New ladder name
              </label>
              <input id="ladder-name" value={ladderName} onChange={(e) => setLadderName(e.target.value)} className={INPUT} placeholder={title || "e.g. Customer Success"} />
            </div>
          )}
          {collision && (
            <p className="mt-4 rounded-lg bg-brand-tint px-3 py-2.5 text-sm text-ink-body">
              This ladder already has Level {collision.job_level} ({collision.job_role}). Continuing opens that role instead of creating a second one. If it already has approved expectations they stay in use, and anything new from this description is offered as suggestions you can accept or ignore.
            </p>
          )}

          <div className="mt-5 rounded-lg bg-sunken px-4 py-3 text-sm text-ink-secondary">
            {composed
              ? `${composed.items.length} expectation${composed.items.length === 1 ? "" : "s"} drafted${questionCount ? ` · ${questionCount} question${questionCount === 1 ? "" : "s"} for you` : ""}. Nothing is used until you approve it.`
              : "You’ll start with an empty draft. Add expectations in your own words, or copy them from another role."}
            {composed?.notes?.length ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
                {composed.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => setStep("input")} disabled={saving} className={BTN_GHOST}>
              ← Back to the job description
            </button>
            <button type="button" onClick={openDraft} disabled={saving || !title.trim()} className={BTN_PRIMARY}>
              {saving ? "Opening…" : "Open the draft →"}
            </button>
          </div>
        </section>
      )}
    </PageShell>
  );
}
