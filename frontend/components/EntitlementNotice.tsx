"use client";

// The free clock, made visible (PRELAUNCH_BACKLOG §7 B).
//
// Silent for almost everyone. It speaks in two cases:
//   - the last 7 days of a founding place or a 14-day trial: one quiet line
//   - read-only: the backend refuses writes with 402, and this says why,
//     that nothing is lost, and how to keep going
//
// Mounting it is also what starts a new manager's clock: getEntitlement()
// creates their row on first call. It also listens for READ_ONLY_EVENT,
// which api.ts fires on any 402, so a clock that runs out mid-session shows
// the banner the moment a save is refused.
//
// Until Stripe exists, "keep going" means emailing Andrew, who flips the
// account to active by hand.

import { useEffect, useState } from "react";
import { getEntitlement, READ_ONLY_EVENT, type Entitlement } from "@/lib/api";
import { SEVERITY } from "@/lib/tokens";

const CONTACT = "andrew@thesamepage.xyz";
const WARN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysLeft(trialEndsAt: string): number {
  return Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / DAY_MS));
}

function ContactLink() {
  return (
    <a href={`mailto:${CONTACT}`} className="font-medium underline underline-offset-2">
      {CONTACT}
    </a>
  );
}

export default function EntitlementNotice() {
  const [ent, setEnt] = useState<Entitlement | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getEntitlement()
      .then((e) => {
        if (cancelled) return;
        setEnt(e);
        if (e.read_only) setReadOnly(true);
      })
      .catch(() => {
        /* the notice is advisory; the backend gate is what enforces */
      });
    const onReadOnly = () => setReadOnly(true);
    window.addEventListener(READ_ONLY_EVENT, onReadOnly);
    return () => {
      cancelled = true;
      window.removeEventListener(READ_ONLY_EVENT, onReadOnly);
    };
  }, []);

  if (readOnly) {
    return (
      <div role="status" className={`px-6 py-3 text-sm ${SEVERITY.attention.chip}`}>
        Your free period has ended, so your account is read-only. Everything you saved is still
        here. To keep adding to it, email <ContactLink />.
      </div>
    );
  }

  if (!ent || ent.status !== "trialing" || !ent.trial_ends_at) return null;
  const left = daysLeft(ent.trial_ends_at);
  if (left > WARN_DAYS) return null;

  const what = ent.founding_number ? "Your founding 3 months end" : "Your free trial ends";
  const when = left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`;
  return (
    <div role="status" className="border-b border-hairline bg-sunken px-6 py-2 text-sm text-ink-secondary">
      {what} {when}. To keep going after that, email <ContactLink />.
    </div>
  );
}
