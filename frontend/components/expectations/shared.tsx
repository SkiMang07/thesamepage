"use client";

// Shared pieces for Roles & expectations (/app/expectations). Design
// reference: docs/design-proposals/2026-09-26-role-expectations/.

import { ReactNode, useId, useState } from "react";
import { RoleItem, RoleSection, RoleTarget } from "@/lib/api";
import { BTN_SECONDARY, INPUT } from "@/lib/tokens";

export const SECTION_ORDER: RoleSection[] = ["responsibility", "skill", "value"];

export const SECTION_COPY: Record<RoleSection, { heading: string; blurb: string; add: string }> = {
  responsibility: {
    heading: "Responsibilities & results",
    blurb: "What the role owns, and what a good result looks like.",
    add: "+ Add a responsibility",
  },
  skill: {
    heading: "Skills & behaviors",
    blurb: "Capabilities you can observe in the work.",
    add: "+ Add a skill",
  },
  value: {
    heading: "Role-specific values",
    blurb: "Only when this role needs a behavioral bar beyond your company values.",
    add: "+ Add a role-specific value",
  },
};

export const PERIODS: { id: string; label: string }[] = [
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
  { id: "quarter", label: "Quarterly" },
  { id: "annual", label: "Annually" },
  { id: "none", label: "Not time-based" },
];

export function kindBadge(item: RoleItem): string {
  if (item.section === "responsibility") return item.measure === "numeric" ? "Result · measured" : "Responsibility";
  if (item.section === "skill") return "Skill";
  return "Role value";
}

export function provenance(item: RoleItem): string {
  if (item.edited) return "Your wording";
  switch (item.origin) {
    case "source":
      return "Drafted from your job description · review the wording";
    case "suggestion":
      return "A suggestion you accepted";
    case "approved":
      return "Currently approved";
    case "copied":
      return "Copied from another role";
    default:
      return "Added by you";
  }
}

export function targetStatus(item: RoleItem): "set" | "unresolved" | "legacy" | null {
  if (item.section !== "responsibility" || item.measure !== "numeric") return null;
  if (!item.target) return "legacy";
  return item.target.status;
}

export function blankItem(section: RoleSection): RoleItem {
  const key = `n-${Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
  return {
    key,
    config_id: null,
    config_kind: null,
    section,
    measure: "judged",
    title: "",
    responsibility: "",
    meets: "",
    exceeds: "",
    measurement_period: null,
    order_type: null,
    target: null,
    origin: "manager",
    edited: true,
    source_quote: null,
  };
}

export function formatDay(iso: string | null | undefined, withYear = false): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
}

export function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function roleHeading(title: string, level: number): string {
  return `${title} · Level ${level}`;
}

export function targetText(target: RoleTarget | null): string {
  return target && target.status === "set" ? target.text : "";
}

/** "Come back to this" — a date is the only trigger the app can honor. */
export function FollowUpPicker({
  onChoose,
  busy,
  current,
  label = "Come back to this",
}: {
  onChoose: (isoDate: string) => void;
  busy?: boolean;
  current?: string | null;
  label?: string;
}) {
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState(current?.slice(0, 10) || isoInDays(7));
  const id = useId();
  const presets = [
    { label: "In one week", days: 7 },
    { label: "In two weeks", days: 14 },
    { label: "In a month", days: 30 },
  ];
  return (
    <div>
      <p className="text-xs font-medium text-ink-secondary" id={id}>
        {label}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby={id}>
        {presets.map((p) => (
          <button
            key={p.days}
            type="button"
            disabled={busy}
            onClick={() => onChoose(isoInDays(p.days))}
            className="rounded-md border border-control bg-surface px-2.5 py-1 text-xs font-medium text-ink-body hover:bg-sunken disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => setCustom((c) => !c)}
          aria-expanded={custom}
          className="rounded-md px-2 py-1 text-xs font-medium text-ink-secondary hover:bg-sunken hover:text-ink disabled:opacity-50"
        >
          Pick a date
        </button>
      </div>
      {custom && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="date"
            value={value}
            min={isoInDays(0)}
            onChange={(e) => setValue(e.target.value)}
            className={`${INPUT} w-auto`}
            aria-label="Follow-up date"
          />
          <button type="button" disabled={busy || !value} onClick={() => onChoose(value)} className={BTN_SECONDARY}>
            Set
          </button>
        </div>
      )}
    </div>
  );
}

/** The supplied job description, collapsed by default. */
export function SourcePane({ text, label, open, onToggle }: { text: string | null; label: string | null; open?: boolean; onToggle?: (open: boolean) => void }) {
  if (!text) {
    return (
      <p className="rounded-lg border border-dashed border-control px-4 py-3 text-sm text-ink-muted">
        No job description saved for this role. Everything below is your own wording.
      </p>
    );
  }
  return (
    <details
      className="rounded-lg border border-hairline bg-surface px-4"
      open={open}
      onToggle={(e) => onToggle?.((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer py-3 text-sm font-medium text-ink">
        Source job description <span className="font-normal text-ink-muted">· {label || "as supplied"}</span>
      </summary>
      <div className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap border-t border-divider py-3 text-sm leading-relaxed text-ink-secondary">
        {text}
      </div>
    </details>
  );
}

export function Notice({ tone = "brand", children, onClose }: { tone?: "brand" | "amber" | "red"; children: ReactNode; onClose?: () => void }) {
  const cls =
    tone === "amber" ? "bg-amber-50 text-amber-800" : tone === "red" ? "bg-red-50 text-red-800" : "bg-brand-tint text-ink-body";
  return (
    <div role="status" className={`flex items-start justify-between gap-3 rounded-lg px-4 py-2.5 text-sm ${cls}`}>
      <div className="min-w-0">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 text-xs text-ink-muted hover:text-ink" aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}
