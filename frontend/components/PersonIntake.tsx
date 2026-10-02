"use client";

// Capture by person (docs/design-proposals/2026-10-02-capture-by-person/).
//
// The manager says what they know about ONE person, on that person's page, so
// nothing is guessed about who it is about. Two boxes: "Their job" (read only
// by the role-expectations draft, which is started from the person, never from
// this box's contents going anywhere else) and "Where things stand" (the only
// text the AI reads). The draft is a review list the manager edits: what they
// owe the person, what the person owes them, and short things to keep. Nothing
// is saved until Save. A commitment whose side the text did not state has no
// side chosen and cannot be saved until the manager picks one.
//
// No new write path: role and team use the existing assign calls, commitments
// POST /api/commitments (committed_by says which side), kept thoughts the
// capture endpoint. No 1:1 is created. Saving is one call per row, so progress
// is tracked per row and a retry never saves the same row twice.
//
// A sentence that names another person on the team is not read. It is listed
// with "Move to <name>", which carries it to that person's box in this
// browser (sessionStorage); it is the manager's own text, so carrying it
// writes nothing.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import NoteField from "@/components/NoteField";
import WaitNote from "@/components/WaitNote";
import { UNGROUPED_LABEL, groupRoleLevelsByFamily, levelOnlyLabel, orgUnitLabel } from "@/components/RolePicker";
import {
  ApiError,
  DirectReport,
  OrgUnit,
  PersonIntakeDraft,
  RoleFamily,
  RoleLevel,
  TeamOverviewItem,
  assignReportOrgUnit,
  assignReportRole,
  createCaptureNote,
  createCommitment,
  draftPersonIntake,
  getTeamOverview,
} from "@/lib/api";
import { joinDraft } from "@/lib/aiDraftTelemetry";
import { useAiDraft } from "@/lib/useAiDraft";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, EYEBROW, INPUT } from "@/lib/tokens";

type Side = "manager" | "direct_report" | null;
type CRow = { key: string; description: string; side: Side; due: string; quote: string; keep: boolean; saved: boolean };
type TRow = { key: string; text: string; quote: string; keep: boolean; saved: boolean };
type Phase = "input" | "reading" | "review" | "saving" | "saved";

const CARRY = (id: string) => `tsp:intake-carry:${id}`;
const DONE = "tsp:intake-done";

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = window.sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be unavailable; the move just does not carry */
  }
}

function first(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

export default function PersonIntake({
  report, roleLevels, roleFamilies, orgUnits, onSaved, onClose,
}: {
  report: DirectReport;
  roleLevels: RoleLevel[];
  roleFamilies: RoleFamily[];
  orgUnits: OrgUnit[];
  /** The page reloads what it shows (commitments, kept thoughts, role, team). */
  onSaved: () => void;
  onClose?: () => void;
}) {
  const who = first(report.name);
  const [phase, setPhase] = useState<Phase>("input");
  const [role, setRole] = useState(report.role_level_id ?? "");
  const [team, setTeam] = useState(report.org_unit_id ?? "");
  const [job, setJob] = useState("");
  const [stand, setStand] = useState("");
  const [draft, setDraft] = useState<PersonIntakeDraft | null>(null);
  const [crows, setCrows] = useState<CRow[]>([]);
  const [trows, setTrows] = useState<TRow[]>([]);
  const [held, setHeld] = useState<PersonIntakeDraft["mentions"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [roster, setRoster] = useState<TeamOverviewItem[]>([]);
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const inFlight = useRef(false);
  const telemetry = useAiDraft("person_intake");

  // Sentences carried here from another person's box.
  useEffect(() => {
    const carried = readJson<string[]>(CARRY(report.id), []);
    if (carried.length) {
      setStand((s) => [s.trim(), ...carried].filter(Boolean).join(" "));
      try { window.sessionStorage.removeItem(CARRY(report.id)); } catch { /* ignore */ }
    }
    setDoneIds(readJson<string[]>(DONE, []));
    getTeamOverview().then(setRoster).catch(() => setRoster([]));
  }, [report.id]);

  const grouped = useMemo(() => groupRoleLevelsByFamily(roleLevels, roleFamilies), [roleLevels, roleFamilies]);
  const roleChanged = role !== (report.role_level_id ?? "");
  const teamChanged = team !== (report.org_unit_id ?? "");

  const isDone = (p: TeamOverviewItem) => p.open_commitment_count > 0 || doneIds.includes(p.id) || p.id === report.id && phase === "saved";
  const next = roster.find((p) => p.id !== report.id && !isDone(p));

  async function read() {
    if (!stand.trim()) return;
    setError(null);
    setPhase("reading");
    try {
      const d = await draftPersonIntake(report.id, stand);
      setDraft(d);
      setCrows(d.commitments.map((c) => ({
        key: c.key, description: c.description, side: c.committed_by, due: c.due_date ?? "", quote: c.quote, keep: true, saved: false,
      })));
      setTrows(d.thoughts.map((t) => ({ key: t.key, text: t.text, quote: t.quote, keep: true, saved: false })));
      setHeld(d.mentions);
      telemetry.start({
        text: joinDraft([...d.commitments.map((c) => c.description), ...d.thoughts.map((t) => t.text)]),
        items: d.commitments.map((c) => c.description),
      });
      setPhase("review");
    } catch (e) {
      setError(readable(e));
      setPhase("input");
    }
  }

  const keptC = crows.filter((r) => r.keep && !r.saved);
  const keptT = trows.filter((r) => r.keep && !r.saved);
  const unsided = keptC.filter((r) => r.side === null).length;
  const hasWork = keptC.length + keptT.length > 0 || roleChanged || teamChanged;
  const ready = hasWork && unsided === 0 && keptC.every((r) => r.description.trim());
  const canSave = phase === "review" && ready;

  async function save() {
    if (!canSave || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setPhase("saving");
    let current = report;
    let n = 0;
    try {
      if (roleChanged) current = await assignReportRole(report.id, current, role || null);
      if (teamChanged) current = await assignReportOrgUnit(report.id, current, team || null);
      for (const r of crows.filter((x) => x.keep && !x.saved)) {
        await createCommitment({
          description: r.description.trim(),
          direct_report_id: report.id,
          committed_by: r.side as "manager" | "direct_report",
          due_date: r.due || null,
        });
        setCrows((rs) => rs.map((x) => (x.key === r.key ? { ...x, saved: true } : x)));
        n += 1;
      }
      for (const r of trows.filter((x) => x.keep && !x.saved)) {
        await createCaptureNote(report.id, r.text.trim());
        setTrows((rs) => rs.map((x) => (x.key === r.key ? { ...x, saved: true } : x)));
        n += 1;
      }
      telemetry.accept({
        text: joinDraft([...crows.filter((x) => x.keep).map((c) => c.description), ...trows.filter((x) => x.keep).map((t) => t.text)]),
        items: crows.filter((x) => x.keep).map((c) => c.description),
      });
      const done = Array.from(new Set([...readJson<string[]>(DONE, []), report.id]));
      writeJson(DONE, done);
      setDoneIds(done);
      setSavedCount((c) => c + n);
      setPhase("saved");
      onSaved();
    } catch (e) {
      setSavedCount((c) => c + n);
      setError(`${readable(e)} What already saved stays saved; Save again to finish the rest.`);
      setPhase("review");
    } finally {
      inFlight.current = false;
    }
  }

  function moveHeld(i: number) {
    const h = held[i];
    writeJson(CARRY(h.person_id), [...readJson<string[]>(CARRY(h.person_id), []), h.sentence]);
    setHeld((hs) => hs.filter((_, j) => j !== i));
  }

  function discard() {
    telemetry.discard();
    setDraft(null);
    setPhase("input");
  }

  function startRoleDraft() {
    try { window.sessionStorage.setItem(`tsp:role-context:${report.id}`, job.trim()); } catch { /* ignore */ }
  }

  const busy = phase === "reading" || phase === "saving";

  return (
    <section aria-labelledby="intake-title" className="mb-8 rounded-xl border border-hairline bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={EYEBROW}>Setup</p>
          <h2 id="intake-title" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
            What you know about {who}
          </h2>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} disabled={busy} className={BTN_GHOST}>Close</button>
        )}
      </div>

      {roster.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Your team">
          {roster.map((p) => (
            <Link
              key={p.id}
              href={`/app/reports/${p.id}?intake=1`}
              aria-current={p.id === report.id ? "true" : undefined}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                p.id === report.id ? "border-brand text-ink" : "border-control text-ink-secondary hover:text-ink"
              }`}
            >
              {isDone(p) ? "✓ " : ""}{first(p.name)}
            </Link>
          ))}
        </div>
      )}

      {phase !== "saved" && (
        <>
          <p className="mt-3 text-sm text-ink-secondary">
            Everything here is about {who}. Fill in what you have; every box is optional. Nothing is saved until you review it.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-ink-muted">
              Role
              <select className={`${INPUT} mt-1`} value={role} disabled={busy} onChange={(e) => setRole(e.target.value)}>
                <option value="">Not set</option>
                {grouped.map(({ family, levels }) => (
                  <optgroup key={family?.id ?? "none"} label={family?.name ?? UNGROUPED_LABEL}>
                    {levels.map((rl) => <option key={rl.id} value={rl.id}>{levelOnlyLabel(rl, family)}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-muted">
              Team
              <select className={`${INPUT} mt-1`} value={team} disabled={busy} onChange={(e) => setTeam(e.target.value)}>
                <option value="">Not set</option>
                {orgUnits.map((u) => <option key={u.id} value={u.id}>{orgUnitLabel(u)}</option>)}
              </select>
            </label>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            A role or team that is not listed is added in{" "}
            <Link href="/app/settings?section=people" className="text-brand hover:text-brand-hover">Settings</Link>.
          </p>

          <label htmlFor="intake-job" className="mt-4 block text-sm text-ink">Their job</label>
          <NoteField
            id="intake-job" value={job} onChange={setJob} rows={2} disabled={busy} vocabulary={report.name}
            placeholder={`What ${who} owns, and how you would tell it is going well`}
            className="mt-1 text-sm"
          />
          <p className="mt-1 text-xs text-ink-muted">
            Only used to start {who}’s role expectations, after you save. It is never read for commitments or notes.
          </p>

          <label htmlFor="intake-stand" className="mt-4 block text-sm text-ink">Where things stand</label>
          <NoteField
            id="intake-stand" value={stand} onChange={setStand} rows={5} disabled={busy} vocabulary={report.name}
            placeholder={`What you owe ${who}, what ${who} owes you, anything you want to remember`}
            className="mt-1 text-sm leading-relaxed"
          />
          <p className="mt-1 text-xs text-ink-muted">
            Talk or type. This is read once to draft the list below and is not kept. A sentence that names someone else on your team is not read.
          </p>
        </>
      )}

      {phase === "input" || phase === "reading" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={read} disabled={busy || !stand.trim()} className={BTN_PRIMARY}>
            {phase === "reading" ? "Reading…" : "Read"}
          </button>
          {(roleChanged || teamChanged) && phase === "input" && (
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={busy}
              onClick={async () => {
                setError(null);
                setPhase("saving");
                try {
                  let cur = report;
                  if (roleChanged) cur = await assignReportRole(report.id, cur, role || null);
                  if (teamChanged) cur = await assignReportOrgUnit(report.id, cur, team || null);
                  onSaved();
                  setPhase("saved");
                } catch (e) {
                  setError(readable(e));
                  setPhase("input");
                }
              }}
            >
              Save role and team only
            </button>
          )}
          <WaitNote active={phase === "reading"} typical="a few seconds" className="" />
        </div>
      ) : null}

      {(phase === "review" || phase === "saving") && draft && (
        <div className="mt-5">
          <p className={EYEBROW}>Review</p>
          <p className="mt-1 text-sm text-ink-secondary">
            Nothing is saved until you choose Save. Each row quotes your words. Where your words did not say who owes it, choose.
          </p>

          {crows.length === 0 && trows.length === 0 && (
            <p className="mt-3 text-sm text-ink-secondary">Nothing to save from that.</p>
          )}

          {crows.length > 0 && (
            <ul className="mt-3 divide-y divide-hairline rounded-lg border border-hairline">
              {crows.map((r) => (
                <li key={r.key} className="flex items-start gap-3 px-3 py-3">
                  <input
                    type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={r.keep && !r.saved} disabled={r.saved || phase === "saving"}
                    aria-label="Keep this row"
                    onChange={(e) => setCrows((rs) => rs.map((x) => (x.key === r.key ? { ...x, keep: e.target.checked } : x)))}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div role="group" aria-label="Who owes this" className="inline-flex overflow-hidden rounded-full border border-control text-xs">
                        {([["manager", `You owe ${who}`], ["direct_report", `${who} owes you`]] as const).map(([value, label]) => (
                          <button
                            key={value} type="button" disabled={r.saved || phase === "saving"} aria-pressed={r.side === value}
                            onClick={() => setCrows((rs) => rs.map((x) => (x.key === r.key ? { ...x, side: value } : x)))}
                            className={`px-2.5 py-1 ${r.side === value ? "bg-brand/20 text-ink" : "text-ink-secondary hover:text-ink"}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                        due
                        <input
                          type="date" className={`${INPUT} w-auto py-1 text-xs`} value={r.due} disabled={r.saved || phase === "saving"}
                          onChange={(e) => setCrows((rs) => rs.map((x) => (x.key === r.key ? { ...x, due: e.target.value } : x)))}
                        />
                      </label>
                      {r.saved && <span className="text-xs text-ink-muted">Saved</span>}
                    </div>
                    <input
                      aria-label="Commitment" className={`${INPUT} mt-2`} value={r.description} disabled={r.saved || phase === "saving"}
                      onChange={(e) => setCrows((rs) => rs.map((x) => (x.key === r.key ? { ...x, description: e.target.value } : x)))}
                    />
                    {r.side === null && r.keep && !r.saved && (
                      <p className="mt-1 text-xs text-amber-300">Your words did not say who owes this. Choose one.</p>
                    )}
                    <p className="mt-1 text-xs text-ink-muted">From what you said: “{r.quote}”</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {trows.length > 0 && (
            <>
              <p className={`${EYEBROW} mt-4`}>Kept for your next prep sheet · only you see these</p>
              <ul className="mt-2 divide-y divide-hairline rounded-lg border border-hairline">
                {trows.map((r) => (
                  <li key={r.key} className="flex items-start gap-3 px-3 py-3">
                    <input
                      type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={r.keep && !r.saved} disabled={r.saved || phase === "saving"}
                      aria-label="Keep this thought"
                      onChange={(e) => setTrows((rs) => rs.map((x) => (x.key === r.key ? { ...x, keep: e.target.checked } : x)))}
                    />
                    <div className="min-w-0 flex-1">
                      <textarea
                        aria-label="Kept thought" rows={2} className={`${INPUT} leading-relaxed`} value={r.text} disabled={r.saved || phase === "saving"}
                        onChange={(e) => setTrows((rs) => rs.map((x) => (x.key === r.key ? { ...x, text: e.target.value } : x)))}
                      />
                      <p className="mt-1 text-xs text-ink-muted">From what you said: “{r.quote}”</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {held.length > 0 && (
            <div className="mt-4 rounded-lg bg-sunken px-4 py-3 text-[13px] text-ink-secondary">
              <p className="font-medium text-ink">Not read</p>
              <ul className="mt-1 space-y-2">
                {held.map((h, i) => (
                  <li key={`${h.person_id}-${i}`}>
                    “{h.sentence}” names {h.person_name}.{" "}
                    <button type="button" onClick={() => moveHeld(i)} className="font-medium text-brand hover:text-brand-hover">
                      Move to {first(h.person_name)}’s box
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {draft.already_there > 0 && (
            <p className="mt-3 text-[13px] text-ink-secondary">
              {draft.already_there} already {draft.already_there === 1 ? "an open commitment" : "open commitments"} for {who}, so not listed again.
            </p>
          )}
          {draft.dropped > 0 && (
            <p className="mt-3 text-[13px] text-ink-secondary">
              {draft.dropped} {draft.dropped === 1 ? "suggestion" : "suggestions"} could not be tied to your words and {draft.dropped === 1 ? "is" : "are"} not listed. If something is missing, add it as a commitment on {who}’s page.
            </p>
          )}
          {draft.truncated && (
            <p className="mt-3 text-[13px] text-ink-secondary">What you wrote was longer than can be read at once. Only the first part was read.</p>
          )}

          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={discard} disabled={phase === "saving"} className={BTN_GHOST}>Back to what I wrote</button>
            <button type="button" onClick={save} disabled={!ready || phase !== "review"} className={BTN_PRIMARY}>
              {phase === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {error && phase === "input" && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}

      {phase === "saved" && (
        <div className="mt-4">
          <p className="text-sm text-ink">
            {savedCount > 0 ? `Saved ${savedCount} ${savedCount === 1 ? "record" : "records"} for ${who}.` : `Saved for ${who}.`}
            {" "}The next prep sheet for {who} draws on it.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {next && (
              <Link href={`/app/reports/${next.id}?intake=1`} className={BTN_PRIMARY}>Next: {first(next.name)}</Link>
            )}
            {job.trim() && (
              <Link
                href={`/app/expectations/new?assign=${report.id}&describe=1`}
                onClick={startRoleDraft}
                className={BTN_SECONDARY}
              >
                Write {who}’s role expectations from “Their job”
              </Link>
            )}
            {onClose && <button type="button" onClick={onClose} className={BTN_GHOST}>Done</button>}
          </div>
          {roster.length > 1 && !next && (
            <p className="mt-3 text-[13px] text-ink-secondary">
              Everyone on your team has something recorded. Two people is enough to build your first sheets.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function readable(e: unknown) {
  if (e instanceof ApiError) {
    try {
      const d = JSON.parse(e.detail)?.detail;
      if (typeof d === "string") return d;
    } catch {
      /* not JSON */
    }
    return e.status < 500 ? e.detail : "That didn’t work. What you wrote is still here, try again.";
  }
  return "That didn’t work. What you wrote is still here, try again.";
}
