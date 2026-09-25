"use client";

// Stage 2 — Draft & discuss. A readable draft comes first, then the few
// judgments that need thought (and why), then every judgment, always
// inspectable. Editing is direct; discussion is assessment-specific and its
// revisions are proposals the manager applies or keeps. No per-row approval
// ritual: the final review confirms the whole displayed set together.

import { useEffect, useMemo, useRef, useState } from "react";
import NoteField from "@/components/NoteField";
import type { CatalogItem, ConversationMessage, EvidenceItem, ItemAction, PeriodAssessment } from "@/lib/api";
import { formatDay, firstName } from "@/lib/assessment-periods";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_GHOST, EYEBROW, INPUT } from "@/lib/tokens";
import { describeJudgment, EYEBROW_AI, EYEBROW_DRAFT, OriginBadge, PANEL, ScaleButtons, SourceChips } from "./shared";

type ActionBody = { action: ItemAction; point?: number; value?: number; period?: string; reason?: string };

const KIND_HEADING: Record<CatalogItem["kind"], string> = {
  overall: "Overall",
  skill: "Skills",
  value: "Values",
  metric: "Metrics",
};

export default function DraftStage({
  review,
  busy,
  initialOpenKey,
  onItem,
  onDiscuss,
  onRedraft,
  onKeepDraftContext,
  onNarrative,
  onReview,
  onDraftWithAI,
}: {
  review: PeriodAssessment;
  busy: string | null;
  initialOpenKey?: string | null;
  onItem: (key: string, body: ActionBody) => Promise<unknown>;
  onDiscuss: (message: string, itemKey: string | null) => Promise<unknown>;
  onRedraft: () => void;
  onKeepDraftContext: () => void;
  onNarrative: (text: string) => Promise<unknown>;
  onReview: () => void;
  onDraftWithAI: () => void;
}) {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(initialOpenKey ?? null);
  useEffect(() => {
    if (initialOpenKey)
      requestAnimationFrame(() => document.getElementById(`judgment-${initialOpenKey}`)?.scrollIntoView({ block: "center" }));
  }, [initialOpenKey]);
  const allRef = useRef<HTMLDivElement>(null);
  const evidence = review.evidence?.items || [];
  const byId = useMemo(() => new Map<string, EvidenceItem>(evidence.map((i) => [i.id, i])), [evidence]);
  const lookup = (id: string) => byId.get(id);
  const name = firstName(review.person?.name);
  const hasDraft = !!review.draft.generated_at;
  const attention = review.catalog.filter((c) => c.attention.length > 0);
  const unresolved = review.catalog.filter(
    (c) => c.state.decision.state !== "include" && !c.state.proposal && c.state.decision.origin !== "manager",
  );
  const included = review.catalog.filter((c) => c.state.decision.state === "include").length;
  const narrative = review.draft.narrative;
  const [editingNarrative, setEditingNarrative] = useState(false);
  const [narrativeText, setNarrativeText] = useState(narrative?.overview || "");
  useEffect(() => setNarrativeText(narrative?.overview || ""), [narrative?.overview]);

  const focusItem = review.catalog.find((c) => c.key === focusKey) || null;
  const discuss = (key: string | null) => {
    setFocusKey(key);
    requestAnimationFrame(() => document.getElementById("assessment-discussion-input")?.focus());
  };
  const inspect = (key: string) => {
    setOpenKey(key);
    requestAnimationFrame(() => document.getElementById(`judgment-${key}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  return (
    <>
      {review.flags.context_changed && (
        <div role="status" className="mt-5 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <span>Your context or sources changed after this draft. Judgments may need another look.</span>
          <button type="button" onClick={onRedraft} disabled={!!busy} className="font-medium underline disabled:opacity-50">
            Redraft with it
          </button>
          <button type="button" onClick={onKeepDraftContext} disabled={!!busy} className="underline disabled:opacity-50">
            Keep the draft as it is
          </button>
        </div>
      )}
      {review.draft.last_error && (
        <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <span>{review.draft.last_error}</span>
          <button type="button" onClick={onRedraft} disabled={!!busy} className="font-medium underline disabled:opacity-50">
            Try again
          </button>
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
        <div className="min-w-0 space-y-5">
          <section aria-labelledby="draft-title" className={PANEL}>
            <p className={EYEBROW_DRAFT}>Draft · not saved to the assessment record</p>
            {busy === "draft" ? (
              <div className="mt-4 space-y-3" aria-live="polite">
                <p className="text-sm text-ink-secondary">Drafting against each expectation’s own scale…</p>
                <div className="h-7 w-2/3 animate-pulse rounded bg-sunken" />
                <div className="h-4 w-full animate-pulse rounded bg-sunken" />
              </div>
            ) : hasDraft && narrative ? (
              <>
                <h2 id="draft-title" className="mt-3 font-serif text-[1.8rem] font-normal leading-tight text-ink">
                  {narrative.headline || `${name}’s draft`}
                </h2>
                {editingNarrative ? (
                  <div className="mt-2">
                    <NoteField value={narrativeText} onChange={setNarrativeText} rows={4} aria-label="Draft overview" />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        onClick={async () => {
                          await onNarrative(narrativeText);
                          setEditingNarrative(false);
                        }}
                      >
                        Save
                      </button>
                      <button type="button" className={BTN_GHOST} onClick={() => setEditingNarrative(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[1.05rem] leading-relaxed text-ink-body">
                    {narrative.overview}{" "}
                    <button type="button" onClick={() => setEditingNarrative(true)} className="text-xs text-ink-muted hover:text-ink">
                      Edit
                    </button>
                  </p>
                )}
              </>
            ) : (
              <>
                <h2 id="draft-title" className="mt-3 font-serif text-[1.8rem] font-normal leading-tight text-ink">
                  {review.mode === "manual" ? "Your judgments, your words" : "No draft yet"}
                </h2>
                <p className="mt-2 text-ink-body">
                  Set the judgments you can stand behind against each expectation below, and leave the rest unassessed.
                  Nothing is recorded until you review and complete.
                </p>
                <button type="button" onClick={onDraftWithAI} disabled={!!busy} className="mt-3 block text-sm text-brand hover:underline disabled:opacity-50">
                  Draft with AI instead →
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => allRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="mt-4 block text-left text-sm font-semibold text-brand hover:underline"
            >
              All judgments &amp; supporting examples ↓
            </button>

            {attention.length > 0 && (
              <div className="mt-5 space-y-5 border-t border-divider pt-5">
                {attention.map((c) => (
                  <AttentionCard key={c.key} item={c} lookup={lookup} busy={!!busy} onInspect={() => inspect(c.key)}
                    onDiscuss={() => discuss(c.key)} onItem={onItem} managerContext={review.manager_context} />
                ))}
              </div>
            )}
            {hasDraft && attention.length === 0 && busy !== "draft" && (
              <p className="mt-5 border-t border-divider pt-4 text-sm text-ink-secondary">
                Nothing in the draft is flagged as uncertain, conflicting or changed from a prior judgment. Every judgment is still yours to check below.
              </p>
            )}
            {unresolved.length > 0 && (
              <p className="mt-5 text-sm text-amber-700">
                Also unresolved:{" "}
                {unresolved.map((c, i) => (
                  <span key={c.key}>
                    {i > 0 && "; "}
                    <button type="button" onClick={() => inspect(c.key)} className="inline text-left hover:underline">
                      {c.name}
                      {c.state.unassessed_reason ? ` — ${c.state.unassessed_reason.replace(/\.$/, "")}` : ""}
                    </button>
                  </span>
                ))}
                . Left unassessed unless you set them.
              </p>
            )}
          </section>
        </div>

        <DiscussionPanel
          review={review}
          focusItem={focusItem}
          busy={busy}
          onClearFocus={() => setFocusKey(null)}
          onDiscuss={onDiscuss}
          onItem={onItem}
          onReview={onReview}
          included={included}
        />
      </div>

      <section ref={allRef} aria-labelledby="all-judgments" className="mt-8 scroll-mt-24">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="all-judgments" className="font-serif text-[1.6rem] font-normal text-ink">
            All judgments
          </h2>
          <p className="text-sm text-ink-secondary">
            {included} included · {review.catalog.length - included} unassessed · each on its own scale
          </p>
        </div>
        {(["overall", "skill", "value", "metric"] as const).map((kind) => {
          const rows = review.catalog.filter((c) => c.kind === kind);
          if (!rows.length) return null;
          return (
            <div key={kind} className="mt-5">
              <p className={EYEBROW}>{KIND_HEADING[kind]}</p>
              <ul className="mt-2 space-y-3">
                {rows.map((c) => (
                  <JudgmentRow
                    key={c.key}
                    item={c}
                    open={openKey === c.key}
                    onToggle={() => setOpenKey(openKey === c.key ? null : c.key)}
                    onItem={onItem}
                    onDiscuss={() => discuss(c.key)}
                    lookup={lookup}
                    busy={!!busy}
                    managerContext={review.manager_context}
                  />
                ))}
              </ul>
            </div>
          );
        })}
        {review.catalog.length === 1 && (
          <p className="mt-4 text-sm text-ink-secondary">
            No skills, values or metrics are configured for this role yet, so only the overall judgment applies. Expectations live in Settings → Roles.
          </p>
        )}
      </section>
    </>
  );
}

function AttentionCard({
  item,
  lookup,
  busy,
  onInspect,
  onDiscuss,
  onItem,
  managerContext,
}: {
  item: CatalogItem;
  lookup: (id: string) => EvidenceItem | undefined;
  busy: boolean;
  onInspect: () => void;
  onDiscuss: () => void;
  onItem: (key: string, body: ActionBody) => Promise<unknown>;
  managerContext: string | null;
}) {
  const s = item.state;
  const p = s.proposal;
  return (
    <article>
      <p className={EYEBROW_DRAFT}>Worth your attention · {item.name}</p>
      <p className="mt-2 text-ink-body">
        {item.prior ? <>Prior: {describeJudgment(item, item.prior)} · </> : null}
        {p ? <>AI proposes: <span className="font-semibold">{describeJudgment(item, p)}</span></> : "No proposal"}
      </p>
      {item.expectation && <p className="text-sm text-ink-secondary">Standard: {item.expectation}</p>}
      <ul className="mt-2 space-y-1 text-sm text-ink-body">
        {item.attention.map((a, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="text-amber-700">▲</span>
            {a}
          </li>
        ))}
      </ul>
      {p?.reason && <p className="mt-2 text-sm text-ink-secondary">Why: {p.reason}</p>}
      {p?.limitations && <p className="text-sm text-ink-secondary">Not established: {p.limitations}</p>}
      <SourceChips ids={p?.sources} lookup={lookup} managerContext={managerContext} label="Support:" />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onInspect} className={BTN_SECONDARY}>
          Inspect &amp; edit
        </button>
        <button type="button" onClick={onDiscuss} className={BTN_SECONDARY}>
          Discuss this judgment
        </button>
        {p && s.decision.origin === "ai" && (
          <button type="button" disabled={busy} onClick={() => onItem(item.key, { action: "keep_proposal" })} className={BTN_GHOST}>
            Keep as proposed
          </button>
        )}
      </div>
    </article>
  );
}

function JudgmentRow({
  item,
  open,
  onToggle,
  onItem,
  onDiscuss,
  lookup,
  busy,
  managerContext,
}: {
  item: CatalogItem;
  open: boolean;
  onToggle: () => void;
  onItem: (key: string, body: ActionBody) => Promise<unknown>;
  onDiscuss: () => void;
  lookup: (id: string) => EvidenceItem | undefined;
  busy: boolean;
  managerContext: string | null;
}) {
  const s = item.state;
  const d = s.decision;
  const included = d.state === "include";
  const [reason, setReason] = useState(d.reason || "");
  const [value, setValue] = useState(d.value != null ? String(d.value) : "");
  const [period, setPeriod] = useState(d.period || "");
  useEffect(() => {
    setReason(d.reason || "");
    setValue(d.value != null ? String(d.value) : "");
    setPeriod(d.period || "");
  }, [d.reason, d.value, d.period]);
  const decisionSources = d.sources && d.sources.length ? d.sources : undefined;
  const differsFromProposal =
    !!s.proposal && (!included || (item.kind === "metric" ? s.proposal.value !== d.value : s.proposal.point !== d.point));

  return (
    <li id={`judgment-${item.key}`} className={`scroll-mt-24 rounded-xl border bg-surface ${item.attention.length ? "border-amber-500/60" : "border-hairline"}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-col gap-1 px-4 py-3 text-left sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {item.name}
            {item.order_type === "primary" && <span className="ml-2 text-xs font-normal text-ink-muted">primary</span>}
          </p>
          {item.expectation && <p className="mt-0.5 text-sm text-ink-secondary">{item.expectation}</p>}
          {!open && d.reason && included && <p className="mt-1 line-clamp-2 text-sm text-ink-body">{d.reason}</p>}
        </div>
        <div className="sm:shrink-0 sm:text-right">
          <p className={`text-sm font-semibold ${included ? "text-ink" : "text-ink-muted"}`}>
            {included ? describeJudgment(item, d) : "Unassessed"}
          </p>
          <div className="mt-1 flex gap-1 sm:justify-end">
            {included && <OriginBadge origin={d.origin} />}
            {s.revision && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Revision waiting</span>}
          </div>
        </div>
      </button>
      {open && (
        <div className="border-t border-divider px-4 pb-4 pt-3">
          {s.revision && (
            <div className="mb-4 rounded-lg bg-blue-50 px-3 py-3 text-sm">
              <p className="font-semibold text-blue-700">
                AI · proposed revision {s.revision.source === "redraft" ? "(from the redraft)" : "(from your discussion)"}
              </p>
              <p className="mt-1 text-ink-body">
                {describeJudgment(item, s.revision)}
                {s.revision.reason ? ` — ${s.revision.reason}` : ""}
              </p>
              <SourceChips ids={s.revision.sources} lookup={lookup} managerContext={managerContext} />
              <p className="mt-2 text-xs text-ink-muted">Only this judgment and its reason change.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => onItem(item.key, { action: "apply_revision" })} className={BTN_SECONDARY}>
                  Apply revision
                </button>
                <button type="button" disabled={busy} onClick={() => onItem(item.key, { action: "dismiss_revision" })} className={BTN_SECONDARY}>
                  Keep current
                </button>
              </div>
            </div>
          )}

          {item.kind === "metric" ? (
            <div>
              <p className="text-xs text-ink-muted">
                A real reading for this period only{item.measurement_period && item.measurement_period !== "none" ? ` · measured per ${item.measurement_period}` : ""}.
                Nothing is inferred from activity.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-xs text-ink-secondary">
                  Reading
                  <input type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={`${INPUT} mt-1 w-32`} />
                </label>
                <label className="text-xs text-ink-secondary">
                  Measurement period
                  <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. Q3 2026" className={`${INPUT} mt-1 w-40`} />
                </label>
                <button
                  type="button"
                  disabled={busy || value.trim() === "" || !Number.isFinite(Number(value))}
                  onClick={() => onItem(item.key, { action: "set", value: Number(value), period, reason })}
                  className={BTN_SECONDARY}
                >
                  Save reading
                </button>
              </div>
              {item.scale.some((x) => x.meaning) && (
                <ul className="mt-2 text-xs text-ink-muted">
                  {item.scale.map((x) => (
                    <li key={x.point}>
                      {x.point}: {x.meaning}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <ScaleButtons
              scale={item.scale}
              selected={included ? d.point : null}
              proposed={s.proposal?.point}
              prior={item.prior?.point}
              disabled={busy}
              onPick={(pt) => onItem(item.key, { action: "set", point: pt, reason })}
            />
          )}

          <label className="mt-3 block text-xs font-medium text-ink-secondary">
            Reason {item.kind === "overall" ? "for your overall judgment" : ""}
            <NoteField
              value={reason}
              onChange={setReason}
              rows={2}
              className="mt-1 text-sm"
              onBlur={() => {
                if (included && reason.trim() !== (d.reason || "").trim()) void onItem(item.key, { action: "set", reason });
              }}
              placeholder={included ? "Why this judgment, in your words" : "Set a judgment first"}
              disabled={!included || busy}
            />
          </label>

          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{item.kind === "metric" ? "Latest reading on record" : "Prior judgment"}</p>
              {item.prior ? (
                <p className="mt-1 text-ink-body">
                  {describeJudgment(item, item.prior)} <span className="text-ink-muted">· {formatDay(item.prior.date)}</span>
                  {item.prior.reason && <span className="block text-ink-secondary">{item.prior.reason}</span>}
                  <span className="block text-xs text-ink-muted">
                    {item.kind === "metric"
                      ? "Only counts for this period if it was measured for this period."
                      : "Context only — not counted for this period unless you reaffirm it."}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-ink-muted">None recorded.</p>
              )}
            </div>
            <div>
              <p className={EYEBROW_AI}>AI proposal</p>
              {s.proposal ? (
                <div className="mt-1 text-ink-body">
                  <p>{describeJudgment(item, s.proposal)}</p>
                  {s.proposal.reason && <p className="text-ink-secondary">{s.proposal.reason}</p>}
                  {s.proposal.limitations && <p className="text-ink-secondary">Not established: {s.proposal.limitations}</p>}
                  <SourceChips ids={s.proposal.sources} lookup={lookup} managerContext={managerContext} />
                </div>
              ) : (
                <p className="mt-1 text-ink-muted">{s.unassessed_reason || "No proposal."}</p>
              )}
            </div>
          </div>
          {decisionSources && d.origin === "ai_revision" && (
            <SourceChips ids={decisionSources} lookup={lookup} managerContext={managerContext} label="Revision support:" />
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {differsFromProposal && s.proposal && (
              <button type="button" disabled={busy} onClick={() => onItem(item.key, { action: "accept_proposal" })} className={BTN_SECONDARY}>
                Use AI proposal
              </button>
            )}
            {item.prior && item.kind !== "metric" && d.origin !== "reaffirmed" && (
              <button type="button" disabled={busy} onClick={() => onItem(item.key, { action: "reaffirm_prior" })} className={BTN_SECONDARY}>
                Reaffirm prior for this period
              </button>
            )}
            {included && (
              <button type="button" disabled={busy} onClick={() => onItem(item.key, { action: "unassessed" })} className={BTN_SECONDARY}>
                Leave unassessed
              </button>
            )}
            <button type="button" onClick={onDiscuss} className={BTN_GHOST}>
              Discuss
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function DiscussionPanel({
  review,
  focusItem,
  busy,
  onClearFocus,
  onDiscuss,
  onItem,
  onReview,
  included,
}: {
  review: PeriodAssessment;
  focusItem: CatalogItem | null;
  busy: string | null;
  onClearFocus: () => void;
  onDiscuss: (message: string, itemKey: string | null) => Promise<unknown>;
  onItem: (key: string, body: ActionBody) => Promise<unknown>;
  onReview: () => void;
  included: number;
}) {
  const [message, setMessage] = useState("");
  const thread: ConversationMessage[] = (review.conversation || []).filter(
    (m) => !focusItem || m.item_key === focusItem.key,
  );
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: "nearest" }), [thread.length]);
  const byKey = new Map(review.catalog.map((c) => [c.key, c]));

  return (
    <aside aria-labelledby="discussion-title" className={`${PANEL} flex flex-col lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)]`}>
      <div className="flex items-start justify-between gap-2">
        <p id="discussion-title" className={EYEBROW_AI}>
          Discuss {focusItem ? focusItem.name : "the assessment"}
        </p>
        {focusItem && (
          <button type="button" onClick={onClearFocus} className="text-xs text-ink-muted hover:text-ink">
            Whole assessment
          </button>
        )}
      </div>
      <div className="mt-3 min-h-[6rem] flex-1 space-y-4 overflow-y-auto pr-1">
        {thread.length === 0 && (
          <p className="text-sm text-ink-secondary">
            Ask why a judgment landed where it did, push back, or add something the records missed. Suggested changes wait for you to apply them.
          </p>
        )}
        {thread.map((m) => (
          <div key={m.id}>
            <p className="text-sm font-semibold text-ink">{m.role === "manager" ? "You" : "AI"}</p>
            <p className={`mt-0.5 whitespace-pre-wrap text-[0.95rem] ${m.error ? "text-amber-700" : "text-ink-body"}`}>{m.text}</p>
            {(m.revision_keys || []).map((k) => {
              const c = byKey.get(k);
              const rv = c?.state.revision;
              if (!c) return null;
              return (
                <div key={k} className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-sm">
                  <p className="font-semibold text-blue-700">AI · proposed revision · {c.name}</p>
                  {rv ? (
                    <>
                      <p className="mt-1 text-ink-body">
                        {describeJudgment(c, rv)}
                        {rv.reason ? ` — ${rv.reason}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">Only this judgment and its reason change.</p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" disabled={!!busy} onClick={() => onItem(k, { action: "apply_revision" })} className={BTN_SECONDARY}>
                          Apply revision
                        </button>
                        <button type="button" disabled={!!busy} onClick={() => onItem(k, { action: "dismiss_revision" })} className={BTN_SECONDARY}>
                          Keep current
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-ink-muted">Resolved.</p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {busy === "discuss" && <p className="text-sm text-ink-muted" aria-live="polite">Thinking it through…</p>}
        <div ref={endRef} />
      </div>
      <form
        className="mt-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const text = message.trim();
          if (!text) return;
          const ok = await onDiscuss(text, focusItem?.key ?? null);
          if (ok) setMessage("");
        }}
      >
        <NoteField
          id="assessment-discussion-input"
          value={message}
          onChange={setMessage}
          rows={3}
          placeholder={focusItem ? `e.g. That overstates it — keep “With guidance”.` : "Ask about the draft, or add context"}
          aria-label="Message about this assessment"
          disabled={!!busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
          }}
        />
        <button type="submit" disabled={!!busy || !message.trim()} className={`${BTN_SECONDARY} mt-2`}>
          Send
        </button>
      </form>
      <div className="mt-5 border-t border-divider pt-4">
        <p className="text-sm text-ink-body">When the draft reflects your judgment:</p>
        <button type="button" onClick={onReview} disabled={!!busy || included === 0} className={`${BTN_PRIMARY} mt-2`}>
          {busy === "summary" ? "Preparing the review…" : "Review full assessment"}
        </button>
        {included === 0 && <p className="mt-2 text-xs text-ink-muted">Include at least one judgment first.</p>}
      </div>
    </aside>
  );
}
