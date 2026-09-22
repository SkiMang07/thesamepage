"use client";

// A commitment row for the Beyond the team pages. committed_by "manager"
// with no report is the manager's own ("You" —
// docs/decisions/nullable-commitment-owner.md); "counterpart" is what the
// other person owes you.

import { BeyondCommitment } from "@/lib/api";
import { META } from "@/lib/tokens";
import { localDateStr, shortDate } from "./shared";

export function ownerLabel(c: BeyondCommitment, people: { id: string; name: string }[]) {
  if (c.committed_by === "counterpart") {
    const who = people.find((p) => p.id === c.outside_person_id)?.name;
    return who ? `${who} owes you` : "They owe you";
  }
  if (c.committed_by === "direct_report") return c.direct_report_name ?? "Your report";
  return "You";
}

export function CommitmentRow({
  c,
  label,
  onToggle,
}: {
  c: BeyondCommitment;
  label: string;
  onToggle: (c: BeyondCommitment) => void;
}) {
  const overdue = c.status === "open" && c.due_date && c.due_date < localDateStr();
  return (
    <li className="flex items-start gap-3 py-2">
      <input
        type="checkbox"
        checked={c.status === "done"}
        onChange={() => onToggle(c)}
        className="mt-1"
        aria-label={c.status === "done" ? "Mark open" : "Mark done"}
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${c.status === "done" ? "text-ink-muted line-through" : "text-ink"}`}>{c.description}</p>
        <p className={META}>
          {label}
          {c.due_date && (
            <span className={overdue ? "font-medium text-amber-700" : ""}> · due {shortDate(`${c.due_date}T12:00:00Z`)}</span>
          )}
        </p>
      </div>
    </li>
  );
}

