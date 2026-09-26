"use client";

// Review and approval: the complete content that will become the active
// standard, every unresolved detail with its way back, and one approval for
// the whole role. Unused AI suggestions are not part of it.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiError, RoleQuestion, RoleWorkspace, approveRoleDraft, deferRoleQuestion, getRoleWorkspace, saveRoleDraft } from "@/lib/api";
import PageShell from "@/components/PageShell";
import { SkeletonSection } from "@/components/Skeleton";
import RoleDocument from "@/components/expectations/RoleDocument";
import { FollowUpPicker, Notice, formatDay } from "@/components/expectations/shared";
import { BTN_GHOST, BTN_PRIMARY, CARD, EYEBROW } from "@/lib/tokens";

export default function ReviewPage() {
  const { roleLevelId } = useParams<{ roleLevelId: string }>();
  const router = useRouter();
  const [ws, setWs] = useState<RoleWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getRoleWorkspace(roleLevelId)
      .then((w) => {
        if (!w.draft) {
          router.replace(`/app/expectations/${roleLevelId}`);
          return;
        }
        setWs(w);
      })
      .catch(() => setError("This role couldn’t be loaded. Try again in a moment."));
  }, [roleLevelId, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (!ws?.draft) {
    return (
      <PageShell maxWidth="6xl">
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : (
          <SkeletonSection label="Loading review" variant="list" />
        )}
      </PageShell>
    );
  }
  const draft = ws.draft;
  const base = `/app/expectations/${roleLevelId}`;
  const open = draft.questions.filter((q) => q.status === "open");
  const parked = draft.questions.filter((q) => q.status === "deferred");
  const pending = draft.suggestions.filter((s) => s.status === "pending").length;
  const revision = draft.kind === "revision" && ws.approved_items.length > 0;
  const titleOf = (key: string | null) => (key ? draft.items.find((i) => i.key === key)?.title : undefined);

  async function run(fn: () => Promise<RoleWorkspace>) {
    setBusy(true);
    setError(null);
    setProblems([]);
    try {
      const next = await fn();
      setWs(next);
      setAck(false);
    } catch (e) {
      setError(e instanceof ApiError && e.status < 500 ? e.detail : "That couldn’t be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function dismiss(q: RoleQuestion) {
    return run(() => saveRoleDraft(draft.id, { version: draft.version, items: draft.items, questions: [{ id: q.id, answer: q.answer, status: "dismissed" }] }));
  }

  async function approve() {
    if (!ack) {
      setError("Confirm that you’ve reviewed these expectations.");
      return;
    }
    setBusy(true);
    setError(null);
    setProblems([]);
    try {
      const out = await approveRoleDraft(draft.id, draft.version);
      router.push(`/app/expectations?notice=${out.open_decisions.length ? "approved-open" : "approved"}`);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.status === 409 ? e.detail : e.status < 500 ? e.detail : "Approval didn’t go through, and nothing was changed. Try again.");
        setProblems(e.problems);
      } else setError("Approval didn’t go through, and nothing was changed. Try again.");
      setBusy(false);
    }
  }

  return (
    <PageShell maxWidth="7xl">
      <Link href={base} className="text-sm text-ink-secondary hover:text-ink">
        ← Back to editing
      </Link>
      <p className={`${EYEBROW} mt-5`}>
        {ws.role.title} · Level {ws.role.job_level}
      </p>
      <h1 className="mt-1.5 font-serif text-[2.2rem] font-normal leading-tight tracking-[-0.02em] text-ink sm:text-[2.5rem]">Ready to put into practice?</h1>
      <p className="mt-1.5 text-sm text-ink-secondary">Review the expectations your coaching and assessments will use.</p>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,1fr)]">
        <RoleDocument
          items={draft.items}
          orgValues={ws.org_values}
          editHref={(item) => `${base}?focus=${encodeURIComponent(`item:${item.key}`)}`}
          openTargets={new Set(parked.filter((q) => q.topic === "target").map((q) => q.item_key || ""))}
        />
        <aside className="space-y-5">
          {open.length > 0 && (
            <section className="rounded-xl bg-amber-50 p-5" aria-labelledby="open-heading">
              <h2 id="open-heading" className="text-base font-semibold text-amber-800">
                {open.length === 1 ? "One detail needs a decision" : `${open.length} details need a decision`}
              </h2>
              <ul className="mt-2 space-y-4">
                {open.map((q) => (
                  <li key={q.id} className="border-t border-amber-500/25 pt-3 first:border-t-0 first:pt-0">
                    {titleOf(q.item_key) && <p className="text-[11px] font-medium uppercase tracking-wide text-amber-800">{titleOf(q.item_key)}</p>}
                    <p className="text-sm font-medium text-ink">{q.question}</p>
                    {q.topic === "target" ? (
                      <p className="mt-1 text-sm text-ink-body">
                        The responsibility can be used now. A numerical result won’t be evaluated until a target is defined and approved.
                      </p>
                    ) : null}
                    <div className="mt-2">
                      <FollowUpPicker busy={busy} label="Bring this back" onChoose={(d) => run(() => deferRoleQuestion(draft.id, draft.version, q.id, d))} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-sm">
                      <Link href={`${base}?focus=${encodeURIComponent(q.id)}`} className="font-medium text-brand hover:text-brand-hover">
                        {q.topic === "target" ? "Set the target" : "Answer it"}
                      </Link>
                      {q.topic !== "target" && (
                        <button type="button" disabled={busy} onClick={() => dismiss(q)} className="text-ink-secondary hover:text-ink">
                          Not needed
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {parked.length > 0 && (
            <section className={`${CARD} p-5`} aria-labelledby="parked-heading">
              <h2 id="parked-heading" className="text-sm font-semibold text-ink">
                Coming back to
              </h2>
              <ul className="mt-2 space-y-2.5">
                {parked.map((q) => (
                  <li key={q.id} className="text-sm">
                    <p className="text-ink">{q.question}</p>
                    <p className="text-xs text-amber-700">
                      Back {formatDay(q.follow_up_on)} · stays in Needs review{q.topic === "target" ? " · not evaluated until set" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className={`${CARD} p-5`}>
            <h2 className="text-sm font-semibold text-ink">After approval</h2>
            <p className="mt-1 text-sm text-ink-secondary">Used in 1:1 preparation, development and assessments for this role and level.</p>
            <p className="mt-2 text-sm text-ink-secondary">
              {revision
                ? "Until then, the currently approved expectations stay in use. Completed assessments keep the standard they were judged against."
                : "Future changes go through review before replacing these expectations."}
            </p>
            {pending > 0 && (
              <p className="mt-2 text-sm text-ink-secondary">
                {pending} AI suggestion{pending === 1 ? " isn’t" : "s aren’t"} part of this — only what you see here is approved.
              </p>
            )}
          </section>
        </aside>
      </div>

      <div className="mt-6 border-t border-hairline pt-5">
        {error && (
          <div className="mb-3">
            <Notice tone="red">
              {error}
              {problems.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
            </Notice>
          </div>
        )}
        <label className="flex items-start gap-2.5 text-sm text-ink">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
          <span>
            I’ve reviewed these expectations
            {parked.some((q) => q.topic === "target") || open.some((q) => q.topic === "target") ? ", including the targets that aren’t set yet" : ""}.
          </span>
        </label>
        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/app/expectations?notice=saved" className={`${BTN_GHOST} self-start`}>
            Save &amp; finish later
          </Link>
          <button type="button" onClick={approve} disabled={busy} className={`${BTN_PRIMARY} self-start sm:self-auto`}>
            {busy ? "Approving…" : revision ? "Approve revision" : "Approve expectations"}
          </button>
        </div>
      </div>
    </PageShell>
  );
}
