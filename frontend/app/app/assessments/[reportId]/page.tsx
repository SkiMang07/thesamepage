"use client";

// Assessment scorecard for one direct report (Session 16, 2026-08-04) — the
// per-metric/skill/value scoring surface, plus the overall rolling rating.
// AI can draft scores from recent 1:1s/commitments/goals via "Draft with
// AI"; nothing saves until the manager reviews and hits Save — same
// draft-then-review rule as the 1:1 wrap-up flow (Session 8).
//
// Pending inputs start EMPTY (not pre-filled from the latest score) so that
// clicking Save only logs what the manager actually touched this pass — the
// latest recorded score is shown alongside each item as read-only context,
// not as a default that would silently re-log unchanged.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getScorecard,
  draftAssessment,
  saveAssessment,
  Scorecard,
  ScoredItem,
  AssessmentDraft,
  LatestSkillValueScore,
  LatestMetricEntry,
} from "@/lib/api";
import PageShell from "@/components/PageShell";

type SkillValuePending = { evaluation_point: number | null; notes: string };
type MetricPending = { value: string; period: string; notes: string };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isSkillValueLatest(latest: ScoredItem["latest"]): latest is LatestSkillValueScore {
  return !!latest && "evaluation_point" in latest;
}

function isMetricLatest(latest: ScoredItem["latest"]): latest is LatestMetricEntry {
  return !!latest && "value" in latest;
}

function SkillValueRow({
  item,
  pending,
  onChange,
}: {
  item: ScoredItem;
  pending: SkillValuePending;
  onChange: (p: SkillValuePending) => void;
}) {
  const latest = isSkillValueLatest(item.latest) ? item.latest : null;
  const points = item.scale_definitions.length > 0
    ? item.scale_definitions.map((d) => d.evaluation_point)
    : Array.from({ length: (item.scale_max || 4) - (item.scale_min || 1) + 1 }, (_, i) => (item.scale_min || 1) + i);

  return (
    <li className="rounded-lg border border-hairline px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{item.name}</p>
          {(item.expectation || item.description) && (
            <p className="mt-0.5 text-sm text-ink-secondary">{item.expectation || item.description}</p>
          )}
        </div>
        {latest && (
          <span className="shrink-0 text-xs text-ink-muted">
            Last: {latest.evaluation_point} ({formatDate(latest.assessed_at)})
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {points.map((p) => {
          const def = item.scale_definitions.find((d) => d.evaluation_point === p);
          const label = def?.qualitative_output || def?.quantitative_output || def?.evaluation_name;
          const selected = pending.evaluation_point === p;
          return (
            <button
              key={p}
              type="button"
              title={label || undefined}
              onClick={() => onChange({ ...pending, evaluation_point: selected ? null : p })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                selected ? "bg-brand text-on-brand" : "border border-control text-ink-secondary hover:bg-canvas"
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>
      {pending.evaluation_point !== null && (
        <input
          value={pending.notes}
          onChange={(e) => onChange({ ...pending, notes: e.target.value })}
          placeholder="Notes (optional) — why this score"
          className="mt-2 w-full rounded-md border border-hairline px-3 py-1.5 text-sm"
        />
      )}
    </li>
  );
}

function MetricRow({
  item,
  pending,
  onChange,
}: {
  item: ScoredItem;
  pending: MetricPending;
  onChange: (p: MetricPending) => void;
}) {
  const latest = isMetricLatest(item.latest) ? item.latest : null;
  return (
    <li className="rounded-lg border border-hairline px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{item.name}</p>
          {(item.expectation || item.description) && (
            <p className="mt-0.5 text-sm text-ink-secondary">{item.expectation || item.description}</p>
          )}
          {item.measurement_period && item.measurement_period !== "none" && (
            <p className="mt-0.5 text-xs text-ink-muted">Measured per {item.measurement_period}</p>
          )}
        </div>
        {latest && (
          <span className="shrink-0 text-xs text-ink-muted">
            Last: {latest.value}
            {latest.period ? ` (${latest.period})` : ""}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type="number"
          value={pending.value}
          onChange={(e) => onChange({ ...pending, value: e.target.value })}
          placeholder="Value"
          className="w-28 rounded-md border border-control px-3 py-1.5 text-sm"
        />
        <input
          value={pending.period}
          onChange={(e) => onChange({ ...pending, period: e.target.value })}
          placeholder="Period (e.g. Q3 2026)"
          className="w-40 rounded-md border border-control px-3 py-1.5 text-sm"
        />
      </div>
      {pending.value.trim() && (
        <input
          value={pending.notes}
          onChange={(e) => onChange({ ...pending, notes: e.target.value })}
          placeholder="Notes (optional) — source of this number"
          className="mt-2 w-full rounded-md border border-hairline px-3 py-1.5 text-sm"
        />
      )}
    </li>
  );
}

export default function AssessmentScorecardPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [overallOrdinal, setOverallOrdinal] = useState<number | null>(null);
  const [overallNotes, setOverallNotes] = useState("");
  const [skillPending, setSkillPending] = useState<Record<string, SkillValuePending>>({});
  const [valuePending, setValuePending] = useState<Record<string, SkillValuePending>>({});
  const [metricPending, setMetricPending] = useState<Record<string, MetricPending>>({});

  function emptySkillValue(): SkillValuePending {
    return { evaluation_point: null, notes: "" };
  }
  function emptyMetric(): MetricPending {
    return { value: "", period: "", notes: "" };
  }

  function resetPending(sc: Scorecard) {
    setOverallOrdinal(null);
    setOverallNotes("");
    setSkillPending(Object.fromEntries(sc.skills.map((s) => [s.config_id, emptySkillValue()])));
    setValuePending(Object.fromEntries(sc.values.map((v) => [v.config_id, emptySkillValue()])));
    setMetricPending(Object.fromEntries(sc.metrics.map((m) => [m.config_id, emptyMetric()])));
  }

  useEffect(() => {
    getScorecard(reportId)
      .then((sc) => {
        setScorecard(sc);
        resetPending(sc);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  async function runDraft() {
    if (!scorecard) return;
    setDrafting(true);
    setError(null);
    try {
      const draft: AssessmentDraft = await draftAssessment(reportId);
      if (draft.overall) {
        setOverallOrdinal(draft.overall.level_ordinal);
        setOverallNotes(draft.overall.notes);
      }
      setSkillPending((prev) => {
        const next = { ...prev };
        for (const s of draft.skills) next[s.config_id] = { evaluation_point: s.evaluation_point, notes: s.notes };
        return next;
      });
      setValuePending((prev) => {
        const next = { ...prev };
        for (const v of draft.values) next[v.config_id] = { evaluation_point: v.evaluation_point, notes: v.notes };
        return next;
      });
      setMetricPending((prev) => {
        const next = { ...prev };
        for (const m of draft.metrics) next[m.config_id] = { value: String(m.value), period: m.period ?? "", notes: m.notes };
        return next;
      });
      const totalDrafted = (draft.overall ? 1 : 0) + draft.skills.length + draft.values.length + draft.metrics.length;
      setSaveMessage(
        totalDrafted === 0
          ? "AI didn't find enough evidence to draft anything yet — score manually below, or add more 1:1 notes first."
          : null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to draft assessment");
    } finally {
      setDrafting(false);
    }
  }

  async function handleSave() {
    if (!scorecard) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const body = {
        overall: overallOrdinal !== null ? { level_ordinal: overallOrdinal, notes: overallNotes || null } : null,
        skills: Object.entries(skillPending)
          .filter(([, p]) => p.evaluation_point !== null)
          .map(([config_id, p]) => ({ config_id, evaluation_point: p.evaluation_point as number, notes: p.notes || null })),
        values: Object.entries(valuePending)
          .filter(([, p]) => p.evaluation_point !== null)
          .map(([config_id, p]) => ({ config_id, evaluation_point: p.evaluation_point as number, notes: p.notes || null })),
        metrics: Object.entries(metricPending)
          .filter(([, p]) => p.value.trim() !== "")
          .map(([config_id, p]) => ({ config_id, value: parseFloat(p.value), period: p.period || null })),
      };
      if (!body.overall && body.skills.length === 0 && body.values.length === 0 && body.metrics.length === 0) {
        setSaveMessage("Nothing to save — score at least one item first.");
        setSaving(false);
        return;
      }
      await saveAssessment(reportId, body);
      const sc = await getScorecard(reportId);
      setScorecard(sc);
      resetPending(sc);
      setSaveMessage("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save assessment");
    } finally {
      setSaving(false);
    }
  }

  const totalConfigured = useMemo(
    () => (scorecard ? scorecard.skills.length + scorecard.values.length + scorecard.metrics.length : 0),
    [scorecard]
  );

  if (loading) return <p className="p-8 text-ink-secondary">Loading...</p>;
  if (error && !scorecard) return <p className="p-8 text-red-700">{error}</p>;
  if (!scorecard) return null;

  const { direct_report: report, role, levels } = scorecard;

  return (
    <PageShell maxWidth="2xl">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/app/assessments" className="text-sm text-ink-secondary hover:underline">
            ← Assessments
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{report.name}</h1>
          {role ? (
            <p className="mt-1 text-ink-secondary">
              {role.job_role} · Level {role.job_level}
              {role.functional_team && ` · ${role.functional_team}`}
            </p>
          ) : (
            <p className="mt-1 text-ink-secondary">
              No role assigned —{" "}
              <Link href="/app/settings" className="underline hover:text-ink-body">
                set one in Settings
              </Link>{" "}
              to unlock metric/skill/value scoring.
            </p>
          )}
        </div>
        <button
          onClick={runDraft}
          disabled={drafting || totalConfigured === 0}
          className="shrink-0 rounded-md bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-50"
          title={totalConfigured === 0 ? "No metrics/skills/values configured for this role yet" : undefined}
        >
          {drafting ? "Drafting…" : "Draft with AI →"}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      {saveMessage && <p className="mt-4 text-sm text-ink-secondary">{saveMessage}</p>}

      {/* Overall rating */}
      <div className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">Overall rating</h2>
        {scorecard.overall && (
          <p className="mt-2 text-sm text-ink-secondary">
            Currently: <span className="font-medium text-ink-body">{levels.find((l) => l.ordinal === scorecard.overall!.level_ordinal)?.label}</span>{" "}
            (set {formatDate(scorecard.overall.created_at)})
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {levels.map((lv) => (
            <button
              key={lv.ordinal}
              type="button"
              onClick={() => setOverallOrdinal(overallOrdinal === lv.ordinal ? null : lv.ordinal)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                overallOrdinal === lv.ordinal ? "bg-brand text-on-brand" : "border border-control text-ink-secondary hover:bg-canvas"
              }`}
            >
              {lv.ordinal} — {lv.label}
            </button>
          ))}
        </div>
        {overallOrdinal !== null && (
          <textarea
            value={overallNotes}
            onChange={(e) => setOverallNotes(e.target.value)}
            placeholder="Notes justifying this rating (optional)"
            rows={2}
            className="mt-2 w-full rounded-md border border-hairline px-3 py-2 text-sm"
          />
        )}
      </div>

      {/* Skills */}
      {scorecard.skills.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">Skills</h2>
          <ul className="mt-3 space-y-2">
            {scorecard.skills.map((s) => (
              <SkillValueRow
                key={s.config_id}
                item={s}
                pending={skillPending[s.config_id] ?? emptySkillValue()}
                onChange={(p) => setSkillPending((prev) => ({ ...prev, [s.config_id]: p }))}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Values */}
      {scorecard.values.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">Values</h2>
          <ul className="mt-3 space-y-2">
            {scorecard.values.map((v) => (
              <SkillValueRow
                key={v.config_id}
                item={v}
                pending={valuePending[v.config_id] ?? emptySkillValue()}
                onChange={(p) => setValuePending((prev) => ({ ...prev, [v.config_id]: p }))}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Metrics */}
      {scorecard.metrics.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">Metrics</h2>
          <ul className="mt-3 space-y-2">
            {scorecard.metrics.map((m) => (
              <MetricRow
                key={m.config_id}
                item={m}
                pending={metricPending[m.config_id] ?? emptyMetric()}
                onChange={(p) => setMetricPending((prev) => ({ ...prev, [m.config_id]: p }))}
              />
            ))}
          </ul>
        </div>
      )}

      {totalConfigured === 0 && role && (
        <p className="mt-10 text-ink-secondary">
          No metrics, skills, or values configured for this role yet.{" "}
          <Link href="/app/settings" className="underline hover:text-ink-body">
            Add them in Settings
          </Link>
          . You can still set an overall rating above.
        </p>
      )}

      <div className="mt-10 flex items-center gap-3 border-t border-hairline pt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save assessment"}
        </button>
        <p className="text-xs text-ink-muted">Only items you&apos;ve scored above will be saved.</p>
      </div>
    </PageShell>
  );
}
