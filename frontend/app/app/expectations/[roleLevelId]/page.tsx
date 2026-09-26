"use client";

// One role: its working draft (a new role) or working revision (an approved
// role being refined), with the coaching panel alongside; or, with no draft
// open, the approved expectations in use and their open details; or, for a
// role with nothing yet, the ways to start. ?focus= opens straight onto a
// question, a decision or an item ("target:<key>", "decision:<id>",
// "item:<key>", or a question id).

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  RoleItem,
  RoleQuestion,
  RoleSection,
  RoleSuggestion,
  RoleWorkspace,
  RolesOverviewLevel,
  actOnRoleSuggestion,
  composeRoleFromJd,
  copyIntoRoleDraft,
  deferRoleQuestion,
  discardRoleDraft,
  getRoleWorkspace,
  getRolesOverview,
  openRoleDraft,
  reanalyzeRoleDraft,
  saveRoleDraft,
} from "@/lib/api";
import PageShell from "@/components/PageShell";
import { SkeletonSection } from "@/components/Skeleton";
import ItemEditor from "@/components/expectations/ItemEditor";
import CoachPanel from "@/components/expectations/CoachPanel";
import JdInput from "@/components/expectations/JdInput";
import RoleDocument from "@/components/expectations/RoleDocument";
import { Notice, SECTION_COPY, SECTION_ORDER, SourcePane, blankItem, formatDay } from "@/components/expectations/shared";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, EYEBROW, INPUT, LABEL } from "@/lib/tokens";

export default function RolePage() {
  return (
    <Suspense>
      <RoleView />
    </Suspense>
  );
}

function errorText(e: unknown, fallback: string) {
  if (e instanceof ApiError) {
    if (e.status === 409) return e.detail;
    if (e.status < 500 && e.status !== 502) return e.detail;
  }
  return fallback;
}

function RoleView() {
  const { roleLevelId } = useParams<{ roleLevelId: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const [ws, setWs] = useState<RoleWorkspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(params.get("focus"));

  const load = useCallback(() => {
    getRoleWorkspace(roleLevelId)
      .then((w) => {
        setWs(w);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof ApiError && e.status === 404 ? "This role doesn’t exist, or it isn’t in your workspace." : "This role couldn’t be loaded. Try again in a moment."));
  }, [roleLevelId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) {
    return (
      <PageShell maxWidth="6xl">
        <BackLink />
        <p role="alert" className="mt-6 text-sm text-red-700">
          {loadError}
        </p>
      </PageShell>
    );
  }
  if (!ws) {
    return (
      <PageShell maxWidth="6xl">
        <BackLink />
        <SkeletonSection label="Loading role" variant="list" className="mt-6" />
      </PageShell>
    );
  }
  if (ws.draft) {
    return <Workspace key={ws.draft.id} initial={ws} focus={focus} onFocusUsed={() => setFocus(null)} onReplace={setWs} router={router} />;
  }
  if (ws.approved_items.length) {
    return <ApprovedView ws={ws} focus={focus} onOpened={(w, f) => { setFocus(f); setWs(w); }} />;
  }
  return <StartView ws={ws} onOpened={setWs} />;
}

function BackLink() {
  return (
    <Link href="/app/expectations" className="text-sm text-ink-secondary hover:text-ink">
      ← All roles &amp; expectations
    </Link>
  );
}

function RoleHeader({ ws, badge }: { ws: RoleWorkspace; badge?: string }) {
  const people = ws.people.map((p) => p.name);
  return (
    <div className="mt-5">
      <p className={EYEBROW}>
        {ws.role.family ? `${ws.role.family.name} ladder · ` : ""}Level {ws.role.job_level}
      </p>
      <h1 className="mt-1.5 font-serif text-[2.2rem] font-normal leading-tight tracking-[-0.02em] text-ink sm:text-[2.5rem]">{ws.role.title}</h1>
      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
        <span>{people.length ? people.join(", ") : "No one assigned yet"}</span>
        {badge && <span className="rounded bg-sunken px-2 py-0.5 text-xs font-medium text-ink-secondary">{badge}</span>}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The draft workspace
// ---------------------------------------------------------------------------

function Workspace({
  initial,
  focus,
  onFocusUsed,
  onReplace,
  router,
}: {
  initial: RoleWorkspace;
  focus: string | null;
  onFocusUsed: () => void;
  onReplace: (w: RoleWorkspace) => void;
  router: ReturnType<typeof useRouter>;
}) {
  const [ws, setWs] = useState(initial);
  const draft = ws.draft!;
  const [items, setItems] = useState<RoleItem[]>(draft.items);
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(draft.questions.map((q) => [q.id, q.answer ?? ""])));
  const [statuses, setStatuses] = useState<Record<string, RoleQuestion["status"]>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "brand" | "amber" | "red"; text: string } | null>(
    draft.analysis?.status === "composed" && draft.analysis.notes?.length ? { tone: "brand", text: draft.analysis.notes.join(" ") } : null
  );
  const [highlight, setHighlight] = useState<string | null>(null);
  const [focusQuestion, setFocusQuestion] = useState<string | null>(null);
  const [copyFrom, setCopyFrom] = useState("");
  const [copyOptions, setCopyOptions] = useState<RolesOverviewLevel[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const savedVersion = useRef(draft.version);

  // Take a fresh server copy: the manager's unsaved edits are only replaced
  // after they have been saved as part of the same action.
  function adopt(next: RoleWorkspace) {
    setWs(next);
    onReplace(next);
    if (!next.draft) return;
    savedVersion.current = next.draft.version;
    setItems(next.draft.items);
    setAnswers(Object.fromEntries(next.draft.questions.map((q) => [q.id, q.answer ?? ""])));
    setStatuses({});
    setDirty(false);
  }

  useEffect(() => {
    getRolesOverview()
      .then((o) => setCopyOptions(o.levels.filter((l) => l.status === "approved" || l.status === "revision").filter((l) => l.role_level_id !== draft.role_level_id)))
      .catch(() => setCopyOptions([]));
  }, [draft.role_level_id]);

  // Unsaved edits: warn before leaving the page.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const goToField = useCallback((itemKey: string, field: string) => {
    const el = document.querySelector<HTMLElement>(`#item-${CSS.escape(itemKey)} [data-field="${field}"]`) ??
      document.querySelector<HTMLElement>(`#item-${CSS.escape(itemKey)} [data-field="title"]`);
    const card = document.getElementById(`item-${itemKey}`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(itemKey);
    window.setTimeout(() => el?.focus({ preventScroll: true }), 250);
    window.setTimeout(() => setHighlight((h) => (h === itemKey ? null : h)), 2600);
  }, []);

  // Deep link from Needs review / the review screen.
  useEffect(() => {
    if (!focus) return;
    const q =
      draft.questions.find((x) => x.id === focus) ??
      (focus.startsWith("decision:") ? draft.questions.find((x) => x.decision_id === focus.slice(9)) : undefined);
    window.setTimeout(() => {
      if (focus.startsWith("item:")) {
        goToField(focus.slice(5), "title");
      } else if (q && q.topic === "target" && q.item_key) {
        setFocusQuestion(q.id);
        goToField(q.item_key, "target");
      } else if (q) {
        setFocusQuestion(q.id);
        document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (q.item_key) setHighlight(q.item_key);
      }
      onFocusUsed();
    }, 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bySection = useMemo(() => {
    const out: Record<RoleSection, RoleItem[]> = { responsibility: [], skill: [], value: [] };
    for (const i of items) out[i.section].push(i);
    return out;
  }, [items]);

  function saveBody() {
    const questions = draft.questions
      .map((q) => ({ id: q.id, answer: answers[q.id] ?? q.answer ?? null, status: statuses[q.id] ?? q.status }))
      .filter((q) => {
        const orig = draft.questions.find((x) => x.id === q.id)!;
        return (q.answer ?? "") !== (orig.answer ?? "") || q.status !== orig.status;
      });
    return { version: savedVersion.current, items, questions };
  }

  async function act<T>(label: string, fn: () => Promise<T>, fallback: string): Promise<T | null> {
    setBusy(label);
    setMessage(null);
    try {
      return await fn();
    } catch (e) {
      setMessage({ tone: "red", text: errorText(e, fallback) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function saveIfDirty(): Promise<number | null> {
    if (!dirty && Object.keys(statuses).length === 0 && !answersChanged()) return savedVersion.current;
    const next = await saveRoleDraft(draft.id, saveBody());
    adopt(next);
    return next.draft!.version;
  }

  function answersChanged() {
    return draft.questions.some((q) => (answers[q.id] ?? "") !== (q.answer ?? ""));
  }

  async function reanalyze() {
    const next = await act("analyze", () => reanalyzeRoleDraft(draft.id, saveBody()), "Your changes couldn’t be saved. Nothing was lost on this page — try again.");
    if (!next) return;
    adopt(next);
    if (next.analysis_failed) {
      setMessage({ tone: "amber", text: "Draft saved. The analysis couldn’t run just now — your edits are safe. Try again from the panel." });
    } else {
      const a = next.draft!.analysis;
      const bits = [
        a.new_questions ? `${a.new_questions} new question${a.new_questions === 1 ? "" : "s"}` : null,
        a.new_suggestions ? `${a.new_suggestions} suggestion${a.new_suggestions === 1 ? "" : "s"} to review` : null,
      ].filter(Boolean);
      setMessage({ tone: "brand", text: `Draft saved. Your edits are preserved${bits.length ? ` · ${bits.join(" · ")}` : " · nothing new to raise"}.` });
    }
  }

  async function saveLater() {
    const next = await act("later", () => saveRoleDraft(draft.id, saveBody()), "Your changes couldn’t be saved. Try again.");
    if (!next) return;
    setDirty(false);
    router.push("/app/expectations?notice=saved");
  }

  async function toReview() {
    const ok = await act("review", async () => saveIfDirty(), "Your changes couldn’t be saved. Try again.");
    if (ok === null) return;
    setDirty(false);
    router.push(`/app/expectations/${draft.role_level_id}/review`);
  }

  async function answer(q: RoleQuestion) {
    setStatuses((s) => ({ ...s, [q.id]: "answered" }));
    const body = saveBody();
    body.questions = [...body.questions.filter((x) => x.id !== q.id), { id: q.id, answer: answers[q.id] ?? "", status: "answered" }];
    const next = await act("answer", () => saveRoleDraft(draft.id, body), "Your answer couldn’t be saved. Try again.");
    if (next) {
      adopt(next);
      setMessage({ tone: "brand", text: "Answer saved. Save & reanalyze to see how it changes the draft." });
    } else setStatuses((s) => ({ ...s, [q.id]: q.status }));
  }

  async function dismiss(q: RoleQuestion) {
    const body = saveBody();
    body.questions = [...body.questions.filter((x) => x.id !== q.id), { id: q.id, answer: answers[q.id] ?? null, status: "dismissed" }];
    const next = await act("dismiss", () => saveRoleDraft(draft.id, body), "That couldn’t be saved. Try again.");
    if (next) adopt(next);
  }

  async function defer(q: RoleQuestion, date: string) {
    const next = await act(
      "defer",
      async () => {
        const version = await saveIfDirty();
        return deferRoleQuestion(draft.id, version ?? savedVersion.current, q.id, date);
      },
      "That couldn’t be scheduled. Try again."
    );
    if (next) {
      adopt(next);
      setMessage({ tone: "brand", text: `Saved for ${formatDay(date, true)}. It stays in Needs review until it’s resolved.` });
    }
  }

  async function suggestion(s: RoleSuggestion, action: "accept" | "dismiss") {
    const next = await act(
      "suggestion",
      async () => {
        const version = await saveIfDirty();
        return actOnRoleSuggestion(draft.id, s.id, version ?? savedVersion.current, action);
      },
      "That suggestion couldn’t be applied. Try again."
    );
    if (next) {
      adopt(next);
      if (action === "accept") {
        const key = s.type === "add" ? next.draft!.items[next.draft!.items.length - 1]?.key : s.item_key;
        if (key) window.setTimeout(() => goToField(key, s.type === "target" ? "target" : s.type === "rewrite" ? s.field : "title"), 100);
      }
    }
  }

  async function copy() {
    if (!copyFrom) return;
    const next = await act(
      "copy",
      async () => {
        const version = await saveIfDirty();
        return copyIntoRoleDraft(draft.id, version ?? savedVersion.current, copyFrom);
      },
      "Those expectations couldn’t be copied. Try again."
    );
    if (next) {
      adopt(next);
      setCopyFrom("");
      setMessage({ tone: "brand", text: next.copied ? `Copied ${next.copied} expectation${next.copied === 1 ? "" : "s"}. Edit them for this role.` : "Nothing new to copy — those titles are already in this draft." });
    }
  }

  async function discard() {
    const ok = await act("discard", () => discardRoleDraft(draft.id), "The draft couldn’t be discarded. Try again.");
    if (ok) {
      setDirty(false);
      router.push("/app/expectations?notice=discarded");
    }
  }

  function updateItem(next: RoleItem) {
    setItems((xs) => xs.map((x) => (x.key === next.key ? next : x)));
    setDirty(true);
  }

  function addItem(section: RoleSection) {
    const item = blankItem(section);
    setItems((xs) => [...xs, item]);
    setDirty(true);
    window.setTimeout(() => goToField(item.key, "title"), 50);
  }

  const revision = draft.kind === "revision" && ws.approved_items.length > 0;
  const pendingSuggestions = draft.suggestions.filter((s) => s.status === "pending").length;
  const openCount = draft.questions.filter((q) => (statuses[q.id] ?? q.status) === "open").length;

  return (
    <PageShell maxWidth="7xl">
      <BackLink />
      <RoleHeader ws={ws} badge={revision ? "Working revision" : "Working draft"} />
      <div className="mt-4 space-y-3">
        {revision && <Notice>Approved expectations remain in use while you refine this revision. Nothing changes until you approve it.</Notice>}
        {message && (
          <Notice tone={message.tone} onClose={() => setMessage(null)}>
            {message.text}
          </Notice>
        )}
      </div>

      <div className="mt-5">
        <SourcePane text={draft.source_text} label={draft.source_label} />
      </div>
      {openCount > 0 && (
        <a href="#coach-heading" className="mt-3 inline-block text-sm font-medium text-blue-700 hover:underline lg:hidden">
          {openCount} decision{openCount === 1 ? "" : "s"} to make — jump to questions ↓
        </a>
      )}

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,1fr)]">
        <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="doc-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="doc-heading" className="text-lg font-semibold text-ink">
              Role expectations
            </h2>
            <span className="text-xs text-ink-muted">{dirty ? "Unsaved changes" : "All changes saved"}</span>
          </div>
          {items.length === 0 && (
            <p className="mt-3 text-sm text-ink-secondary">Nothing here yet. Add what the role owns, or copy expectations from another role below.</p>
          )}
          {SECTION_ORDER.map((section) => (
            <div key={section} className="mt-6">
              <div className="border-b border-divider pb-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">{SECTION_COPY[section].heading}</h3>
                <p className="text-xs text-ink-muted">{SECTION_COPY[section].blurb}</p>
              </div>
              <div className="mt-4 space-y-6">
                {bySection[section].map((item) => (
                  <ItemEditor
                    key={item.key}
                    item={item}
                    highlighted={highlight === item.key}
                    onChange={updateItem}
                    onRemove={() => {
                      setItems((xs) => xs.filter((x) => x.key !== item.key));
                      setDirty(true);
                    }}
                  />
                ))}
              </div>
              {section === "value" && ws.org_values.length > 0 && (
                <p className="mt-3 text-xs text-ink-muted">
                  Company values already included: {ws.org_values.map((v) => v.name).join(", ")}.
                </p>
              )}
              <button type="button" onClick={() => addItem(section)} className="mt-3 text-sm font-medium text-brand hover:text-brand-hover">
                {SECTION_COPY[section].add}
              </button>
            </div>
          ))}

          {copyOptions.length > 0 && (
            <div className="mt-8 border-t border-divider pt-4">
              <label className={LABEL} htmlFor="copy-from">
                Reuse expectations from another role
              </label>
              <div className="flex flex-wrap gap-2">
                <select id="copy-from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className={`${INPUT} w-auto min-w-[16rem] flex-1`}>
                  <option value="">Choose a role…</option>
                  {copyOptions.map((l) => (
                    <option key={l.role_level_id} value={l.role_level_id}>
                      {l.job_role} · Level {l.job_level}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={copy} disabled={!copyFrom || !!busy} className={BTN_SECONDARY}>
                  Copy in
                </button>
              </div>
              <p className="mt-1 text-xs text-ink-muted">Copies arrive as editable items; titles already here are skipped.</p>
            </div>
          )}
        </section>

        <CoachPanel
          draft={draft}
          items={items}
          answers={answers}
          statuses={statuses}
          busy={!!busy}
          focusId={focusQuestion}
          onAnswerChange={(qid, text) => setAnswers((a) => ({ ...a, [qid]: text }))}
          onAnswer={answer}
          onDismiss={dismiss}
          onDefer={defer}
          onGoToField={goToField}
          onSuggestion={suggestion}
          onRetry={reanalyze}
        />
      </div>

      <div className="z-10 -mx-6 mt-6 border-t border-hairline bg-canvas/95 px-6 py-4 backdrop-blur sm:sticky sm:bottom-0 sm:-mx-8 sm:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={saveLater} disabled={!!busy} className={BTN_GHOST}>
              {busy === "later" ? "Saving…" : "Save & finish later"}
            </button>
            {confirmDiscard ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-ink-secondary">{revision ? "Discard this revision? Approved expectations stay as they are." : "Discard this draft?"}</span>
                <button type="button" onClick={discard} disabled={!!busy} className="font-medium text-red-700 hover:underline">
                  Discard
                </button>
                <button type="button" onClick={() => setConfirmDiscard(false)} className="text-ink-secondary hover:text-ink">
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDiscard(true)} className="text-sm text-ink-muted hover:text-red-700">
                Discard {revision ? "revision" : "draft"}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={reanalyze} disabled={!!busy} className={BTN_SECONDARY}>
              {busy === "analyze" ? "Saving & reanalyzing…" : "Save & reanalyze"}
            </button>
            <button type="button" onClick={toReview} disabled={!!busy || items.length === 0} className={BTN_PRIMARY}>
              {busy === "review" ? "Saving…" : "Review for approval →"}
            </button>
          </div>
        </div>
        {pendingSuggestions > 0 && (
          <p className="mt-2 text-xs text-ink-muted">
            {pendingSuggestions} suggestion{pendingSuggestions === 1 ? "" : "s"} not used yet — they won’t be part of what you approve unless you use them.
          </p>
        )}
      </div>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Approved, nothing open: what's in use, and the details still open
// ---------------------------------------------------------------------------

function ApprovedView({ ws, focus, onOpened }: { ws: RoleWorkspace; focus: string | null; onOpened: (w: RoleWorkspace, focus: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focusedDecision = focus?.startsWith("decision:") ? focus.slice(9) : null;

  async function refine(decisionId?: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await openRoleDraft({ role_level_id: ws.role.id });
      const q = decisionId ? next.draft?.questions.find((x) => x.decision_id === decisionId) : undefined;
      onOpened(next, q ? q.id : null);
    } catch (e) {
      setError(errorText(e, "A revision couldn’t be opened just now. Try again."));
      setBusy(false);
    }
  }

  return (
    <PageShell maxWidth="6xl">
      <BackLink />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <RoleHeader ws={ws} badge={ws.approved_at ? `Approved ${formatDay(ws.approved_at, true)}` : "In use"} />
        <button type="button" onClick={() => refine()} disabled={busy} className={`${BTN_SECONDARY} shrink-0 self-start sm:self-auto`}>
          Refine expectations
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}
      {ws.open_decisions.length > 0 && (
        <section className="mt-5 rounded-xl bg-amber-50 p-5" aria-labelledby="open-details-heading">
          <h2 id="open-details-heading" className="text-base font-semibold text-amber-800">
            {ws.open_decisions.length === 1 ? "One detail is still open" : `${ws.open_decisions.length} details are still open`}
          </h2>
          <ul className="mt-2">
            {ws.open_decisions.map((d) => (
              <li
                key={d.id}
                className={`flex flex-col gap-2 border-t border-amber-500/25 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between ${focusedDecision === d.id ? "rounded-md ring-2 ring-amber-500/50 ring-offset-2 ring-offset-amber-50" : ""}`}
              >
                <div>
                  <p className="text-sm font-medium text-ink">{d.question}</p>
                  <p className="text-xs text-amber-800">
                    {d.topic === "target" ? "Approved without a target · not judged against a number" : "Parked"} · back {formatDay(d.follow_up_on)}
                  </p>
                </div>
                <button type="button" onClick={() => refine(d.id)} disabled={busy} className={`${BTN_SECONDARY} shrink-0 bg-surface`}>
                  Resolve in a revision →
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(16rem,1fr)]">
        <RoleDocument items={ws.approved_items} orgValues={ws.org_values} openTargets={new Set(ws.open_decisions.filter((d) => d.topic === "target").map((d) => d.item_key || ""))} />
        <aside className="space-y-5">
          <SourcePane text={ws.role.job_responsibilities} label="Saved job description" />
          <section className={`${CARD} p-5`}>
            <h2 className="text-sm font-semibold text-ink">Where these are used</h2>
            <p className="mt-1 text-sm text-ink-secondary">1:1 preparation, development and assessments for everyone in this role. Changes go through a revision and your approval before they replace these.</p>
          </section>
        </aside>
      </div>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Nothing yet: start from the JD, another role, or blank
// ---------------------------------------------------------------------------

function StartView({ ws, onOpened }: { ws: RoleWorkspace; onOpened: (w: RoleWorkspace) => void }) {
  const [text, setText] = useState(ws.role.job_responsibilities ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyOptions, setCopyOptions] = useState<RolesOverviewLevel[]>([]);
  const [copyFrom, setCopyFrom] = useState("");

  useEffect(() => {
    getRolesOverview()
      .then((o) => setCopyOptions(o.levels.filter((l) => (l.status === "approved" || l.status === "revision") && l.role_level_id !== ws.role.id)))
      .catch(() => setCopyOptions([]));
  }, [ws.role.id]);

  async function fromJd() {
    setBusy("compose");
    setError(null);
    try {
      const composed = await composeRoleFromJd(file ? { file, roleLevelId: ws.role.id } : { text: text.trim(), roleLevelId: ws.role.id });
      const next = await openRoleDraft({
        role_level_id: ws.role.id,
        source_text: composed.source_text,
        source_label: composed.source_label,
        items: composed.items,
        questions: composed.questions,
        notes: composed.notes,
      });
      onOpened(next);
    } catch (e) {
      setError(errorText(e, "The first draft couldn’t be written just now. Your job description is still here — try again, or start blank."));
      setBusy(null);
    }
  }

  async function blank(copyRoleId?: string) {
    setBusy(copyRoleId ? "copy" : "blank");
    setError(null);
    try {
      let next = await openRoleDraft({ role_level_id: ws.role.id, source_text: text.trim() || null, source_label: text.trim() ? "Job description" : null });
      if (copyRoleId && next.draft) next = await copyIntoRoleDraft(next.draft.id, next.draft.version, copyRoleId);
      onOpened(next);
    } catch (e) {
      setError(errorText(e, "The draft couldn’t be opened. Try again."));
      setBusy(null);
    }
  }

  return (
    <PageShell maxWidth="4xl">
      <BackLink />
      <RoleHeader ws={ws} badge="No expectations yet" />
      {error && (
        <div className="mt-4">
          <Notice tone="amber" onClose={() => setError(null)}>
            {error}
          </Notice>
        </div>
      )}
      <section className={`${CARD} mt-6 p-5 sm:p-6`}>
        <h2 className="text-base font-semibold text-ink">Start from the job description</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          {ws.role.job_responsibilities ? "The description saved for this role is below — edit it or replace it." : "Paste or upload it. You’ll get a first draft and a few focused questions."}
        </p>
        <div className="mt-4">
          <JdInput text={text} onText={setText} file={file} onFile={setFile} disabled={!!busy} />
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={fromJd} disabled={!!busy || (!file && text.trim().length < 40)} className={BTN_PRIMARY}>
            {busy === "compose" ? "Reading and drafting…" : "Write the first draft"}
          </button>
        </div>
        {busy === "compose" && (
          <p className="mt-3 text-sm text-ink-secondary" role="status" aria-live="polite">
            Drafting what good looks like for this role. This usually takes under a minute.
          </p>
        )}
      </section>
      <section className={`${CARD} mt-4 p-5 sm:p-6`}>
        <h2 className="text-base font-semibold text-ink">Or start another way</h2>
        {copyOptions.length > 0 && (
          <div className="mt-3">
            <label className={LABEL} htmlFor="start-copy">
              Reuse another role’s approved expectations
            </label>
            <div className="flex flex-wrap gap-2">
              <select id="start-copy" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className={`${INPUT} w-auto min-w-[16rem] flex-1`}>
                <option value="">Choose a role…</option>
                {copyOptions.map((l) => (
                  <option key={l.role_level_id} value={l.role_level_id}>
                    {l.job_role} · Level {l.job_level}
                  </option>
                ))}
              </select>
              <button type="button" disabled={!copyFrom || !!busy} onClick={() => blank(copyFrom)} className={BTN_SECONDARY}>
                {busy === "copy" ? "Copying…" : "Start from these"}
              </button>
            </div>
          </div>
        )}
        <button type="button" onClick={() => blank()} disabled={!!busy} className={`${BTN_GHOST} mt-4 px-0`}>
          {busy === "blank" ? "Opening…" : "Start with a blank draft →"}
        </button>
      </section>
    </PageShell>
  );
}
