"use client";

// The Space — Context Engine upload + confirm-card UX (Session III,
// docs/CONTEXT_ENGINE_BUILD_PLAN.md). Own top-level page, same reasoning as
// every other domain page (Goals, Projects, Org): this is somewhere a
// manager returns to regularly, not a one-time setup screen.
//
// Flow: upload a file -> backend runs the whole extraction pipeline
// synchronously (Session 28's POST /api/documents/upload, up to ~1-2
// minutes for a large deck) -> the Librarian's proposed card appears
// inline in the "Needs review" queue -> the user edits
// category/freshness/effective-date/scope if needed and confirms, or
// discards a bad upload. Confirmed docs drop into a lightweight recent
// list at the bottom, purely for feedback that the upload "landed" — this
// is NOT a browsing/search view of the org's docs (that's Session IV/V
// territory: retrieval and the Brain visualization).
//
// Scope is deliberately left unchecked by default rather than defaulting
// to "Company-wide" — per docs/CONTEXT_ENGINE.md, scope is a user-confirmed
// decision, not something to silently default. Confirm stays disabled
// until at least one scope is chosen (mirrors the backend's own "at least
// one scope required" validation in documents.py's confirm_document).
//
// Session V addition (2026-08-12, same day): "The Brain" — a coverage map
// added above the upload form, per docs/CONTEXT_ENGINE.md's framing of the
// Space as intake + the Brain + the browsing UI all on one surface. Fetched
// separately from documents/orgUnits and fails quiet (same pattern the
// dashboard's AI insight banner uses) — a Brain hiccup shouldn't block the
// upload flow, which is this page's core job. Widened the page from
// max-w-3xl to max-w-4xl to give a 5-category grid room to breathe; the
// upload form and queues below still read fine at the wider column.
//
// No new visualization library — build-plan Session V suggested reusing
// "the existing dashboard's orbital/radial mission control motif," but
// Mission Control (app/dashboard/page.tsx) turned out to be a card grid, not
// an actual radial component. Interpreted that spec as "radial in spirit,
// consistent in visual language" — a plain inline-SVG progress ring per
// category (no new dependency), styled with the same rounded-xl/gray-200
// card language already used everywhere else on this page. Judgment call,
// not discussed with Andrew; flagged as a placeholder open to revision.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CategoryCoverage,
  ContextCoverage,
  CoverageConflict,
  Document,
  DocumentCategory,
  DocumentConfirmIn,
  DocumentFreshnessClass,
  OrgUnit,
  confirmDocument,
  deleteDocument,
  getContextCoverage,
  getDocuments,
  getOrgUnits,
  uploadDocument,
} from "@/lib/api";

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  where_we_are_going: "Where we're going",
  who_we_are_and_how_we_operate: "Who we are & how we operate",
  who_we_serve: "Who we serve",
  what_we_offer: "What we offer",
  how_people_grow_here: "How people grow here",
};

const FRESHNESS_LABELS: Record<DocumentFreshnessClass, string> = {
  evergreen: "Evergreen",
  dated: "Dated",
  stream_instance: "Stream (recent update)",
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS) as [DocumentCategory, string][];
const FRESHNESS_OPTIONS = Object.entries(FRESHNESS_LABELS) as [DocumentFreshnessClass, string][];

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-medium text-gray-500";
const primaryBtnCls = "rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ContextEnginePage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The Brain (Session V) + staleness/conflicts (Session VI) — separate load
  // path from documents/orgUnits above so a coverage failure can't block the
  // upload flow. undefined = "hasn't resolved yet" (renders nothing, not an
  // empty-state grid); `categories` would never actually be an empty array
  // (compute_category_coverage always returns all 5, even at zero docs).
  const [coverage, setCoverage] = useState<ContextCoverage | undefined>(undefined);
  const [expandedCategory, setExpandedCategory] = useState<DocumentCategory | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function loadCoverage() {
    getContextCoverage()
      .then(setCoverage)
      .catch(() => setCoverage(undefined));
  }

  useEffect(() => {
    Promise.all([getDocuments(), getOrgUnits()])
      .then(([docs, units]) => {
        setDocuments(docs);
        setOrgUnits(units);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    loadCoverage();
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const doc = await uploadDocument(file, uploadTitle);
      setDocuments((docs) => [doc, ...docs]);
      setUploadTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirm(id: string, body: DocumentConfirmIn) {
    const updated = await confirmDocument(id, body);
    setDocuments((docs) => docs.map((d) => (d.id === id ? { ...d, ...updated } : d)));
    // A newly-confirmed doc can move a category's fill/doc-count/scope
    // eligibility — refresh the Brain rather than let it go stale until the
    // next full page load.
    loadCoverage();
  }

  async function handleDiscard(id: string) {
    try {
      await deleteDocument(id);
      setDocuments((docs) => docs.filter((d) => d.id !== id));
      // A discarded confirmed doc can drop a category's fill/doc-count — see
      // the same reasoning on handleConfirm above.
      loadCoverage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to discard document");
    }
  }

  const pending = documents.filter((d) => d.status === "pending_review");
  const failed = documents.filter((d) => d.status === "failed");
  const stuck = documents.filter((d) => d.status === "processing");
  const confirmed = documents
    .filter((d) => d.status === "confirmed")
    .sort((a, b) => (b.confirmed_at ?? "").localeCompare(a.confirmed_at ?? ""))
    .slice(0, 10);

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">The Space</h1>
        <Link href="/app/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
          &larr; Back to your team
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Teach the Librarian about your team — strategy, values, customers, offerings, career paths.
        The more it knows, the better your answers get.
      </p>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      {/* The Brain (Session V) — coverage map first, ahead of the upload
          form, per the framework doc's promise that the brain "will show
          you exactly where teaching it more pays off." Renders nothing
          until coverage resolves (undefined), and fails silently on error —
          same posture as the dashboard's AI insight banner. */}
      {coverage && (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">The Brain</h2>
            <p className="text-xs text-gray-400">What the Librarian knows about your team</p>
          </div>

          {/* Conflicts (Session VI) — flagged, never auto-resolved, per the
              framework doc's precedence rules. Spans category pairs, so it
              sits above the grid rather than nested under one card. Only
              rendered when non-empty — no "no conflicts" success banner,
              consistent with the app's calm-degradation posture elsewhere
              (e.g. Settings' no-placeholder rule). */}
          {coverage.conflicts.length > 0 && (
            <div className="mt-3 space-y-2">
              {coverage.conflicts.map((conflict) => (
                <ConflictBanner key={`${conflict.doc_a.id}-${conflict.doc_b.id}`} conflict={conflict} />
              ))}
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {coverage.categories.map((cat) => (
              <BrainCategoryCard
                key={cat.category}
                coverage={cat}
                selected={expandedCategory === cat.category}
                onClick={() =>
                  setExpandedCategory((current) => (current === cat.category ? null : cat.category))
                }
              />
            ))}
          </div>
          {expandedCategory && (
            <BrainDetailPanel coverage={coverage.categories.find((c) => c.category === expandedCategory)!} />
          )}
        </div>
      )}

      <form onSubmit={handleUpload} className="mt-8 space-y-3 rounded-lg border border-dashed border-gray-300 p-4">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelCls}>File (.pptx, .pdf, .txt, or .md)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pptx,.pdf,.txt,.md"
              className={`${inputCls} file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-2 file:py-1 file:text-xs`}
              disabled={uploading}
            />
          </div>
          <div className="w-56">
            <label className={labelCls}>Title (optional)</label>
            <input
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              className={inputCls}
              placeholder="Defaults to the filename"
              disabled={uploading}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={uploading} className={primaryBtnCls}>
            {uploading ? "Reading your document…" : "Upload"}
          </button>
          {uploading && (
            <p className="text-xs text-gray-400">
              The Librarian is reading it now — this can take up to a minute for a large deck.
            </p>
          )}
        </div>
      </form>

      {loading ? (
        <p className="mt-8 text-gray-500">Loading...</p>
      ) : (
        <>
          {stuck.length > 0 && (
            <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {stuck.length} document{stuck.length > 1 ? "s are" : " is"} still processing. Refresh in a
              moment — if this persists, the upload likely failed partway through.
            </div>
          )}

          <div className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
              Needs review {pending.length > 0 && `(${pending.length})`}
            </h2>
            {pending.length === 0 && failed.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">
                Nothing waiting on you. Upload a document above to teach the Librarian something new.
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                {pending.map((doc) => (
                  <ConfirmCard
                    key={doc.id}
                    doc={doc}
                    orgUnits={orgUnits}
                    onConfirm={(body) => handleConfirm(doc.id, body)}
                    onDiscard={() => handleDiscard(doc.id)}
                  />
                ))}
                {failed.map((doc) => (
                  <div key={doc.id} className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{doc.title}</p>
                        <p className="mt-0.5 text-xs text-red-500">
                          This upload failed to process — the file may be unreadable, or the Librarian
                          hit an error. Discard and try again.
                        </p>
                      </div>
                      <button
                        onClick={() => handleDiscard(doc.id)}
                        className="shrink-0 text-xs text-gray-400 hover:text-red-600"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {confirmed.length > 0 && (
            <div className="mt-10">
              <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">Recently confirmed</h2>
              <ul className="mt-3 space-y-2">
                {confirmed.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{doc.title}</p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {doc.category && CATEGORY_LABELS[doc.category]}
                        {doc.confirmed_at && ` · confirmed ${formatDateTime(doc.confirmed_at)}`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDiscard(doc.id)}
                      className="shrink-0 text-xs text-gray-400 hover:text-red-500"
                      title="Remove from the Context Engine"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function ConfirmCard({
  doc,
  orgUnits,
  onConfirm,
  onDiscard,
}: {
  doc: Document;
  orgUnits: OrgUnit[];
  onConfirm: (body: DocumentConfirmIn) => Promise<void>;
  onDiscard: () => void;
}) {
  const [category, setCategory] = useState<DocumentCategory>(doc.category ?? "where_we_are_going");
  const [freshness, setFreshness] = useState<DocumentFreshnessClass>(doc.freshness_class ?? "dated");
  const [effectiveDate, setEffectiveDate] = useState(doc.effective_date ?? "");
  // Deliberately empty by default — see the page-level comment on why scope
  // isn't pre-checked to "Company-wide."
  const [scopeIds, setScopeIds] = useState<Set<string | null>>(new Set());
  const [saving, setSaving] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  function toggleScope(id: string | null) {
    setScopeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirmClick() {
    if (scopeIds.size === 0 || saving) return;
    setSaving(true);
    setCardError(null);
    try {
      await onConfirm({
        category,
        freshness_class: freshness,
        effective_date: effectiveDate || null,
        org_unit_ids: Array.from(scopeIds),
      });
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">{doc.title}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            Uploaded {formatDateTime(doc.created_at)}
            {doc.novelty_score != null && ` · Novelty ${doc.novelty_score}/100`}
          </p>
        </div>
        <button onClick={onDiscard} className="shrink-0 text-xs text-gray-400 hover:text-red-500">
          Discard
        </button>
      </div>

      {doc.summary_card && (
        <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm italic text-gray-600">
          <span className="not-italic font-medium text-gray-500">The Librarian: </span>
          {doc.summary_card}
        </p>
      )}

      <div className="mt-4 flex gap-3">
        <div className="flex-1">
          <label className={labelCls}>Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentCategory)}
            className={inputCls}
          >
            {CATEGORY_OPTIONS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-48">
          <label className={labelCls}>Freshness</label>
          <select
            value={freshness}
            onChange={(e) => setFreshness(e.target.value as DocumentFreshnessClass)}
            className={inputCls}
          >
            {FRESHNESS_OPTIONS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <label className={labelCls}>Effective date</label>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-4">
        <label className={labelCls}>Who this applies to (choose at least one)</label>
        <div className="flex flex-wrap gap-2">
          <label
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
              scopeIds.has(null) ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-600"
            }`}
          >
            <input type="checkbox" checked={scopeIds.has(null)} onChange={() => toggleScope(null)} className="hidden" />
            Company-wide
          </label>
          {orgUnits.map((unit) => (
            <label
              key={unit.id}
              className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
                scopeIds.has(unit.id)
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 text-gray-600"
              }`}
            >
              <input
                type="checkbox"
                checked={scopeIds.has(unit.id)}
                onChange={() => toggleScope(unit.id)}
                className="hidden"
              />
              {unit.name}
            </label>
          ))}
        </div>
        {orgUnits.length === 0 && (
          <p className="mt-1 text-xs text-gray-400">
            No teams or departments set up yet — Company-wide is your only option until you build one on
            the Org page.
          </p>
        )}
      </div>

      {cardError && <p className="mt-3 text-sm text-red-500">{cardError}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button onClick={handleConfirmClick} disabled={saving || scopeIds.size === 0} className={primaryBtnCls}>
          {saving ? "Confirming..." : "Confirm"}
        </button>
        {scopeIds.size === 0 && <p className="text-xs text-gray-400">Pick a scope to enable Confirm.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Brain (Session V) — coverage ring per category + click-through detail
// panel. See the page-level comment above for why this is a plain inline-SVG
// ring rather than a new charting dependency.
// ---------------------------------------------------------------------------

// A brand color (indigo, matching the dashboard's AI insight banner — this
// is the app's one existing "this is the AI/system speaking" accent) whose
// OPACITY scales with fill, not its hue — an empty region reads as barely
// visible, a full one as vivid, per the framework doc's "regions
// fill/brighten as real coverage grows."
const BRAIN_ACCENT = "#4f46e5";

function CoverageRing({ percent, size = 64 }: { percent: number; size?: number }) {
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference * (1 - clamped / 100);
  // Floor at 0.2 so even a 0% ring's track is faintly legible as "a ring,
  // not a rendering bug" rather than fully invisible.
  const opacity = 0.2 + 0.8 * (clamped / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={BRAIN_ACCENT}
        strokeOpacity={opacity}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

function BrainCategoryCard({
  coverage,
  selected,
  onClick,
}: {
  coverage: CategoryCoverage;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition ${
        selected ? "border-indigo-300 bg-indigo-50/60" : "border-gray-200 bg-white hover:border-gray-300"
      }`}
    >
      <div className="relative inline-flex items-center justify-center">
        <CoverageRing percent={coverage.fill_score} />
        <span className="absolute text-sm font-semibold text-gray-900">{coverage.fill_score}</span>
      </div>
      <p className="text-xs font-medium leading-tight text-gray-700">{coverage.label}</p>
      <p className="text-[11px] text-gray-400">
        {coverage.doc_count === 0
          ? "No documents yet"
          : `${coverage.doc_count} document${coverage.doc_count === 1 ? "" : "s"}`}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-1">
        {coverage.citations_this_week > 0 && (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
            Used {coverage.citations_this_week}x this week
          </span>
        )}
        {coverage.staleness_prompt && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            Aging
          </span>
        )}
      </div>
    </button>
  );
}

function BrainDetailPanel({ coverage }: { coverage: CategoryCoverage }) {
  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold text-gray-900">{coverage.label}</h3>
        {coverage.citations_this_week > 0 && (
          <span className="shrink-0 rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-medium text-indigo-700">
            Used in {coverage.citations_this_week} answer{coverage.citations_this_week === 1 ? "" : "s"} this
            week
          </span>
        )}
      </div>

      {coverage.documents.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {coverage.documents.map((doc) => (
            <li key={doc.id} className="rounded-lg bg-gray-50 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium text-gray-900">{doc.title}</p>
                <span className="shrink-0 text-[11px] text-gray-400">
                  {doc.freshness_class && FRESHNESS_LABELS[doc.freshness_class]}
                  {doc.effective_date && ` · as of ${doc.effective_date}`}
                </span>
              </div>
              {doc.summary_card && <p className="mt-1 text-xs italic text-gray-600">{doc.summary_card}</p>}
              {doc.citations_this_week > 0 && (
                <p className="mt-1 text-[11px] font-medium text-indigo-600">
                  Used in {doc.citations_this_week} answer{doc.citations_this_week === 1 ? "" : "s"} this week
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-gray-500">Nothing here yet.</p>
      )}

      {coverage.staleness_prompt && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm italic text-amber-800">
          <span className="not-italic font-medium text-amber-600">The Librarian: </span>
          {coverage.staleness_prompt}
        </p>
      )}

      <p className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-sm italic text-gray-600">
        <span className="not-italic font-medium text-gray-500">The Librarian: </span>
        {coverage.gap_question}
      </p>
    </div>
  );
}

function ConflictBanner({ conflict }: { conflict: CoverageConflict }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
          Conflict
        </span>
        <p className="text-sm text-amber-900">
          <span className="font-medium">{conflict.category_label}: </span>
          {conflict.message}
        </p>
      </div>
    </div>
  );
}
