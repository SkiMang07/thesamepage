"use client";

// ---------------------------------------------------------------------------
// The Meet picker (build plan B2; the first prototype's picker in
// docs/design-proposals/2026-10-23-meeting-room/artboards/Main.dc.html).
//
// "Who are you meeting?" Today first, then your team (most overdue first),
// then Beyond your team. Typeahead, ↑↓ and Enter, "+ Someone new" in place,
// the Transcribe switch (remembers the last choice) and the consent line.
// A first-time person asks "Does Jordan know calls are transcribed?" once.
// An unprepped person says so on the row and is never blocked.
//
// Beyond your team opens that person's page: 1:1 transcription launches for
// your own reports first (team and Beyond meetings are a later session).
// ---------------------------------------------------------------------------

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createDirectReport,
  createOutsidePerson,
  getBeyondOverview,
  getDirectReports,
  getOneOnOnesOverview,
  type DirectReport,
  type OneOnOneOverviewItem,
  type OutsidePersonSummary,
} from "@/lib/api";
import { ELEVATED, BTN_PRIMARY_SM, BTN_SECONDARY, INPUT, BTN_PRIMARY, IDENTITY_VAR, identityIndex } from "@/lib/tokens";
import { RELATIONSHIP_LABEL } from "@/app/app/beyond/shared";
import { getTranscribeDefault, setTranscribeDefault } from "@/lib/recorder/prefs";
import { StartProblem, useStartMeeting, type MeetPerson } from "./useStartMeeting";
import { TranscribeToggle, consentLine } from "./TranscribeToggle";

type Row = {
  key: string;
  kind: "report" | "outside" | "new";
  id: string;
  name: string;
  meta: string;
  attention?: boolean;
  consented?: boolean;
};

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ConsentAsk({ first, onYes, onWithout, pending }: { first: string; onYes: () => void; onWithout: () => void; pending?: boolean }) {
  return (
    <div className="rounded-lg border border-hairline bg-sunken px-4 py-3.5">
      <p className="text-sm font-semibold text-ink">Does {first} know calls are transcribed?</p>
      <p className="mt-1 text-xs text-ink-muted">You only confirm this once per person. Change it on their page any time.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" autoFocus disabled={pending} className={BTN_PRIMARY_SM} onClick={onYes}>
          Yes, start transcribing
        </button>
        <button type="button" disabled={pending} className={BTN_SECONDARY} onClick={onWithout}>
          Start without
        </button>
      </div>
    </div>
  );
}

export default function MeetPicker({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const start = useStartMeeting();
  const [overview, setOverview] = useState<OneOnOneOverviewItem[] | null>(null);
  const [reports, setReports] = useState<DirectReport[]>([]);
  const [outside, setOutside] = useState<OutsidePersonSummary[]>([]);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [transcribe, setTranscribe] = useState(true);
  const [asking, setAsking] = useState<MeetPerson | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWhere, setNewWhere] = useState<"team" | "outside">("team");
  const [creating, setCreating] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setTranscribe(getTranscribeDefault()), []);
  useEffect(() => {
    let live = true;
    Promise.allSettled([getOneOnOnesOverview(), getDirectReports(), getBeyondOverview()]).then(([o, r, b]) => {
      if (!live) return;
      if (o.status === "fulfilled") setOverview(o.value);
      else setFailed(true);
      if (r.status === "fulfilled") setReports(r.value);
      if (b.status === "fulfilled") setOutside(b.value.people.filter((p) => !p.archived_at));
    });
    return () => {
      live = false;
    };
  }, []);

  const consented = useMemo(() => new Set(reports.filter((r) => r.transcription_consent_at).map((r) => r.id)), [reports]);

  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const match = (name: string) => !ql || name.toLowerCase().includes(ql);
    const today = localToday();
    const todayRows: Row[] = [];
    const teamRows: (Row & { sort: number })[] = [];
    for (const o of overview ?? []) {
      if (!match(o.name)) continue;
      const next = o.planned_session;
      const prepped = next?.status === "planned";
      const isToday = !!next?.scheduled_at && next.scheduled_at.slice(0, 10) === today;
      const base = { key: `r-${o.direct_report_id}`, kind: "report" as const, id: o.direct_report_id, name: o.name, consented: consented.has(o.direct_report_id) };
      if (isToday) {
        todayRows.push({ ...base, meta: prepped ? "1:1 · prepped" : "1:1 · not prepped", attention: !prepped });
      } else {
        const days = o.days_since_last;
        const meta =
          days === null ? "No 1:1 yet" : o.is_due ? `${days} days · due` : days === 0 ? "Met today" : `Last met ${days} ${days === 1 ? "day" : "days"} ago`;
        // Most overdue first: due people by how long it's been, then the rest.
        const sort = (o.is_due ? 1_000_000 : 0) + (days ?? 500_000);
        teamRows.push({ ...base, meta, attention: o.is_due, sort });
      }
    }
    teamRows.sort((a, b) => b.sort - a.sort);
    const beyondRows: Row[] = outside
      .filter((p) => match(p.name))
      .map((p) => ({ key: `o-${p.id}`, kind: "outside", id: p.id, name: p.name, meta: p.role_title || RELATIONSHIP_LABEL[p.relationship] }));
    return [
      { label: "Today", rows: todayRows },
      { label: "Your team", rows: teamRows },
      { label: "Beyond your team", rows: beyondRows },
    ];
  }, [overview, outside, consented, q]);

  const flat: Row[] = useMemo(() => {
    const rows = groups.flatMap((g) => g.rows);
    return newOpen ? rows : [...rows, { key: "new", kind: "new", id: "new", name: "Someone new", meta: "" }];
  }, [groups, newOpen]);

  useEffect(() => setSel((s) => Math.min(s, Math.max(0, flat.length - 1))), [flat.length]);
  useEffect(() => setSel(0), [q]);

  const selected = flat[sel];
  const selectedFirst = selected && selected.kind === "report" ? selected.name.split(" ")[0] : "";

  function pick(row: Row) {
    if (row.kind === "new") {
      setNewOpen(true);
      setNewName(q.trim());
      return;
    }
    if (row.kind === "outside") {
      onClose();
      router.push(`/app/beyond/people/${row.id}`);
      return;
    }
    const person = { id: row.id, name: row.name };
    if (transcribe && !row.consented) {
      setAsking(person);
      return;
    }
    void start.begin(person, { transcribe, consentConfirmed: transcribe }).then((ok) => ok && onClose());
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (asking || newOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(flat.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter" && selected) {
      e.preventDefault();
      pick(selected);
    }
  }

  async function startNew() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      if (newWhere === "outside") {
        const p = await createOutsidePerson({ name, relationship: "other" });
        onClose();
        router.push(`/app/beyond/people/${p.id}`);
        return;
      }
      const dr = await createDirectReport({ name });
      const person = { id: dr.id, name: dr.name };
      if (transcribe) setAsking(person);
      else void start.begin(person, { transcribe: false, consentConfirmed: false }).then((ok) => ok && onClose());
    } catch {
      start.clearProblem();
    } finally {
      setCreating(false);
    }
  }

  const empty = overview !== null && flat.length <= 1 && q.trim();
  const activeId = selected ? `${listId}-${selected.key}` : undefined;
  let index = -1;

  return (
    <div
      role="dialog"
      aria-label="Who are you meeting?"
      onKeyDown={onKeyDown}
      className={`fixed inset-x-3 top-16 z-50 flex max-h-[calc(100dvh-5rem)] flex-col overflow-hidden sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-[25rem] sm:max-h-[min(36rem,calc(100dvh-5rem))] ${ELEVATED}`}
    >
      <div className="border-b border-divider p-3">
        <label htmlFor={`${listId}-q`} className="block px-1 pb-1.5 text-sm font-semibold text-ink">
          Who are you meeting?
        </label>
        <input
          id={`${listId}-q`}
          ref={inputRef}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a name"
          autoComplete="off"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          className={INPUT}
        />
      </div>

      <div id={listId} role="listbox" aria-label="People" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {overview === null && !failed && <p className="px-3 py-4 text-sm text-ink-muted">Loading your people…</p>}
        {failed && <p className="px-3 py-4 text-sm text-ink-muted">Couldn&apos;t load your people. Close this and try again.</p>}
        {groups.map(
          (g) =>
            g.rows.length > 0 && (
              <div key={g.label} role="group" aria-label={g.label} className="pb-1">
                <p className="px-3 pb-1 pt-2.5 text-2xs font-semibold uppercase tracking-[0.12em] text-ink-muted">{g.label}</p>
                {g.rows.map((row) => {
                  index += 1;
                  const i = index;
                  return (
                    <div
                      key={row.key}
                      id={`${listId}-${row.key}`}
                      role="option"
                      aria-selected={sel === i}
                      onMouseEnter={() => setSel(i)}
                      onClick={() => pick(row)}
                      className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-3 py-2 ${sel === i ? "bg-brand-tint" : "hover:bg-sunken"}`}
                    >
                      <span
                        aria-hidden
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${row.kind === "report" ? "text-on-identity" : "bg-sunken text-ink-secondary ring-1 ring-inset ring-control"}`}
                        style={row.kind === "report" ? { background: IDENTITY_VAR[identityIndex(row.id)] } : undefined}
                      >
                        {initials(row.name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{row.name}</span>
                      <span className={`shrink-0 text-xs ${row.attention ? "font-medium text-amber-700" : "text-ink-muted"}`}>{row.meta}</span>
                    </div>
                  );
                })}
              </div>
            ),
        )}
        {empty && <p className="px-3 py-2 text-sm text-ink-muted">No one called &ldquo;{q.trim()}&rdquo; yet.</p>}

        {!newOpen ? (
          <div
            id={`${listId}-new`}
            role="option"
            aria-selected={selected?.kind === "new"}
            onMouseEnter={() => setSel(flat.length - 1)}
            onClick={() => pick(flat[flat.length - 1])}
            className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-brand ${selected?.kind === "new" ? "bg-brand-tint" : "hover:bg-sunken"}`}
          >
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-tint text-base">+</span>
            Someone new
          </div>
        ) : (
          <div className="m-1.5 rounded-lg border border-hairline bg-sunken p-3">
            <label htmlFor={`${listId}-new-name`} className="text-sm font-semibold text-ink">
              Someone new
            </label>
            <input
              id={`${listId}-new-name`}
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void startNew()}
              placeholder="Their name"
              className={`mt-2 ${INPUT}`}
            />
            <div role="radiogroup" aria-label="Where they sit" className="mt-2.5 flex gap-2">
              {(["team", "outside"] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={newWhere === w}
                  onClick={() => setNewWhere(w)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${newWhere === w ? "border-brand bg-brand-tint text-brand" : "border-control text-ink-secondary hover:text-ink"}`}
                >
                  {w === "team" ? "On my team" : "Outside my team"}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void startNew()} disabled={!newName.trim() || creating} className={`mt-3 ${BTN_PRIMARY}`}>
              {creating ? "Adding…" : newWhere === "team" ? "Start meeting" : "Open their page"}
            </button>
            <p className="mt-2 text-xs text-ink-muted">Role and email can wait. Add them on their page later.</p>
          </div>
        )}
      </div>

      <div className="border-t border-divider p-3">
        {asking ? (
          <ConsentAsk
            first={asking.name.split(" ")[0]}
            pending={start.pending}
            onYes={() => void start.begin(asking, { transcribe: true, consentConfirmed: true }).then((ok) => ok && onClose())}
            onWithout={() => void start.begin(asking, { transcribe: false, consentConfirmed: false }).then((ok) => ok && onClose())}
          />
        ) : (
          <div className="flex items-center gap-2.5">
            <TranscribeToggle
              on={transcribe}
              onChange={(on) => {
                setTranscribe(on);
                setTranscribeDefault(on);
              }}
            />
            <span className="text-[13px] font-semibold text-ink">Transcribe</span>
            <span className="min-w-0 text-xs leading-snug text-ink-muted">
              {selected?.kind === "report" ? consentLine(transcribe, selectedFirst, !!selected.consented) : transcribe ? "1:1s with your team" : "Notes only, no transcript"}
            </span>
          </div>
        )}
        {start.pending && !asking && <p className="mt-2 text-xs text-ink-muted" role="status">Opening the 1:1…</p>}
        <StartProblem start={start} />
      </div>
    </div>
  );
}
