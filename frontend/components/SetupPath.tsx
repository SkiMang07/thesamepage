"use client";

// Setup path on Mission Control (docs/design-proposals/2026-09-29-onboarding-path/).
//
// A manager is onboarded when five things are true: team and org set up, role
// expectations configured, knowledge imported (or nothing to import), an org
// goal and a team goal, and a first 1:1 logged. The server derives the five from
// real records (backend/routes/onboarding.py); this card only shows them. It
// renders nothing once the manager is onboarded, or when the status could not be
// read. Steps link to the surface that does the work; they can be done in any
// order once available. No AI is involved here.
//
// Voice: literal labels, no encouragement. Each step carries one line on what it
// changes, stated as a fact.

import { useState } from "react";
import Link from "next/link";
import { OnboardingStepKey, OnboardingSteps, setKnowledgeSkipped } from "@/lib/api";
import { EYEBROW } from "@/lib/tokens";
import { useZoneData } from "@/components/ZoneMap";

type StepView = {
  key: OnboardingStepKey;
  title: string;
  changes: string;
  href: string;
  done: boolean;
  blocked: boolean;
  status: string;
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function setupSteps(s: OnboardingSteps): StepView[] {
  const org = s.org;
  const exp = s.expectations;
  const kn = s.knowledge;
  const goals = s.goals;
  return [
    {
      key: "org",
      title: "Team and org",
      changes: "Puts each person in a team, so a prep sheet knows who they work alongside.",
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
      href: "/app/expectations",
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
      key: "knowledge",
      title: "Knowledge",
      changes: "Lets the sheet quote your strategy, values and customer research.",
      href: "/app/context",
      done: kn.done,
      blocked: false,
      status: kn.skipped
        ? "Nothing to import"
        : kn.confirmed_documents > 0
          ? `${plural(kn.confirmed_documents, "document", "documents")} confirmed`
          : "None imported",
    },
    {
      key: "goals",
      title: "Org and team goals",
      changes: "Links each person’s work to the goals it serves.",
      href: "/app/goals",
      done: goals.done,
      blocked: false,
      status: goals.done
        ? "Done"
        : !goals.has_org_goal && !goals.has_team_goal
          ? "No org or team goal"
          : !goals.has_org_goal
            ? "Org goal missing"
            : "Team goal missing",
    },
    {
      key: "log",
      title: "Log a 1:1",
      changes: "The first conversation on the record. Everything after it builds on that.",
      href: "/app/1-1s",
      done: s.log.done,
      blocked: false,
      status: s.log.done ? "Done" : "Not logged",
    },
  ];
}

export default function SetupPath() {
  const { onboarding } = useZoneData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!onboarding || onboarding.onboarded || !onboarding.steps) return null;
  const steps = setupSteps(onboarding.steps);
  const skipped = onboarding.steps.knowledge.skipped;

  async function toggleSkipped(next: boolean) {
    setBusy(true);
    setError("");
    try {
      await setKnowledgeSkipped(next);
    } catch {
      setError("Couldn’t save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="setup" aria-labelledby="setup-heading" className="mb-8 scroll-mt-20 rounded-xl border border-hairline bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className={EYEBROW}>Setup</p>
          <h2 id="setup-heading" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
            {onboarding.done_count} of {onboarding.total} done
          </h2>
        </div>
        <p className="text-xs text-ink-muted">Assessments opens when all five are done.</p>
      </div>

      <ol className="mt-4 divide-y divide-hairline">
        {steps.map((step, i) => {
          const row = (
            <>
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                  step.done ? "border-brand bg-brand text-on-brand" : "border-control text-ink-muted"
                }`}
              >
                {step.done ? "✓" : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-ink">{step.title}</span>
                <span className="block text-[13px] text-ink-secondary">{step.changes}</span>
              </span>
              <span className={`shrink-0 pl-3 text-xs ${step.done ? "text-brand" : "text-ink-muted"}`}>
                <span className="sr-only">{step.title}: </span>
                {step.status}
              </span>
            </>
          );
          return (
            <li key={step.key} className="py-3.5 first:pt-0 last:pb-0">
              {step.blocked ? (
                <div className="flex items-start gap-3 opacity-60">{row}</div>
              ) : (
                <Link href={step.href} className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-1 transition hover:bg-sunken">
                  {row}
                </Link>
              )}
              {step.key === "knowledge" && !step.blocked && (
                <div className="ml-9 mt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggleSkipped(!skipped)}
                    className="text-xs text-brand hover:text-brand-hover disabled:opacity-50"
                  >
                    {skipped ? "Undo: I do have documents to import" : "Nothing to import"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {error && <p className="mt-3 text-xs text-red-700" role="alert">{error}</p>}
    </section>
  );
}
