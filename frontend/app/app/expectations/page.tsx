"use client";

// Roles & expectations — overview. What good looks like for every role and
// level: Needs review leads when something is actionable (an unapproved
// draft, a revision awaiting approval, an approved role whose open detail has
// come due); ladders group their levels with who holds them; company values
// are defined once. Design: docs/design-proposals/2026-09-26-role-expectations/.
// Behaviour: docs/systems/expectations.md.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RoleFamily,
  RoleLevel,
  RolesOverview,
  RolesOverviewLevel,
  RolesReviewItem,
  getRoleFamilies,
  getRoleLevels,
  getRolesOverview,
} from "@/lib/api";
import PageShell from "@/components/PageShell";
import { SkeletonSection } from "@/components/Skeleton";
import LadderManager from "@/components/expectations/LadderManager";
import CompanyValues from "@/components/expectations/CompanyValues";
import { Notice, formatDay } from "@/components/expectations/shared";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, EYEBROW } from "@/lib/tokens";

export default function ExpectationsPage() {
  return (
    <Suspense>
      <ExpectationsOverview />
    </Suspense>
  );
}

function reviewHref(item: RolesReviewItem) {
  const focus = item.focus ? `?focus=${encodeURIComponent(item.focus)}` : "";
  return `/app/expectations/${item.role_level_id}${focus}`;
}

function ExpectationsOverview() {
  const router = useRouter();
  const params = useSearchParams();
  const [data, setData] = useState<RolesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [roleLevels, setRoleLevels] = useState<RoleLevel[]>([]);
  const [roleFamilies, setRoleFamilies] = useState<RoleFamily[]>([]);
  const [manageError, setManageError] = useState<string | null>(null);
  const notice = params.get("notice");

  const load = useCallback(() => {
    getRolesOverview()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch(() => setError("Roles couldn’t be loaded. This is a connection problem, not an empty workspace."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!managing) return;
    Promise.all([getRoleLevels(), getRoleFamilies()])
      .then(([rls, rfs]) => {
        setRoleLevels(rls);
        setRoleFamilies(rfs);
      })
      .catch(() => setManageError("Ladders couldn’t be loaded."));
  }, [managing]);

  const groups = useMemo(() => {
    if (!data) return [];
    const byFamily = new Map<string | null, RolesOverviewLevel[]>();
    for (const l of data.levels) {
      const k = l.role_family_id;
      byFamily.set(k, [...(byFamily.get(k) ?? []), l]);
    }
    const out: { family: RoleFamily | null; levels: RolesOverviewLevel[] }[] = data.families.map((f) => ({
      family: f,
      levels: (byFamily.get(f.id) ?? []).sort((a, b) => a.job_level - b.job_level),
    }));
    const ungrouped = byFamily.get(null) ?? [];
    if (ungrouped.length) out.push({ family: null, levels: ungrouped });
    return out;
  }, [data]);

  const noticeText =
    notice === "approved"
      ? "Expectations approved. They’re now used in 1:1 preparation, development and assessments."
      : notice === "approved-open"
        ? "Expectations approved. The open detail stays listed here until it’s resolved."
        : notice === "saved"
          ? "Draft saved. Pick it up from Needs review whenever you’re ready."
          : notice === "discarded"
            ? "Draft discarded. Approved expectations were not changed."
            : null;

  const totalLevels = data?.levels.length ?? 0;
  const ladderCount = data ? data.families.length + (data.levels.some((l) => !l.role_family_id) ? 1 : 0) : 0;

  return (
    <PageShell maxWidth="6xl">
      {noticeText && (
        <div className="mb-5">
          <Notice onClose={() => router.replace("/app/expectations", { scroll: false })}>{noticeText}</Notice>
        </div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={EYEBROW}>Your team’s foundation</p>
          <h1 className="mt-1.5 font-serif text-[2.4rem] font-normal leading-none tracking-[-0.03em] text-ink sm:text-[2.8rem]">
            What good looks like.
          </h1>
          <p className="mt-2.5 max-w-2xl text-sm text-ink-secondary">
            Clear expectations for every role, at every level — the standard your coaching, 1:1s, development and assessments work from.
          </p>
        </div>
        <Link href="/app/expectations/new" className={`${BTN_PRIMARY} shrink-0 self-start sm:self-auto`}>
          + Define a role
        </Link>
      </div>

      {error && (
        <p role="alert" className="mt-5 text-sm text-red-700">
          {error}{" "}
          <button type="button" onClick={load} className="underline">
            Try again
          </button>
        </p>
      )}

      {!data && !error && <SkeletonSection label="Loading roles" variant="list" className="mt-6" />}

      {data && (
        <div className="mt-6 space-y-5">
          {data.needs_review.length > 0 && (
            <section className="rounded-xl bg-amber-50 p-5" aria-labelledby="needs-review-heading">
              <h2 id="needs-review-heading" className="text-base font-semibold text-amber-800">
                Needs review
              </h2>
              <ul className="mt-1">
                {data.needs_review.map((item) => (
                  <li
                    key={`${item.type}-${item.decision_id ?? item.role_level_id}`}
                    className="flex flex-col gap-3 border-t border-amber-500/25 py-3.5 first:border-t-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{item.label}</p>
                      <p className="mt-0.5 text-sm text-amber-800">
                        <span className="font-medium">{item.kind_label}</span>
                        {item.detail ? ` · ${item.detail}` : ""}
                        {item.type === "decision" && item.follow_up_on ? ` · due ${formatDay(item.follow_up_on)}` : ""}
                      </p>
                    </div>
                    <Link href={reviewHref(item)} className={`${BTN_SECONDARY} shrink-0 self-start bg-surface sm:self-auto`}>
                      {item.type === "decision" ? "Resolve" : item.type === "revision" ? "Continue revision" : "Continue draft"} →
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.coming_back.length > 0 && (
            <section className={`${CARD} p-5`} aria-labelledby="coming-back-heading">
              <h2 id="coming-back-heading" className="text-sm font-semibold text-ink">
                Coming back later
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">Approved roles with a detail you chose to revisit. They return to Needs review on their date.</p>
              <ul className="mt-2">
                {data.coming_back.map((item) => (
                  <li key={item.decision_id} className="flex flex-col gap-2 border-t border-divider py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{item.label}</p>
                      <p className="text-sm text-ink-secondary">
                        {item.detail} · back {formatDay(item.follow_up_on)}
                      </p>
                    </div>
                    <Link href={reviewHref(item)} className="shrink-0 text-sm font-medium text-brand hover:text-brand-hover">
                      Resolve now →
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {totalLevels === 0 && data.families.length === 0 && !managing ? (
            <FirstUse onManage={() => setManaging(true)} managing={managing} />
          ) : (
            <section className={`${CARD} p-5`} aria-labelledby="ladders-heading">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="ladders-heading" className="text-base font-semibold text-ink">
                  Roles &amp; ladders
                </h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-muted">
                    {ladderCount} ladder{ladderCount === 1 ? "" : "s"} · {totalLevels} level{totalLevels === 1 ? "" : "s"}
                  </span>
                  <button type="button" onClick={() => setManaging((m) => !m)} aria-expanded={managing} className="text-sm font-medium text-brand hover:text-brand-hover">
                    {managing ? "Done managing" : "Manage ladders"}
                  </button>
                </div>
              </div>
              {managing ? (
                <div className="mt-4">
                  {manageError && <p className="mb-3 text-sm text-red-700">{manageError}</p>}
                  <LadderManager
                    roleLevels={roleLevels}
                    setRoleLevels={setRoleLevels}
                    roleFamilies={roleFamilies}
                    setRoleFamilies={setRoleFamilies}
                    onChanged={load}
                    onError={setManageError}
                  />
                </div>
              ) : (
                <div className="mt-2">
                  {groups.map((g) => (
                    <details key={g.family?.id ?? "ungrouped"} open className="group border-t border-divider first:border-t-0">
                      <summary className="flex cursor-pointer items-center justify-between gap-3 py-3.5 font-medium text-ink">
                        <span>
                          {g.family?.name ?? "Not on a ladder"}
                          <span className="ml-2 text-xs font-normal text-ink-muted">
                            {g.levels.length} level{g.levels.length === 1 ? "" : "s"}
                          </span>
                        </span>
                        <span aria-hidden className="text-xs text-ink-muted transition group-open:rotate-180">
                          ▾
                        </span>
                      </summary>
                      {g.levels.length === 0 ? (
                        <p className="pb-4 pl-4 text-sm text-ink-muted">
                          No levels yet —{" "}
                          <Link href={`/app/expectations/new?family=${g.family?.id}`} className="font-medium text-brand hover:text-brand-hover">
                            define one from a job description
                          </Link>
                          .
                        </p>
                      ) : (
                        <ul>
                          {g.levels.map((l) => (
                            <LevelRow key={l.role_level_id} level={l} />
                          ))}
                        </ul>
                      )}
                    </details>
                  ))}
                </div>
              )}
            </section>
          )}

          <CompanyValues values={data.org_values} onChanged={load} />

          <p className="pb-2 text-sm text-ink-muted">
            Approved expectations stay connected to 1:1 preparation, development and assessments. Changes go through review before they replace them.
          </p>
        </div>
      )}
    </PageShell>
  );
}

function LevelRow({ level }: { level: RolesOverviewLevel }) {
  const people = level.people.map((p) => p.name).join(", ") || "No one assigned";
  const href = `/app/expectations/${level.role_level_id}`;
  const openDecision = level.open_decisions.find((d) => d.approved);
  let status: string;
  let action: React.ReactNode;
  if (level.status === "draft") {
    status = "Draft in progress · not yet approved";
    action = (
      <Link href={href} className={BTN_SECONDARY}>
        Continue draft →
      </Link>
    );
  } else if (level.status === "revision") {
    status = "Approved expectations in use · revision in progress";
    action = (
      <Link href={href} className={BTN_SECONDARY}>
        Continue revision →
      </Link>
    );
  } else if (level.status === "approved") {
    const c = level.counts;
    const parts = [
      c.responsibilities ? `${c.responsibilities} responsibilit${c.responsibilities === 1 ? "y" : "ies"}` : null,
      c.skills ? `${c.skills} skill${c.skills === 1 ? "" : "s"}` : null,
      c.values ? `${c.values} role value${c.values === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    status = `Approved expectations${level.approved_at ? ` · ${formatDay(level.approved_at)}` : ""}${parts.length ? ` · ${parts.join(", ")}` : ""}`;
    if (openDecision) status += ` · ${openDecision.topic === "target" ? "target" : "detail"} open until ${formatDay(openDecision.follow_up_on)}`;
    action = (
      <span className="flex items-center gap-3">
        <span className="rounded bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand">✓ In use</span>
        <Link href={href} className="text-sm font-medium text-brand hover:text-brand-hover">
          View &amp; refine →
        </Link>
      </span>
    );
  } else {
    status = "No expectations yet";
    action = (
      <Link href={href} className="text-sm font-medium text-brand hover:text-brand-hover">
        Define expectations →
      </Link>
    );
  }
  return (
    <li className="flex flex-col gap-2 border-t border-divider py-3.5 pl-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          Level {level.job_level} · {level.job_role}
        </p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {people} · {status}
        </p>
      </div>
      <div className="shrink-0">{action}</div>
    </li>
  );
}

function FirstUse({ onManage, managing }: { onManage: () => void; managing: boolean }) {
  return (
    <section className={`${CARD} p-6 sm:p-8`}>
      <h2 className="font-serif text-2xl font-normal text-ink">Start with one role.</h2>
      <p className="mt-2 max-w-2xl text-sm text-ink-secondary">
        Paste or upload a job description. You’ll get a first draft in plain language — what the role owns, what good looks like, the skills it takes — and a few focused questions where the description leaves something open. Nothing is used until you approve it.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link href="/app/expectations/new" className={BTN_PRIMARY}>
          Define a role from a job description
        </Link>
        {!managing && (
          <button type="button" onClick={onManage} className="text-sm font-medium text-ink-secondary hover:text-ink">
            Or set up a ladder by hand
          </button>
        )}
      </div>
    </section>
  );
}
