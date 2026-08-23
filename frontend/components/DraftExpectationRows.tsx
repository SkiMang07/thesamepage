"use client";

// Shared draft-review rows for AI-drafted expectations (extracted from
// DraftReviewPanel in app/app/settings/page.tsx, Session 44). The coverage
// grid's "Draft with AI" panel and the new Role JD import panel
// (RoleImportPanel.tsx) show the SAME review rows — keep/edit/discard per
// item, per kind — so a manager reviewing a draft sees one consistent
// screen no matter which door they came through. The rendering here is the
// Plan S3 (Session 39) rows moved verbatim; only the tab state and the
// empty-state copy moved into props.
//
// Draft-then-review is the rule these rows enforce: nothing saves until the
// caller runs commitDraftExpectations() below with whatever is still
// checked.

import { useState } from "react";
import { INPUT } from "@/lib/tokens";
import {
  DraftMetricItem,
  DraftSkillItem,
  DraftValueItem,
  ExpectationBatchItem,
  ExpectationKind,
  batchCreateExpectations,
} from "@/lib/api";

export type DraftMetricRow = DraftMetricItem & { included: boolean };
export type DraftSkillRow = DraftSkillItem & { included: boolean };
export type DraftValueRow = DraftValueItem & { included: boolean };

// Local aliases so this file's existing call sites keep working; the value
// itself is the shared token, so restyling happens in one place.
const inputCls = INPUT;

const KIND_TABS: { id: ExpectationKind; label: string }[] = [
  { id: "metrics", label: "Metrics" },
  { id: "skills", label: "Skills" },
  { id: "values", label: "Values" },
];

// The empty-state line per kind. Defaults are the coverage-grid panel's
// original copy (which points at the manual forms sitting right below it);
// RoleImportPanel passes its own, since there are no manual forms under it.
const DEFAULT_EMPTY_HINTS = {
  metrics: "No metrics drafted — the manual form still works below.",
  skills: "No skills drafted — the manual form still works below.",
  values:
    "No role-specific values drafted — that's often correct (most values belong in Org-wide values instead). The manual form still works below.",
};

export function draftIncludedCount(
  metrics: DraftMetricRow[],
  skills: DraftSkillRow[],
  values: DraftValueRow[]
): number {
  return (
    metrics.filter((m) => m.included).length +
    skills.filter((s) => s.included).length +
    values.filter((v) => v.included).length
  );
}

// Commits whatever is still checked, one batch call per non-empty kind
// (empty kinds are skipped rather than posting an empty items array).
export async function commitDraftExpectations(
  roleLevelId: string,
  metrics: DraftMetricRow[],
  skills: DraftSkillRow[],
  values: DraftValueRow[]
): Promise<void> {
  const incM = metrics.filter((m) => m.included);
  const incS = skills.filter((s) => s.included);
  const incV = values.filter((v) => v.included);

  if (incM.length) {
    const items: ExpectationBatchItem[] = incM.map(({ included, ...rest }) => rest);
    await batchCreateExpectations("metrics", roleLevelId, items);
  }
  if (incS.length) {
    const items: ExpectationBatchItem[] = incS.map(({ included, ...rest }) => rest);
    await batchCreateExpectations("skills", roleLevelId, items);
  }
  if (incV.length) {
    const items: ExpectationBatchItem[] = incV.map(({ included, ...rest }) => rest);
    await batchCreateExpectations("values", roleLevelId, items);
  }
}

export function DraftExpectationsReview({
  metrics,
  setMetrics,
  skills,
  setSkills,
  values,
  setValues,
  loading = false,
  loadingLabel = "Drafting...",
  emptyHints,
}: {
  metrics: DraftMetricRow[];
  setMetrics: React.Dispatch<React.SetStateAction<DraftMetricRow[]>>;
  skills: DraftSkillRow[];
  setSkills: React.Dispatch<React.SetStateAction<DraftSkillRow[]>>;
  values: DraftValueRow[];
  setValues: React.Dispatch<React.SetStateAction<DraftValueRow[]>>;
  loading?: boolean;
  loadingLabel?: string;
  emptyHints?: Partial<typeof DEFAULT_EMPTY_HINTS>;
}) {
  const [tab, setTab] = useState<ExpectationKind>("metrics");
  const hints = { ...DEFAULT_EMPTY_HINTS, ...(emptyHints ?? {}) };

  function updateMetric(i: number, patch: Partial<DraftMetricRow>) {
    setMetrics((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function updateSkill(i: number, patch: Partial<DraftSkillRow>) {
    setSkills((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function updateValue(i: number, patch: Partial<DraftValueRow>) {
    setValues((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <>
      <div className="mt-4 flex rounded-md border border-hairline p-0.5">
        {KIND_TABS.map((t) => {
          const count = t.id === "metrics" ? metrics.length : t.id === "skills" ? skills.length : values.length;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded px-3 py-1 text-sm ${tab === t.id ? "bg-brand text-on-brand" : "text-ink-secondary hover:text-ink"}`}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-ink-secondary">{loadingLabel}</p>
      ) : (
        <div className="mt-4 space-y-2">
          {tab === "metrics" &&
            (metrics.length === 0 ? (
              <p className="text-sm text-ink-secondary">{hints.metrics}</p>
            ) : (
              metrics.map((m, i) => (
                <div key={i} className="rounded-lg border border-hairline p-3">
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={m.included} onChange={(e) => updateMetric(i, { included: e.target.checked })} className="mt-1.5" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <input value={m.name} onChange={(e) => updateMetric(i, { name: e.target.value })} className={inputCls} />
                      <div className="flex gap-2">
                        <select
                          value={m.order_type ?? "primary"}
                          onChange={(e) => updateMetric(i, { order_type: e.target.value as "primary" | "secondary" | "tertiary" })}
                          className={`${inputCls} w-32`}
                        >
                          <option value="primary">Primary</option>
                          <option value="secondary">Secondary</option>
                          <option value="tertiary">Tertiary</option>
                        </select>
                        <select
                          value={m.measurement_period ?? "month"}
                          onChange={(e) => updateMetric(i, { measurement_period: e.target.value })}
                          className={`${inputCls} w-36`}
                        >
                          <option value="week">Weekly</option>
                          <option value="month">Monthly</option>
                          <option value="quarter">Quarterly</option>
                          <option value="annual">Annually</option>
                          <option value="none">Not time-based</option>
                        </select>
                      </div>
                      <textarea
                        value={m.expectation ?? ""}
                        onChange={(e) => updateMetric(i, { expectation: e.target.value })}
                        rows={2}
                        className={inputCls}
                        placeholder="What good looks like"
                      />
                    </div>
                  </div>
                </div>
              ))
            ))}

          {tab === "skills" &&
            (skills.length === 0 ? (
              <p className="text-sm text-ink-secondary">{hints.skills}</p>
            ) : (
              skills.map((s, i) => (
                <div key={i} className="rounded-lg border border-hairline p-3">
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={s.included} onChange={(e) => updateSkill(i, { included: e.target.checked })} className="mt-1.5" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <input value={s.name} onChange={(e) => updateSkill(i, { name: e.target.value })} className={inputCls} />
                      <select
                        value={s.order_type ?? "primary"}
                        onChange={(e) => updateSkill(i, { order_type: e.target.value as "primary" | "secondary" | "tertiary" })}
                        className={`${inputCls} w-32`}
                      >
                        <option value="primary">Primary</option>
                        <option value="secondary">Secondary</option>
                        <option value="tertiary">Tertiary</option>
                      </select>
                      <textarea
                        value={s.expectation ?? ""}
                        onChange={(e) => updateSkill(i, { expectation: e.target.value })}
                        rows={2}
                        className={inputCls}
                        placeholder="What good looks like"
                      />
                    </div>
                  </div>
                </div>
              ))
            ))}

          {tab === "values" &&
            (values.length === 0 ? (
              <p className="text-sm text-ink-secondary">{hints.values}</p>
            ) : (
              values.map((v, i) => (
                <div key={i} className="rounded-lg border border-hairline p-3">
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={v.included} onChange={(e) => updateValue(i, { included: e.target.checked })} className="mt-1.5" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <input value={v.name} onChange={(e) => updateValue(i, { name: e.target.value })} className={inputCls} />
                      <select
                        value={v.order_type ?? "secondary"}
                        onChange={(e) => updateValue(i, { order_type: e.target.value as "primary" | "secondary" | "tertiary" })}
                        className={`${inputCls} w-32`}
                      >
                        <option value="primary">Primary</option>
                        <option value="secondary">Secondary</option>
                        <option value="tertiary">Tertiary</option>
                      </select>
                      <textarea
                        value={v.description ?? ""}
                        onChange={(e) => updateValue(i, { description: e.target.value })}
                        rows={2}
                        className={inputCls}
                        placeholder="What living this value looks like"
                      />
                    </div>
                  </div>
                </div>
              ))
            ))}
        </div>
      )}
    </>
  );
}
