"use client";

// The commitments table — one picture of open commitments, closable in place.
// Used on Mission Control (everything, defaulting to what you owe) and on the
// Team page (that team's meeting commitments, plus 1:1 ones on request).
// docs/systems/commitments.md has the rules; the data is
// GET /api/commitments/board (backend/routes/commitments.py).
//
// Rows a manager touches this visit (ticked, dropped, edited) stay where they
// are with Undo until the page reloads, even when the filter no longer
// matches them, so a tick never makes a row jump out from under the pointer.
// Ticking something you owe a person offers one line into that person's next
// 1:1 ("Tell Leah in your next 1:1"), written as a capture note the next prep
// reads. Nothing is sent to anyone.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ApiError,
  BoardCommitment,
  CommitmentBoard,
  CommitmentEdit,
  createCaptureNote,
  editCommitment,
  getCommitmentBoard,
} from "@/lib/api";
import { BTN_PRIMARY_SM, BTN_GHOST, INPUT, LABEL, SELECT } from "@/lib/tokens";
import PersonAvatar from "@/components/team/PersonAvatar";
import NoteField from "@/components/NoteField";
import { addDaysStr, localDateStr, shortDate } from "@/components/team/dates";
import {
  ageWords,
  daysBetween,
  firstName,
  matchesOwner,
  matchesState,
  sortRows,
  staleNote,
  type OwnerFilter,
  type StateFilter,
} from "@/lib/commitmentsTable";

export type { OwnerFilter, StateFilter } from "@/lib/commitmentsTable";
export type TableRequest = { owner: OwnerFilter; state: StateFilter; nonce: number };

const STATES: { key: StateFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "week", label: "Due in 7 days" },
  { key: "undated", label: "No due date" },
  { key: "done", label: "Done" },
];

const INITIAL_ROWS = 8;
// At or under this many open rows the table is a plain list: filters around
// three rows are chrome, not help.
const COMPACT_MAX = 5;

function createdDay(c: BoardCommitment): string {
  return localDateStr(new Date(c.created_at));
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

type Touched = { row: BoardCommitment; prev: BoardCommitment; told?: "saving" | "done" | "failed" };

export default function CommitmentsTable({
  id = "commitments",
  title = "Commitments",
  intro,
  defaultOwner = "you",
  include,
  people: allowedPeople,
  reloadKey,
  request,
  surface,
  action,
  above,
  toolbarExtra,
  emptyText = "No open commitments. They come from 1:1 and team meeting write-ups, or add one with the Scribe.",
  onChanged,
}: {
  id?: string;
  title?: string;
  intro?: ReactNode;
  defaultOwner?: OwnerFilter;
  /** Which board rows this table holds at all (the Team page's scope). */
  include?: (c: BoardCommitment) => boolean;
  /** People offered in the owner filter; defaults to everyone on the board. */
  people?: { id: string; name: string }[];
  reloadKey?: unknown;
  request?: TableRequest | null;
  surface: "table" | "team_table";
  action?: ReactNode;
  above?: ReactNode;
  toolbarExtra?: ReactNode;
  emptyText?: string;
  onChanged?: () => void;
}) {
  const [board, setBoard] = useState<CommitmentBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [owner, setOwner] = useState<OwnerFilter>(defaultOwner);
  const [stateFilter, setStateFilter] = useState<StateFilter>("open");
  const [showAll, setShowAll] = useState(false);
  const [touched, setTouched] = useState<Record<string, Touched>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [rootRef, width] = useWidth<HTMLElement>();
  const today = localDateStr();
  const wide = width >= 720;

  const load = useCallback(() => {
    getCommitmentBoard()
      .then((b) => {
        setBoard(b);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load, reloadKey]);

  // Mission Control's "Overdue commitments" count lands here.
  useEffect(() => {
    if (!request) return;
    setOwner(request.owner);
    setStateFilter(request.state);
    setShowAll(false);
    const el = document.getElementById(id);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    document.getElementById(`${id}-heading`)?.focus({ preventScroll: true });
  }, [request?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Board rows, with this visit's own changes laid over them. A dropped row
  // is no longer on the board but stays here until reload.
  const rows = useMemo(() => {
    const base = (board?.commitments ?? []).filter((c) => !include || include(c));
    const byId = new Map(base.map((c) => [c.id, c]));
    for (const [cid, t] of Object.entries(touched)) {
      if (!byId.has(cid) && include && !include(t.row)) continue;
      byId.set(cid, t.row);
    }
    return Array.from(byId.values());
  }, [board, include, touched]);

  const people = useMemo(() => {
    const list = allowedPeople ?? board?.people ?? [];
    const involved = new Set(rows.map((c) => c.direct_report_id).filter(Boolean));
    return list.filter((p) => involved.has(p.id));
  }, [allowedPeople, board?.people, rows]);
  const hasOutside = rows.some((c) => c.owner === "counterpart");

  // A person filter for someone no longer in scope falls back to the default.
  useEffect(() => {
    if (!["you", "team", "outside", "everyone"].includes(owner) && board && !people.some((p) => p.id === owner)) setOwner(defaultOwner);
  }, [people, owner, defaultOwner, board]);

  const openRows = rows.filter((c) => c.status === "open" || touched[c.id]);
  const compact = openRows.length <= COMPACT_MAX && !request;
  const ownerRows = rows.filter((c) => matchesOwner(c, owner) || touched[c.id]);
  const counts = Object.fromEntries(
    STATES.map((s) => [s.key, ownerRows.filter((c) => matchesState(c, s.key, today)).length])
  ) as Record<StateFilter, number>;

  const filtered = compact
    ? openRows
    : rows.filter((c) => touched[c.id] ? matchesOwner(touched[c.id].prev, owner) || matchesOwner(c, owner) : matchesOwner(c, owner) && matchesState(c, stateFilter, today));
  // A touched row keeps its place: sort by how it was before the change.
  const sorted = sortRows(filtered.map((c) => touched[c.id]?.prev ?? c), today).map((c) => touched[c.id]?.row ?? c);
  const visible = showAll ? sorted : sorted.slice(0, INITIAL_ROWS);

  async function change(c: BoardCommitment, edit: CommitmentEdit, next: Partial<BoardCommitment>) {
    setBusy((b) => new Set(b).add(c.id));
    setError(null);
    try {
      await editCommitment(c.id, { ...edit, surface });
      setTouched((t) => ({ ...t, [c.id]: { prev: t[c.id]?.prev ?? c, row: { ...c, ...next }, told: t[c.id]?.told } }));
      onChanged?.();
      return true;
    } catch (e) {
      const detail = e instanceof ApiError && e.status === 422 ? e.detail : null;
      setError({ id: c.id, text: detail ?? "That didn’t save. Try again." });
      return false;
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(c.id);
        return next;
      });
    }
  }

  const tick = (c: BoardCommitment) =>
    c.status === "done"
      ? change(c, { status: "open" }, { status: "open", completed_at: null })
      : change(c, { status: "done" }, { status: "done", completed_at: new Date().toISOString() });

  async function tell(c: BoardCommitment) {
    if (!c.direct_report_id) return;
    setTouched((t) => ({ ...t, [c.id]: { ...t[c.id], told: "saving" } }));
    try {
      await createCaptureNote(c.direct_report_id, `Let ${firstName(c.with_name)} know this is done: ${c.description}`);
      setTouched((t) => ({ ...t, [c.id]: { ...t[c.id], told: "done" } }));
    } catch {
      setTouched((t) => ({ ...t, [c.id]: { ...t[c.id], told: "failed" } }));
    }
  }

  if (failed && !board) {
    return (
      <section id={id} ref={rootRef} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
        <Heading id={id} title={title} action={action} />
        <p className="mt-3 rounded-lg bg-surface px-4 py-4 text-sm text-ink-secondary" role="alert">
          Commitments couldn’t be loaded.{" "}
          <button type="button" onClick={load} className="text-brand hover:text-brand-hover">Try again</button>
        </p>
      </section>
    );
  }

  return (
    <section id={id} ref={rootRef} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
      <Heading id={id} title={title} action={action} />
      {intro && <p className="mt-1 text-xs text-ink-muted">{intro}</p>}
      {above}

      {!board ? (
        <div className="mt-4 space-y-2" aria-busy="true" aria-label="Loading commitments">
          {[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded-md bg-sunken motion-reduce:animate-none" />)}
        </div>
      ) : (
        <>
          {(!compact || toolbarExtra) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {!compact && (
                <>
                  <label className="flex items-center gap-2 text-xs text-ink-muted">
                    <span>Owner</span>
                    <select
                      value={owner}
                      onChange={(e) => {
                        setOwner(e.target.value);
                        setShowAll(false);
                      }}
                      className="h-8 rounded-md border border-control bg-sunken px-2 text-xs text-ink-body"
                    >
                      <option value="you">You owe</option>
                      <option value="team">Your people owe</option>
                      {hasOutside && <option value="outside">Owed from outside the team</option>}
                      <option value="everyone">Everyone</option>
                      {people.length > 0 && (
                        <optgroup label="Between you and">
                          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-1" role="group" aria-label="Status">
                    {STATES.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        aria-pressed={stateFilter === s.key}
                        onClick={() => {
                          setStateFilter(s.key);
                          setShowAll(false);
                        }}
                        className={`rounded-md px-2.5 py-1 text-xs ${
                          stateFilter === s.key ? "bg-brand-tint text-brand" : "text-ink-secondary hover:bg-sunken hover:text-ink"
                        }`}
                      >
                        {s.label} · <span className="tabular-nums">{counts[s.key]}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {toolbarExtra}
            </div>
          )}

          {sorted.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              {rows.filter((c) => c.status === "open").length === 0 && stateFilter !== "done" ? (
                emptyText
              ) : (
                <>
                  Nothing matches these filters.{" "}
                  {(owner !== "everyone" || stateFilter !== "open") && (
                    <button
                      type="button"
                      onClick={() => {
                        setOwner("everyone");
                        setStateFilter("open");
                      }}
                      className="text-brand hover:text-brand-hover"
                    >
                      Show everyone’s open commitments
                    </button>
                  )}
                </>
              )}
            </p>
          ) : (
            <div className="mt-3" role="table" aria-label={title} aria-rowcount={sorted.length}>
              {wide && (
                <div role="row" className="grid grid-cols-[28px_minmax(0,1fr)_170px_200px_120px_40px] gap-3 border-b border-hairline pb-2 text-2xs font-medium uppercase tracking-wide text-ink-muted">
                  <span role="columnheader"><span className="sr-only">Done</span></span>
                  <span role="columnheader">Commitment</span>
                  <span role="columnheader">Owner</span>
                  <span role="columnheader">From</span>
                  <span role="columnheader">Due</span>
                  <span role="columnheader"><span className="sr-only">Actions</span></span>
                </div>
              )}
              {visible.map((c) => (
                <Row
                  key={c.id}
                  c={c}
                  today={today}
                  wide={wide}
                  touched={touched[c.id]}
                  busy={busy.has(c.id)}
                  error={error?.id === c.id ? error.text : null}
                  editing={editing === c.id}
                  people={allowedPeople ?? board.people}
                  onTick={() => tick(c)}
                  onDrop={() => {
                    setEditing(null);
                    change(c, { status: "dropped" }, { status: "dropped", completed_at: null });
                  }}
                  onUndo={() => {
                    const prev = touched[c.id]?.prev;
                    if (prev) change(c, { status: prev.status }, { status: prev.status, completed_at: prev.completed_at });
                  }}
                  onReopen={() => change(c, { status: "open" }, { status: "open", completed_at: null })}
                  onTell={() => tell(c)}
                  onEdit={() => setEditing((cur) => (cur === c.id ? null : c.id))}
                  onSave={async (edit, next) => {
                    if (await change(c, edit, next)) setEditing(null);
                  }}
                />
              ))}
            </div>
          )}
          {sorted.length > INITIAL_ROWS && (
            <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="mt-3 text-sm text-brand hover:text-brand-hover">
              {showAll ? "Show fewer" : `Show all ${sorted.length}`}
            </button>
          )}
          {failed && <p className="mt-2 text-xs text-amber-700" role="status">Couldn’t refresh. Showing what was loaded earlier.</p>}
        </>
      )}
    </section>
  );
}

function Heading({ id, title, action }: { id: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={`${id}-heading`} tabIndex={-1} className="font-serif text-[1.6rem] font-normal leading-tight tracking-[-0.01em] text-ink focus:outline-none">
        {title}
      </h2>
      {action}
    </div>
  );
}

function OwnerCell({ c }: { c: BoardCommitment }) {
  if (c.owner === "you") {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <PersonAvatar id={null} name="You" size="xs" />
        <span className="min-w-0 truncate">
          You{c.with_name && <span className="text-ink-muted"> → {firstName(c.with_name)}</span>}
        </span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <PersonAvatar id={c.owner === "report" ? c.direct_report_id : null} name={c.owner_name ?? "?"} size="xs" />
      <span className="min-w-0 truncate">
        {c.owner_name}
        {c.owner === "counterpart" && <span className="text-ink-muted"> (outside)</span>}
      </span>
    </span>
  );
}

function SourceCell({ c }: { c: BoardCommitment }) {
  const date = c.source.date ? shortDate(c.source.date) : null;
  const label = (
    <>
      {c.source.label}
      {date && <span className="text-ink-muted"> · {date}</span>}
    </>
  );
  const full = date ? `${c.source.label} · ${date}` : c.source.label;
  return c.source.href ? (
    <Link href={c.source.href} title={full} className="min-w-0 truncate text-ink-secondary hover:text-brand">{label}</Link>
  ) : (
    <span title={full} className="min-w-0 truncate text-ink-muted">{label}</span>
  );
}

function DueCell({ c, today }: { c: BoardCommitment; today: string }) {
  if (c.status === "done") return <span className="text-ink-muted">Done{c.completed_at ? ` ${shortDate(localDateStr(new Date(c.completed_at)))}` : ""}</span>;
  if (c.status === "dropped") return <span className="text-ink-muted">Dropped</span>;
  if (!c.due_date) return <span className="text-ink-faint">No date</span>;
  if (c.due_date < today) return <span className="text-amber-700">{ageWords(daysBetween(c.due_date, today))} overdue</span>;
  if (c.due_date === today) return <span className="text-ink">Today</span>;
  return <span className={c.due_date <= addDaysStr(today, 7) ? "text-ink" : "text-ink-secondary"}>{shortDate(c.due_date)}</span>;
}

function Row({
  c,
  today,
  wide,
  touched,
  busy,
  error,
  editing,
  people,
  onTick,
  onDrop,
  onUndo,
  onReopen,
  onTell,
  onEdit,
  onSave,
}: {
  c: BoardCommitment;
  today: string;
  wide: boolean;
  touched?: Touched;
  busy: boolean;
  error: string | null;
  editing: boolean;
  people: { id: string; name: string }[];
  onTick: () => void;
  onDrop: () => void;
  onUndo: () => void;
  onReopen: () => void;
  onTell: () => void;
  onEdit: () => void;
  onSave: (edit: CommitmentEdit, next: Partial<BoardCommitment>) => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const done = c.status === "done";
  const resolved = c.status !== "open";
  const stale = staleNote(c, createdDay(c), today);
  const statusChanged = touched && touched.prev.status !== c.status;
  const canTell = done && statusChanged && c.owner === "you" && !!c.direct_report_id;

  const checkbox = (
    <input
      type="checkbox"
      checked={done}
      disabled={busy || c.status === "dropped"}
      onChange={onTick}
      aria-label={done ? `Reopen: ${c.description}` : `Mark done: ${c.description}`}
      className="mt-0.5 h-4 w-4 cursor-pointer rounded border-control accent-brand disabled:cursor-default"
    />
  );

  const text = (
    <span className={`block text-sm leading-6 ${resolved ? "text-ink-muted line-through decoration-ink-faint" : "text-ink"}`}>
      {c.description}
    </span>
  );

  const actions = (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenu((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-label={`More for: ${c.description}`}
        className="grid h-7 w-7 place-items-center rounded-md text-ink-muted hover:bg-sunken hover:text-ink"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {menu && (
        <div role="menu" className="absolute right-0 top-8 z-30 w-40 rounded-lg border border-hairline bg-elevated p-1 shadow-lg">
          <button role="menuitem" type="button" className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-ink-body hover:bg-sunken" onClick={() => { setMenu(false); onEdit(); }}>
            Edit
          </button>
          {c.status === "open" && (
            <button role="menuitem" type="button" className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-ink-body hover:bg-sunken" onClick={() => { setMenu(false); onDrop(); }}>
              Drop it
            </button>
          )}
          {resolved && (
            <button role="menuitem" type="button" className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-ink-body hover:bg-sunken" onClick={() => { setMenu(false); onReopen(); }}>
              Reopen
            </button>
          )}
        </div>
      )}
    </div>
  );

  const followUp = (statusChanged || stale || error) && (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {statusChanged && (
        <>
          <span className="text-ink-muted">{c.status === "done" ? "Marked done." : c.status === "dropped" ? "Dropped." : "Reopened."}</span>
          {c.status !== "open" && (
            <button type="button" onClick={onUndo} disabled={busy} className="text-brand hover:text-brand-hover">Undo</button>
          )}
        </>
      )}
      {canTell && !touched?.told && (
        <button type="button" onClick={onTell} className="text-brand hover:text-brand-hover">
          Tell {firstName(c.with_name)} in your next 1:1
        </button>
      )}
      {touched?.told === "saving" && <span className="text-ink-muted">Adding…</span>}
      {touched?.told === "done" && <span className="text-ink-muted">Added to {firstName(c.with_name)}’s next 1:1 prep.</span>}
      {touched?.told === "failed" && (
        <button type="button" onClick={onTell} className="text-amber-700 hover:text-amber-800">Couldn’t add it. Try again</button>
      )}
      {stale && !statusChanged && (
        <button type="button" onClick={onEdit} className="text-amber-700 hover:text-amber-800">{stale}</button>
      )}
      {error && <span className="text-xs text-red-700" role="alert">{error}</span>}
    </div>
  );

  const editor = editing && <Editor c={c} people={people} busy={busy} onCancel={onEdit} onSave={onSave} onDrop={onDrop} />;

  if (wide) {
    return (
      <div role="row" className="border-b border-hairline py-2.5">
        <div className="grid grid-cols-[28px_minmax(0,1fr)_170px_200px_120px_40px] items-start gap-3 text-xs">
          <span role="cell" className="pt-1">{checkbox}</span>
          <span role="cell" className="min-w-0">{text}{followUp}</span>
          <span role="cell" className="min-w-0 pt-1 text-ink-body"><OwnerCell c={c} /></span>
          <span role="cell" className="flex min-w-0 pt-1.5"><SourceCell c={c} /></span>
          <span role="cell" className="pt-1.5"><DueCell c={c} today={today} /></span>
          <span role="cell" className="pt-0.5">{actions}</span>
        </div>
        {editor}
      </div>
    );
  }

  return (
    <div role="row" className="border-b border-hairline py-3">
      <div className="flex items-start gap-3">
        <span role="cell" className="pt-1">{checkbox}</span>
        <div role="cell" className="min-w-0 flex-1">
          {text}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-body">
            <OwnerCell c={c} />
            <span aria-hidden="true" className="text-ink-faint">·</span>
            <DueCell c={c} today={today} />
          </div>
          <div className="mt-0.5 flex min-w-0 text-xs"><SourceCell c={c} /></div>
          {followUp}
        </div>
        <span role="cell">{actions}</span>
      </div>
      {editor}
    </div>
  );
}

function Editor({
  c,
  people,
  busy,
  onCancel,
  onSave,
  onDrop,
}: {
  c: BoardCommitment;
  people: { id: string; name: string }[];
  busy: boolean;
  onCancel: () => void;
  onSave: (edit: CommitmentEdit, next: Partial<BoardCommitment>) => void;
  onDrop: () => void;
}) {
  const [text, setText] = useState(c.description);
  const [due, setDue] = useState(c.due_date ?? "");
  // Owner choices follow the row's kind (backend update_commitment):
  // a team row can go to anyone or you; a 1:1 row flips sides with its person;
  // an outside row's owner can't change here.
  const ownerNow = c.owner === "you" ? "you" : c.direct_report_id ?? "";
  const [ownerChoice, setOwnerChoice] = useState(ownerNow);
  const personName = c.owner === "you" ? c.with_name : c.owner_name;
  const ownerOptions: { value: string; label: string }[] =
    c.owner === "counterpart"
      ? []
      : c.is_team_commitment
        ? [{ value: "you", label: "You" }, ...people.map((p) => ({ value: p.id, label: p.name }))]
        : c.direct_report_id
          ? [{ value: "you", label: `You owe ${firstName(personName)}` }, { value: c.direct_report_id, label: `${firstName(personName)} owes you` }]
          : [];

  function save() {
    const edit: CommitmentEdit = {};
    const next: Partial<BoardCommitment> = {};
    const trimmed = text.trim();
    if (trimmed && trimmed !== c.description) {
      edit.description = trimmed;
      next.description = trimmed;
    }
    if ((due || null) !== c.due_date) {
      edit.due_date = due || null;
      next.due_date = due || null;
    }
    if (ownerOptions.length && ownerChoice !== ownerNow) {
      if (ownerChoice === "you") {
        edit.owner = "manager";
        next.owner = "you";
        next.owner_name = null;
        if (c.is_team_commitment) {
          next.direct_report_id = null;
          next.with_name = null;
        } else {
          next.with_name = personName;
        }
      } else {
        edit.owner = "direct_report";
        if (c.is_team_commitment) edit.direct_report_id = ownerChoice;
        const name = people.find((p) => p.id === ownerChoice)?.name ?? personName;
        next.owner = "report";
        next.owner_name = name;
        next.with_name = null;
        next.direct_report_id = ownerChoice;
      }
    }
    if (!Object.keys(edit).length) return onCancel();
    onSave(edit, next);
  }

  return (
    <div className="mt-2 rounded-lg bg-surface px-4 py-3 sm:ml-10">
      <label className={LABEL} htmlFor={`edit-${c.id}`}>Commitment</label>
      <NoteField id={`edit-${c.id}`} value={text} onChange={setText} rows={2} className="w-full text-sm" />
      <div className={`mt-2 grid gap-2 ${ownerOptions.length ? "sm:grid-cols-2" : ""}`}>
        {ownerOptions.length > 0 && (
          <div>
            <label className={LABEL} htmlFor={`owner-${c.id}`}>Who owes it</label>
            <select id={`owner-${c.id}`} value={ownerChoice} onChange={(e) => setOwnerChoice(e.target.value)} className={SELECT}>
              {ownerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={LABEL} htmlFor={`due-${c.id}`}>Due</label>
          <div className="flex items-center gap-2">
            <input id={`due-${c.id}`} type="date" value={due} onChange={(e) => setDue(e.target.value)} className={INPUT} />
            {due && (
              <button type="button" onClick={() => setDue("")} className="shrink-0 text-xs text-ink-secondary hover:text-ink">No date</button>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {c.status === "open" ? (
          <button type="button" onClick={onDrop} disabled={busy} className="text-xs text-ink-secondary hover:text-ink">Drop it instead</button>
        ) : <span />}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={BTN_GHOST}>Cancel</button>
          <button type="button" onClick={save} disabled={busy || !text.trim()} className={BTN_PRIMARY_SM}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
