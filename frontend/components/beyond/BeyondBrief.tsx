"use client";

// "What needs you next?" — a short brief across People, My manager and
// Group conversations. Built on the server from records (routes/
// beyond_continuity.py build_brief); AI suggestions are a separate, labelled
// kind with their own review step, opened below the list. Target three items, fewer when there is
// less to say; the rest sit behind "Show more".

import { useState } from "react";
import Link from "next/link";
import { BeyondBriefItem, BeyondConversation, BeyondSuggestion } from "@/lib/api";
import { BTN_GHOST, BTN_PRIMARY_SM, META } from "@/lib/tokens";
import SuggestionReview from "./SuggestionReview";
import { dayWeekday } from "@/app/app/beyond/shared";

const LABEL: Record<BeyondBriefItem["kind"], { text: string; tone: string }> = {
  upcoming: { text: "Upcoming", tone: "text-brand" },
  commitment: { text: "Commitment", tone: "text-brand" },
  review: { text: "Needs review", tone: "text-amber-700" },
  cadence: { text: "Reconnect", tone: "text-brand" },
  reconnect: { text: "Reconnect", tone: "text-brand" },
  suggestion: { text: "AI suggestion", tone: "text-blue-700" },
};

export type SuggestionState = "idle" | "checking" | "failed" | "unavailable";

export default function BeyondBrief({
  brief,
  more,
  suggestions,
  upcoming,
  suggestionState,
  suggestionsAvailable,
  onChanged,
}: {
  brief: BeyondBriefItem[];
  more: BeyondBriefItem[];
  suggestions: BeyondSuggestion[];
  upcoming: BeyondConversation[];
  suggestionState: SuggestionState;
  suggestionsAvailable: boolean;
  onChanged: () => void;
}) {
  const [showMore, setShowMore] = useState(false);
  // A snapshot, so the review (and its receipt) stays on screen after the
  // page re-reads and the suggestion leaves the brief.
  const [reviewing, setReviewing] = useState<BeyondSuggestion | null>(null);
  const [dismissedNote, setDismissedNote] = useState(false);
  const items = showMore ? [...brief, ...more] : brief;
  // The soonest conversation to prepare gets the one filled button.
  const firstUpcoming = items.find((i) => i.kind === "upcoming")?.id;

  function toggleReview(id: string | undefined) {
    setDismissedNote(false);
    if (!id) return;
    if (reviewing?.id === id) {
      setReviewing(null);
      return;
    }
    setReviewing(suggestions.find((s) => s.id === id) ?? null);
  }

  const review = reviewing && (
    <SuggestionReview
      key={reviewing.id}
      suggestion={reviewing}
      upcoming={upcoming}
      onChanged={onChanged}
      onDismissed={() => {
        setReviewing(null);
        setDismissedNote(true);
        onChanged();
      }}
    />
  );

  return (
    <section aria-labelledby="beyond-brief-title" className="rounded-xl border border-hairline bg-surface px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="beyond-brief-title" className="font-serif text-[1.6rem] font-normal leading-tight tracking-[-0.02em] text-ink">
          What needs you next?
        </h2>
        <p className={META}>Recorded facts + AI suggestions</p>
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-ink-secondary">
          Nothing is recorded as needing you right now. When you plan or log a conversation, what comes next shows up
          here.
        </p>
      ) : (
        <ul className="mt-2">
          {items.map((item) => {
            const label = LABEL[item.kind];
            const primary = item.id === firstUpcoming;
            const dateText =
              item.kind === "upcoming" && item.date
                ? dayWeekday(item.date)
                : item.kind === "commitment"
                  ? item.due_label
                  : null;
            return (
              <li key={item.id} className="border-b border-divider py-4 last:border-b-0">
                <div className="grid gap-x-5 gap-y-1 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto] sm:items-center">
                  <p className={`text-2xs font-semibold uppercase tracking-wide ${label.tone}`}>{label.text}</p>
                  <div className="min-w-0">
                    <p className="text-[1.05rem] text-ink">
                      {item.title}
                      {dateText && <span className="text-ink-secondary"> · {dateText}</span>}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-secondary">{item.reason}</p>
                  </div>
                  <div className="sm:justify-self-end">
                    {item.kind === "suggestion" ? (
                      <button
                        type="button"
                        onClick={() => toggleReview(item.suggestion_id)}
                        aria-expanded={reviewing?.id === item.suggestion_id}
                        className="text-sm text-brand hover:text-brand-hover"
                      >
                        {reviewing?.id === item.suggestion_id ? "Close review" : "Review suggestion →"}
                      </button>
                    ) : item.action.href ? (
                      <Link
                        href={item.action.href}
                        className={primary ? BTN_PRIMARY_SM : `text-sm ${item.kind === "review" ? "text-amber-700 hover:text-amber-600" : "text-brand hover:text-brand-hover"}`}
                      >
                        {primary ? item.action.label : `${item.action.label} →`}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* One stable place for the review, so its receipt survives the page
          re-reading after a save (the suggestion then leaves the list). */}
      {reviewing && (
        <div className="border-t border-divider pt-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink">
              <span className="text-2xs font-semibold uppercase tracking-wide text-blue-700">Reviewing</span> {reviewing.title}
            </p>
            <button type="button" onClick={() => setReviewing(null)} className={BTN_GHOST}>
              Close
            </button>
          </div>
          {review}
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className={META} role="status">
          {dismissedNote
            ? "Dismissed. Its records are unchanged, and it won't be suggested again unless the records change."
            : !suggestionsAvailable || suggestionState === "unavailable"
              ? "Suggestions aren't available right now. Everything above comes from your records."
              : suggestionState === "checking"
                ? "Looking for connections in your reviewed records…"
                : suggestionState === "failed"
                  ? "Couldn't check for suggestions just now. Everything above comes from your records."
                  : ""}
        </p>
        {more.length > 0 && (
          <button type="button" onClick={() => setShowMore((v) => !v)} className={BTN_GHOST}>
            {showMore ? "Show less" : `Show ${more.length} more`}
          </button>
        )}
      </div>
    </section>
  );
}
