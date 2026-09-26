"use client";

// ---------------------------------------------------------------------------
// One meeting beyond the team. A draft opens straight into the editor; a
// logged meeting shows its record — the write-up, what it produced, and what
// it touched on your team.
//
// A commitment with no direct_report_id and committed_by "manager" is the
// manager's own (docs/decisions/nullable-commitment-owner.md), and renders
// as "You". "counterpart" rows are what the other person owes you.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import NoteField from "@/components/NoteField";
import PageShell from "@/components/PageShell";
import MeetingEditor from "../../MeetingEditor";
import { CommitmentRow, ownerLabel } from "../../CommitmentRow";
import {
  BeyondCommitment,
  OutsideMeetingDetail,
  getOutsideMeeting,
  updateCommitment,
  updateOutsideMeeting,
} from "@/lib/api";
import { BADGE, BTN_GHOST, BTN_PRIMARY_SM, BTN_SECONDARY, CARD_PAD, ERROR_TEXT, EYEBROW, META } from "@/lib/tokens";
import { RELATIONSHIP_LABEL, longDate, meetingTitle } from "../../shared";
import { PageSkeleton } from "@/components/Skeleton";

export default function OutsideMeetingPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";
  const [meeting, setMeeting] = useState<OutsideMeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  // Set right after logging a 1:1 that left a next one (repeat or carried topics).
  const [nextId, setNextId] = useState<string | null>(null);

  const load = useCallback(() => {
    getOutsideMeeting(id)
      .then(setMeeting)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load meeting"));
  }, [id]);

  useEffect(load, [load]);

  async function toggle(c: BeyondCommitment) {
    const next = c.status === "done" ? "open" : "done";
    await updateCommitment(c.id, next);
    setMeeting((m) =>
      m ? { ...m, commitments: m.commitments.map((row) => (row.id === c.id ? { ...row, status: next } : row)) } : m
    );
  }

  async function saveSummary() {
    if (!meeting || !summary.trim()) return;
    setSaving(true);
    try {
      await updateOutsideMeeting(meeting.id, { summary: summary.trim() });
      setMeeting({ ...meeting, summary: summary.trim() });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (error && !meeting) {
    return (
      <PageShell maxWidth="3xl">
        <p className={ERROR_TEXT}>{error}</p>
      </PageShell>
    );
  }
  if (!meeting) {
    return <PageSkeleton label="Loading meeting" variant="list" maxWidth="3xl" />;
  }

  if (meeting.status !== "logged") {
    return (
      <MeetingEditor
        key={meeting.id}
        existing={meeting}
        onLogged={(logged) => {
          setNextId(logged.next_meeting_id ?? null);
          setMeeting(logged);
        }}
        onDeleted={() => router.push("/app/beyond")}
      />
    );
  }

  const reportLinks = meeting.links.filter((l) => l.target_type === "direct_report");
  const workLinks = meeting.links.filter((l) => l.target_type !== "direct_report");

  return (
    <PageShell maxWidth="3xl">
      <Link href="/app/beyond" className={`${META} hover:text-ink`}>
        ← Beyond the team
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{meetingTitle(meeting)}</h1>
      <p className="mt-1 text-sm text-ink-secondary">
        {longDate(meeting.meeting_date)} · {meeting.kind === "one_on_one" ? "1:1" : "Group meeting"}
      </p>
      {meeting.people.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {meeting.people.map((p) => (
            <Link
              key={p.id}
              href={`/app/beyond/people/${p.id}`}
              className={`${BADGE} bg-sunken text-ink-secondary hover:text-ink`}
            >
              {p.name} · {RELATIONSHIP_LABEL[p.relationship]}
            </Link>
          ))}
        </div>
      )}

      {nextId && (
        <Link
          href={`/app/beyond/meetings/${nextId}`}
          className={`${CARD_PAD} mt-5 flex items-center justify-between gap-3 hover:bg-sunken`}
        >
          <span className="text-sm text-ink">
            Your next 1:1 with {meeting.people[0]?.name.split(" ")[0] ?? "them"} is set up
            {meeting.recurrence_weeks ? "" : " (no date yet)"}.
          </span>
          <span className="text-sm font-medium text-brand">Open it →</span>
        </Link>
      )}

      <section className={`${CARD_PAD} mt-5`}>
        <div className="flex items-center justify-between">
          <p className={EYEBROW}>Summary</p>
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setSummary(meeting.summary ?? "");
                setEditing(true);
              }}
              className={BTN_GHOST}
            >
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <div className="mt-2">
            <NoteField value={summary} onChange={setSummary} rows={5} className="text-sm" />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className={BTN_SECONDARY}>
                Cancel
              </button>
              <button type="button" onClick={saveSummary} disabled={saving || !summary.trim()} className={BTN_PRIMARY_SM}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-body">{meeting.summary}</p>
        )}
      </section>

      <section className={`${CARD_PAD} mt-5`}>
        <p className={EYEBROW}>Commitments</p>
        {meeting.commitments.length === 0 ? (
          <p className={`${META} mt-2`}>No commitments came out of this meeting.</p>
        ) : (
          <ul className="mt-1 divide-y divide-divider">
            {meeting.commitments.map((c) => (
              <CommitmentRow key={c.id} c={c} label={ownerLabel(c, meeting.people)} onToggle={toggle} />
            ))}
          </ul>
        )}
      </section>

      {(workLinks.length > 0 || reportLinks.length > 0) && (
        <section className={`${CARD_PAD} mt-5`}>
          <p className={EYEBROW}>What this touched on your team</p>
          <ul className="mt-2 space-y-2">
            {workLinks.map((l) => (
              <li key={l.id} className="text-sm">
                <Link
                  href={l.target_type === "goal" ? "/app/goals" : "/app/projects"}
                  className="font-medium text-ink hover:underline"
                >
                  {l.target_name ?? (l.target_type === "goal" ? "A goal" : "A project")}
                </Link>
                {l.note && <span className="text-ink-secondary"> — {l.note}</span>}
              </li>
            ))}
            {reportLinks.map((l) => (
              <li key={l.id} className="text-sm">
                <Link href={`/app/reports/${l.direct_report_id}`} className="font-medium text-ink hover:underline">
                  {l.target_name ?? "A report"}
                </Link>
                {l.note && <span className="text-ink-secondary"> — {l.note}</span>}
                <span className={`${META} ml-1`}>(private, in their 1:1 prep)</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(meeting.prep_items ?? []).length > 0 && (
        <section className={`${CARD_PAD} mt-5`}>
          <p className={EYEBROW}>What you saved to raise</p>
          <ul className="mt-2 space-y-1">
            {meeting.prep_items.map((item) => (
              <li key={item.id} className="text-sm text-ink-body">
                {item.text}
              </li>
            ))}
          </ul>
          <p className={`${META} mt-2`}>Your private prep for this meeting — not part of the reviewed outcome.</p>
        </section>
      )}

      {meeting.notes && (
        <details className="mt-5">
          <summary className={`${META} cursor-pointer`}>Raw notes</summary>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-secondary">{meeting.notes}</p>
        </details>
      )}
      {error && <p className={`${ERROR_TEXT} mt-3`}>{error}</p>}
    </PageShell>
  );
}
