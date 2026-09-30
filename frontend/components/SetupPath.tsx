"use client";

// Setup card on Mission Control (docs/design-proposals/2026-09-29-onboarding-path/
// SETUP_MODE_BRIEF.md). Setup is three things: team and org, role expectations,
// and goals. The server derives them from real records
// (backend/routes/onboarding.py); this card only shows them. It renders nothing
// once the manager is set up, or when the status could not be read.
//
// One step is highlighted at a time (the server's next_step), with what it
// changes and a time estimate. The rest collapse to a line each. A step that is
// waiting on another shows locked with the reason. Opening a step from here
// reports the step name and whether it was the highlighted one, nothing else.
// No AI is involved here.
//
// Chunk C: the expectations step names whose role to set next (the person whose
// 1:1 is soonest, from the server's queue) and, when they have no role yet, sends
// to picking one. The goals step opens the org-goals modal (paste or attach,
// review, save) instead of a page. "Don't know yet" is a recorded answer that
// parks that step: it reads "Waiting on your boss" and is not highlighted, but it
// is not done.
//
// Chunk D (docs/design-proposals/2026-09-29-onboarding-path/CHUNK_D_PLAN.md):
// the card's volume comes from the server (card.level). Full is the card below;
// quiet is one line with the next step; hidden draws nothing. "Not now" snoozes
// it for longer each time, and the header chip (which never fades) or "All
// steps" brings the full card back for the visit. This component also owns the
// entry modal (shown once, before the card) and the completion modal (shown
// once when setup finishes), and opens the org-goals modal when Mission Control
// is reached with ?setup=goals (the ranker's way back to that step).
//
// Voice: literal labels, no encouragement. Each step carries one line on what it
// changes, stated as a fact.

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import NotesDumpModal from "@/components/NotesDumpModal";
import OrgGoalsModal from "@/components/OrgGoalsModal";
import SetupCompleteModal from "@/components/SetupCompleteModal";
import SetupIntroModal from "@/components/SetupIntroModal";
import { formatDay } from "@/components/expectations/shared";
import {
  ExpectationQueueEntry,
  OnboardingStepKey,
  OnboardingSteps,
  SETUP_REVEAL_EVENT,
  dismissSetupCard,
  markSetupIntroSeen,
  reportSetupStepStarted,
} from "@/lib/api";
import { BTN_GHOST, BTN_PRIMARY_SM, BTN_SECONDARY, EYEBROW } from "@/lib/tokens";
import { useZoneData } from "@/components/ZoneMap";

type StepView = {
  key: OnboardingStepKey;
  title: string;
  changes: string;
  time: string;
  action: string;
  href: string;
  // The action opens the org-goals modal instead of a page.
  modal?: boolean;
  // A second line under the highlighted step: what comes first, and what is next.
  detail?: string;
  done: boolean;
  blocked: boolean;
  status: string;
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function first(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

// Who to set expectations for next. The person whose 1:1 is soonest first; a
// person with no role is listed as themselves and the action is picking a role.
function expectationsAction(next: ExpectationQueueEntry | null | undefined, rest: ExpectationQueueEntry[]) {
  if (!next) return { action: "Set expectations", href: "/app/expectations", detail: undefined };
  const when = next.next_1on1_on ? ` Your 1:1 with ${first(next.person_name)} is ${formatDay(next.next_1on1_on)}.` : "";
  const then = rest.length
    ? ` After this: ${rest
        .slice(0, 3)
        .map((r) => r.role_label ?? `a role for ${first(r.person_name)}`)
        .join(", ")}${rest.length > 3 ? `, and ${rest.length - 3} more` : ""}.`
    : "";
  if (!next.role_level_id) {
    return {
      action: `Pick a role for ${first(next.person_name)}`,
      href: `/app/expectations/new?assign=${next.report_id}`,
      detail: `${first(next.person_name)} has no role yet.${when}${then}`,
    };
  }
  return {
    action: `Set expectations for ${next.role_label ?? "this role"}`,
    href: `/app/expectations/${next.role_level_id}`,
    detail: `${next.role_label ?? "This role"} is ${first(next.person_name)}’s.${when}${then}`,
  };
}

export function setupSteps(s: OnboardingSteps): StepView[] {
  const org = s.org;
  const exp = s.expectations;
  const goals = s.goals;
  const queue = exp.queue ?? [];
  const nextRole = exp.next_role ?? queue[0] ?? null;
  const expAction = expectationsAction(nextRole, queue.filter((q) => q !== nextRole && q.report_id !== nextRole?.report_id));
  return [
    {
      key: "org",
      title: "Team and org",
      changes: "Puts each person in a team, so a prep sheet knows who they work alongside.",
      time: "About 3 minutes",
      action: "Set up team and org",
      href: "/app/org",
      done: org.done,
      blocked: false,
      status: org.done
        ? "Done"
        : org.people === 0
          ? "No direct reports yet"
          : org.units === 0
            ? "No teams yet"
            : `${plural(org.people_without_team, "person", "people")} not in a team`,
    },
    {
      key: "expectations",
      title: "Role expectations",
      changes: "Gives the sheet a standard to hold each person’s work against.",
      time: "About 2 minutes per role",
      action: expAction.action,
      href: expAction.href,
      detail: expAction.detail,
      done: exp.done,
      blocked: exp.blocked,
      status: exp.done
        ? "Done"
        : exp.blocked
          ? "Needs team and org"
          : exp.people_without_role > 0
            ? `${plural(exp.people_without_role, "person", "people")} without a role`
            : `${exp.roles_covered} of ${plural(exp.roles_in_use, "role", "roles")} have expectations`,
    },
    {
      key: "goals",
      title: "Org and team goals",
      changes: "Links each person’s work to the goals it serves.",
      time: "About 3 minutes",
      action: goals.has_org_goal ? "Write a team goal" : "Add company or department goals",
      href: "/app/goals",
      modal: !goals.has_org_goal,
      detail: !goals.has_org_goal && !goals.has_team_goal ? "A team goal is yours to write. Add it on the Goals page." : undefined,
      done: goals.done,
      blocked: false,
      status: goals.done
        ? "Done"
        : goals.parked
          ? "Waiting on your boss"
          : !goals.has_org_goal && !goals.has_team_goal
            ? goals.unknown
              ? "Company goals not known yet · no team goal"
              : "No org or team goal"
            : !goals.has_org_goal
              ? "Org goal missing"
              : "Team goal missing",
    },
  ];
}

// Opens the org-goals modal when Mission Control is reached with ?setup=goals,
// then clears the param. Its own component because useSearchParams needs a
// Suspense boundary.
function SetupParamOpener({ onGoals }: { onGoals: () => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const wanted = params.get("setup");
  useEffect(() => {
    if (wanted === "goals") {
      onGoals();
      router.replace("/app/dashboard", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  return null;
}

export default function SetupPath() {
  const { onboarding } = useZoneData();
  const router = useRouter();
  const [dumpOpen, setDumpOpen] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [introClosed, setIntroClosed] = useState(false);
  const [receiptClosed, setReceiptClosed] = useState(false);
  // The header chip or "All steps" brings the full card back for this visit.
  const [revealed, setRevealed] = useState(false);
  // "Not now" hides the card at once; the server's snooze takes over on refresh.
  const [hiddenNow, setHiddenNow] = useState(false);
  const dismissals = onboarding?.card?.dismissals ?? 0;

  useEffect(() => {
    setHiddenNow(false);
  }, [dismissals]);

  useEffect(() => {
    function reveal() {
      setRevealed(true);
      window.setTimeout(() => document.getElementById("setup")?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
    }
    if (window.location.hash === "#setup") setRevealed(true);
    window.addEventListener(SETUP_REVEAL_EVENT, reveal);
    return () => window.removeEventListener(SETUP_REVEAL_EVENT, reveal);
  }, []);

  if (!onboarding) return null;

  // Setup is done: the completion modal, once, and nothing else.
  if (onboarding.set_up) {
    return onboarding.receipt_pending && !receiptClosed ? <SetupCompleteModal onClose={() => setReceiptClosed(true)} /> : null;
  }
  if (!onboarding.steps) return null;

  const steps = setupSteps(onboarding.steps);
  const nextKey = onboarding.next_step;
  const level = revealed ? "full" : hiddenNow ? "hidden" : (onboarding.card?.level ?? "full");
  const introOpen = !!onboarding.intro_pending && !introClosed;
  const startStep = steps.find((st) => st.key === nextKey) ?? steps.find((st) => !st.done && !st.blocked) ?? steps[0];

  function opened(step: StepView) {
    void reportSetupStepStarted(step.key, step.key === nextKey);
  }

  function openStep(step: StepView) {
    opened(step);
    if (step.modal) setGoalsOpen(true);
    else router.push(step.href);
  }

  function notNow() {
    setRevealed(false);
    setHiddenNow(true);
    void dismissSetupCard();
  }

  const overlays = (
    <>
      <Suspense fallback={null}>
        <SetupParamOpener onGoals={() => setGoalsOpen(true)} />
      </Suspense>
      {introOpen && (
        <SetupIntroModal
          parts={steps.map((st) => ({ title: st.title, changes: st.changes }))}
          startLabel={startStep.action}
          onStart={() => {
            setIntroClosed(true);
            void markSetupIntroSeen("started");
            openStep(startStep);
          }}
          onLater={() => {
            setIntroClosed(true);
            void markSetupIntroSeen("later");
          }}
        />
      )}
      {dumpOpen && <NotesDumpModal onClose={() => setDumpOpen(false)} />}
      {goalsOpen && <OrgGoalsModal onClose={() => setGoalsOpen(false)} />}
    </>
  );

  if (level === "hidden") return overlays;

  if (level === "quiet") {
    const next = steps.find((st) => st.key === nextKey) ?? null;
    const waiting = steps.find((st) => !st.done);
    return (
      <>
        <section
          id="setup"
          aria-label="Setup"
          className="mb-6 flex scroll-mt-20 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-hairline bg-surface px-4 py-3"
        >
          <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">
            <span className="font-medium text-ink">
              Setup, {onboarding.done_count} of {onboarding.total} done.
            </span>{" "}
            {next ? `Next: ${next.title}.` : waiting ? `${waiting.title}: ${waiting.status.charAt(0).toLowerCase()}${waiting.status.slice(1)}.` : ""}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {next && (
              <button type="button" onClick={() => openStep(next)} className={BTN_PRIMARY_SM}>
                {next.action}
              </button>
            )}
            <button type="button" onClick={() => setRevealed(true)} className={BTN_GHOST}>
              All steps
            </button>
            <button type="button" onClick={notNow} className={BTN_GHOST}>
              Not now
            </button>
          </div>
        </section>
        {overlays}
      </>
    );
  }

  return (
    <>
      <section id="setup" aria-labelledby="setup-heading" className="mb-8 scroll-mt-20 rounded-xl border border-hairline bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className={EYEBROW}>Setup</p>
            <h2 id="setup-heading" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
              {onboarding.done_count} of {onboarding.total} done
            </h2>
          </div>
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <span>Setup ends when all {onboarding.total} are done.</span>
            <button type="button" onClick={notNow} className="rounded px-1.5 py-0.5 font-medium text-ink-secondary hover:bg-sunken hover:text-ink">
              Not now
            </button>
          </p>
        </div>

        <ol className="mt-4 divide-y divide-hairline">
          {steps.map((step, i) => {
            const isNext = step.key === nextKey;
            const marker = (
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                  step.done ? "border-brand bg-brand text-on-brand" : isNext ? "border-brand text-brand" : "border-control text-ink-muted"
                }`}
              >
                {step.done ? "✓" : i + 1}
              </span>
            );

            if (isNext) {
              return (
                <li key={step.key} className="py-3.5 first:pt-0 last:pb-0" aria-current="step">
                  <div className="flex items-start gap-3">
                    {marker}
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium text-ink">{step.title}</p>
                      <p className="text-[13px] text-ink-secondary">{step.changes}</p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {step.time} · {step.status}
                      </p>
                      {step.detail && <p className="mt-1 text-[13px] text-ink-secondary">{step.detail}</p>}
                      {step.modal ? (
                        <button
                          type="button"
                          onClick={() => {
                            opened(step);
                            setGoalsOpen(true);
                          }}
                          className={`${BTN_PRIMARY_SM} mt-3 inline-flex`}
                        >
                          {step.action}
                        </button>
                      ) : (
                        <Link href={step.href} onClick={() => opened(step)} className={`${BTN_PRIMARY_SM} mt-3 inline-flex`}>
                          {step.action}
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            }

            const row = (
              <>
                {marker}
                <span className="min-w-0 flex-1 text-[14px] text-ink-body">{step.title}</span>
                <span className={`shrink-0 pl-3 text-xs ${step.done ? "text-brand" : "text-ink-muted"}`}>
                  <span className="sr-only">{step.title}: </span>
                  {step.status}
                </span>
              </>
            );
            return (
              <li key={step.key} className="py-3 first:pt-0 last:pb-0">
                {step.blocked || step.done ? (
                  <div className={`flex items-start gap-3 ${step.blocked ? "opacity-60" : ""}`}>{row}</div>
                ) : step.modal ? (
                  <button
                    type="button"
                    onClick={() => {
                      opened(step);
                      setGoalsOpen(true);
                    }}
                    className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-lg px-2 py-1 text-left transition hover:bg-sunken"
                  >
                    {row}
                  </button>
                ) : (
                  <Link
                    href={step.href}
                    onClick={() => opened(step)}
                    className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-1 transition hover:bg-sunken"
                  >
                    {row}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
          <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">
            Have notes, a doc or a list already? Add them and the drafts fill in what they cover. Optional.
          </p>
          <button type="button" onClick={() => setDumpOpen(true)} className={`${BTN_SECONDARY} shrink-0`}>
            Add what you already have
          </button>
        </div>
      </section>
      {overlays}
    </>
  );
}
