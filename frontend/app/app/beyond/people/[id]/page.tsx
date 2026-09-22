"use client";

// ---------------------------------------------------------------------------
// One person you meet outside your team: every meeting with them, what you
// owe each other, and what those meetings touched on your own team. The
// same idea as a report's person page, for people who aren't your reports.
// Phase 2 (repeating meetings and prep for managing up) builds on this page.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import PageShell from "@/components/PageShell";
import { CommitmentRow } from "../../CommitmentRow";
import {
  BeyondCommitment,
  BeyondPersonDetail,
  OutsideRelationship,
  getOutsidePerson,
  updateCommitment,
  updateOutsidePerson,
} from "@/lib/api";
import {
  BADGE,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_PRIMARY_SM,
  BTN_SECONDARY,
  CARD_PAD,
  ERROR_TEXT,
  EYEBROW,
  INPUT,
  LABEL,
  META,
  SELECT,
  TEXTAREA,
} from "@/lib/tokens";
import { RELATIONSHIP_LABEL, RELATIONSHIP_ORDER, longDate, meetingTitle, shortDate } from "../../shared";

export default function OutsidePersonPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";
  const [data, setData] = useState<BeyondPersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", relationship: "peer" as OutsideRelationship, roleTitle: "", email: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(() => {
    getOutsidePerson(id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);

  useEffect(load, [load]);

  function startEdit() {
    if (!data) return;
    const p = data.person;
    setForm({
      name: p.name,
      relationship: p.relationship,
      roleTitle: p.role_title ?? "",
      email: p.email ?? "",
      notes: p.notes ?? "",
    });
    setEditing(true);
  }

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const person = await updateOutsidePerson(id, form);
      setData((d) => (d ? { ...d, person } : d));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function setArchived(archived: boolean) {
    try {
      const person = await updateOutsidePerson(id, { archived });
      if (archived) router.push("/app/beyond");
      else setData((d) => (d ? { ...d, person } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    }
  }

  async function toggle(c: BeyondCommitment) {
    const next = c.status === "done" ? "open" : "done";
    await updateCommitment(c.id, next);
    setData((d) =>
      d ? { ...d, commitments: d.commitments.map((row) => (row.id === c.id ? { ...row, status: next } : row)) } : d
    );
  }

  if (!data) {
    return (
      <PageShell maxWidth="4xl">
        {error ? <p className={ERROR_TEXT}>{error}</p> : <p className={META}>Loading...</p>}
      </PageShell>
    );
  }

  const { person, meetings, commitments, links } = data;
  const firstName = person.name.split(" ")[0];
  const open = commitments.filter((c) => c.status === "open");
  const theyOwe = open.filter((c) => c.committed_by === "counterpart");
  const youOwe = open.filter((c) => c.committed_by !== "counterpart");
  const done = commitments.filter((c) => c.status !== "open");
  const meetingById = new Map(meetings.map((m) => [m.id, m]));
  // The next 1:1 with them: the soonest unlogged 1:1, undated last.
  const next = meetings
    .filter((m) => m.status === "upcoming" && m.kind === "one_on_one")
    .sort((a, b) => (a.meeting_date ?? "9999").localeCompare(b.meeting_date ?? "9999"))[0];
  const repeat = data.recurrence_weeks;
  const pastMeetings = meetings.filter((m) => m.status !== "upcoming");

  return (
    <PageShell maxWidth="4xl">
      <Link href="/app/beyond" className={`${META} hover:text-ink`}>
        ← Beyond the team
      </Link>

      {editing ? (
        <div className={`${CARD_PAD} mt-3 space-y-3`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="p-name">Name</label>
              <input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT} />
            </div>
            <div>
              <label className={LABEL} htmlFor="p-rel">Relationship</label>
              <select
                id="p-rel"
                value={form.relationship}
                onChange={(e) => setForm({ ...form, relationship: e.target.value as OutsideRelationship })}
                className={SELECT}
              >
                {RELATIONSHIP_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {RELATIONSHIP_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="p-role">Role</label>
              <input id="p-role" value={form.roleTitle} onChange={(e) => setForm({ ...form, roleTitle: e.target.value })} className={INPUT} placeholder="VP Finance" />
            </div>
            <div>
              <label className={LABEL} htmlFor="p-email">Email</label>
              <input id="p-email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={INPUT} />
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor="p-notes">Private notes</label>
            <textarea id="p-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className={TEXTAREA} placeholder="How they like to work, what they care about..." />
          </div>
          {error && <p className={ERROR_TEXT}>{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className={BTN_SECONDARY}>Cancel</button>
            <button type="button" onClick={save} disabled={saving || !form.name.trim()} className={BTN_PRIMARY_SM}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{person.name}</h1>
            <p className="mt-1 text-sm text-ink-secondary">
              {RELATIONSHIP_LABEL[person.relationship]}
              {person.role_title && ` · ${person.role_title}`}
              {person.archived_at && " · Archived"}
            </p>
            {person.notes && <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm text-ink-body">{person.notes}</p>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={startEdit} className={BTN_GHOST}>Edit</button>
            {person.archived_at ? (
              <button type="button" onClick={() => setArchived(false)} className={BTN_SECONDARY}>Restore</button>
            ) : (
              <button type="button" onClick={() => setArchived(true)} className={BTN_GHOST}>Archive</button>
            )}
            <Link
              href={`/app/beyond/meetings/new?person=${person.id}`}
              className={next ? BTN_SECONDARY : BTN_PRIMARY}
            >
              Log a meeting
            </Link>
          </div>
        </div>
      )}

      <section className={`${CARD_PAD} mt-5 flex flex-wrap items-center justify-between gap-3`}>
        {next ? (
          <>
            <div>
              <p className={EYEBROW}>Next 1:1</p>
              <p className="mt-1 text-sm text-ink">
                {next.meeting_date ? longDate(next.meeting_date) : "No date yet"}
                {repeat ? ` · repeats ${repeat === 1 ? "weekly" : `every ${repeat} weeks`}` : ""}
              </p>
              <p className={META}>
                {[
                  next.prep_guide ? "Prepared" : "Not prepared yet",
                  next.carry_forward_items.length > 0 && `${next.carry_forward_items.length} carried from last time`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Link href={`/app/beyond/meetings/${next.id}`} className={BTN_PRIMARY}>
              {next.prep_guide ? "Open prep" : "Prepare"}
            </Link>
          </>
        ) : (
          <>
            <div>
              <p className={EYEBROW}>Next 1:1</p>
              <p className={`${META} mt-1`}>
                None planned. Plan one and set it to repeat, and you&apos;ll get a prep sheet before each 1:1 with{" "}
                {firstName}.
              </p>
            </div>
            <Link href={`/app/beyond/meetings/new?person=${person.id}&plan=1`} className={BTN_SECONDARY}>
              Plan the next 1:1
            </Link>
          </>
        )}
      </section>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <section className={CARD_PAD}>
          <p className={EYEBROW}>{firstName} owes you</p>
          {theyOwe.length === 0 ? (
            <p className={`${META} mt-2`}>Nothing open.</p>
          ) : (
            <ul className="mt-1 divide-y divide-divider">
              {theyOwe.map((c) => (
                <CommitmentRow key={c.id} c={c} label={meetingLabel(c, meetingById)} onToggle={toggle} />
              ))}
            </ul>
          )}
        </section>
        <section className={CARD_PAD}>
          <p className={EYEBROW}>You owe {firstName}</p>
          {youOwe.length === 0 ? (
            <p className={`${META} mt-2`}>Nothing open.</p>
          ) : (
            <ul className="mt-1 divide-y divide-divider">
              {youOwe.map((c) => (
                <CommitmentRow
                  key={c.id}
                  c={c}
                  label={c.committed_by === "direct_report" ? `${c.direct_report_name ?? "Your report"} · ${meetingLabel(c, meetingById)}` : meetingLabel(c, meetingById)}
                  onToggle={toggle}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
      {done.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowDone((v) => !v)} className={BTN_GHOST}>
            {showDone ? "Hide" : "Show"} {done.length} closed
          </button>
          {showDone && (
            <ul className={`${CARD_PAD} mt-2 divide-y divide-divider`}>
              {done.map((c) => (
                <CommitmentRow key={c.id} c={c} label={c.committed_by === "counterpart" ? `${firstName} owed you` : "You"} onToggle={toggle} />
              ))}
            </ul>
          )}
        </div>
      )}

      <section className="mt-5">
        <p className={EYEBROW}>Meetings</p>
        {pastMeetings.length === 0 ? (
          <p className={`${META} mt-2`}>No meetings with {firstName} yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {pastMeetings.map((m) => (
              <li key={m.id}>
                <Link href={`/app/beyond/meetings/${m.id}`} className={`${CARD_PAD} block hover:bg-sunken`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium text-ink">{meetingTitle(m)}</p>
                    <span className={META}>{shortDate(m.meeting_date)}</span>
                  </div>
                  {m.status === "draft" ? (
                    <span className={`${BADGE} mt-1 inline-block bg-amber-50 text-amber-700`}>Not written up yet</span>
                  ) : (
                    <p className="mt-1 line-clamp-2 text-sm text-ink-secondary">{m.summary}</p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {links.length > 0 && (
        <section className={`${CARD_PAD} mt-5`}>
          <p className={EYEBROW}>What these meetings touched on your team</p>
          <ul className="mt-2 space-y-1.5">
            {links.map((l) => (
              <li key={l.id} className="text-sm">
                <span className="font-medium text-ink">{l.target_name ?? "Removed item"}</span>
                {l.note && <span className="text-ink-secondary"> — {l.note}</span>}
                <span className={`${META} ml-1`}>{shortDate(meetingById.get(l.meeting_id)?.meeting_date)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}

function meetingLabel(c: BeyondCommitment, meetings: Map<string, { title: string | null; kind: string; people: { name: string }[]; meeting_date: string | null }>) {
  const m = c.source_id ? meetings.get(c.source_id) : undefined;
  return m ? `from ${meetingTitle(m)}, ${shortDate(m.meeting_date)}` : "from a meeting";
}
