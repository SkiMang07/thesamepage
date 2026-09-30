"use client";

// Entry modal for setup mode (docs/design-proposals/2026-09-29-onboarding-path/
// CHUNK_D_PLAN.md): what setup is and why, shown once, on the first Mission
// Control load after the first prep sheet. Fixed copy, no AI. It offers the
// next step or "Later"; either closes it for good (the server stamps it), and
// the setup card is there afterwards.
//
// Voice: literal labels, no cheer. One line per part on what it changes.

import { useEffect, useRef } from "react";
import { FIRST_RUN_STEPS, PATH_STEPS } from "@/lib/api";
import { BTN_GHOST, BTN_PRIMARY, EYEBROW } from "@/lib/tokens";

export type SetupIntroPart = { title: string; changes: string };

export default function SetupIntroModal({
  parts,
  startLabel,
  onStart,
  onLater,
}: {
  parts: SetupIntroPart[];
  startLabel: string;
  onStart: () => void;
  onLater: () => void;
}) {
  const startRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    startRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onLater();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onLater]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-10" onClick={onLater}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-intro-title"
        className="w-full max-w-lg rounded-xl border border-hairline bg-surface p-5 shadow-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p className={EYEBROW}>Setup</p>
        <h2 id="setup-intro-title" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
          Steps {FIRST_RUN_STEPS + 1} to {PATH_STEPS}: three things for the next sheets to work from
        </h2>
        <p className="mt-2 text-sm text-ink-secondary">
          Your first prep sheet is saved, which finishes steps 1 to {FIRST_RUN_STEPS}. Setup adds what later sheets and assessments hold each person’s work against.
        </p>

        <ol className="mt-4 divide-y divide-hairline">
          {parts.map((part, i) => (
            <li key={part.title} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-control text-xs text-ink-muted"
              >
                {FIRST_RUN_STEPS + i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-ink">{part.title}</p>
                <p className="text-[13px] text-ink-secondary">{part.changes}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-4 text-[13px] text-ink-secondary">
          Each step takes a few minutes; role expectations take about 2 minutes per role. Do them in any order that
          suits you and in as many sittings as you like. You can skip any step for now. Setup shows in the header until each step is done or skipped.
        </p>
        <p className="mt-2 text-[13px] text-ink-secondary">
          If you have notes or a document already, “Add what you already have” on the setup card fills in what they cover.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onLater} className={BTN_GHOST}>
            Later
          </button>
          <button ref={startRef} type="button" onClick={onStart} className={BTN_PRIMARY}>
            {startLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
