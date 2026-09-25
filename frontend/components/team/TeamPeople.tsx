"use client";

// People on /app/team — the caller's own direct reports in the selected
// scope (exact team, no descendant rollup). Each person's Relationship Desk
// is the primary destination; Team details keeps the secondary things that
// live here: their current work, the private team update record (store-only:
// nothing is sent to them), and account access (hidden until the IC view
// ships — IC_INVITES_ENABLED).

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DirectReport,
  OrgUnit,
  RoleLevel,
  SetupStatus,
  TeamMember,
  TeamMessage,
  getTeamMessages,
  inviteDirectReport,
  sendTeamMessage,
} from "@/lib/api";
import NoteField from "@/components/NoteField";
import { roleLabel } from "@/components/RolePicker";
import PersonAvatar from "@/components/team/PersonAvatar";
import { instantDate } from "@/components/team/dates";
import { BTN_PRIMARY_SM, INPUT, STATUS_GLYPH, Status } from "@/lib/tokens";

// Hidden for launch (PRELAUNCH_BACKLOG CUT-1): there is no IC experience yet,
// so inviting a report would only show them a placeholder page. The invite
// backend and /app/ic stay in place; flip this back on when the IC view ships.
const IC_INVITES_ENABLED = false;

const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  on_track: "On track",
  at_risk: "At risk",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function TeamPeople({
  members,
  setMembers,
  directReports,
  roleLevels,
  orgUnits,
  setupStatus,
  columns,
}: {
  members: TeamMember[];
  setMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>;
  directReports: DirectReport[];
  roleLevels: RoleLevel[];
  orgUnits: OrgUnit[];
  setupStatus: SetupStatus | null;
  columns: 1 | 2 | 3;
}) {
  const drById = new Map(directReports.map((dr) => [dr.id, dr]));
  const levelById = new Map(roleLevels.map((rl) => [rl.id, rl]));
  const unitById = new Map(orgUnits.map((ou) => [ou.id, ou]));
  const setupById = new Map((setupStatus?.people ?? []).map((p) => [p.id, p]));
  const grid = columns === 3 ? "grid-cols-3" : columns === 2 ? "grid-cols-2" : "grid-cols-1";

  return (
    <section id="team-people" aria-labelledby="team-people-heading" className="scroll-mt-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="team-people-heading" className="font-serif text-[1.6rem] font-normal leading-tight tracking-[-0.01em] text-ink">
          People <span className="font-sans text-xs tabular-nums text-ink-muted">· {members.length}</span>
        </h2>
        <span className="text-xs text-ink-muted">Your direct reports</span>
      </div>

      {members.length === 0 ? (
        <p className="py-4 text-sm text-ink-muted">
          No direct reports in this team.{" "}
          <Link href="/app/settings" className="text-brand hover:text-brand-hover">Add or assign people →</Link>
        </p>
      ) : (
        <div className={`grid ${grid} gap-px overflow-hidden rounded-lg border border-hairline bg-hairline`}>
          {members.map((m) => {
            const dr = drById.get(m.id);
            const level = dr?.role_level_id ? levelById.get(dr.role_level_id) : undefined;
            const unit = dr?.org_unit_id ? unitById.get(dr.org_unit_id) : undefined;
            // has_role (setup status) is the source of truth for the badge —
            // never recomputed here.
            const hasRole = setupById.get(m.id)?.has_role ?? false;
            return (
              <article key={m.id} className="bg-canvas px-5 py-5">
                <div className="flex items-center gap-3">
                  <PersonAvatar id={m.id} name={m.name} size="md" />
                  <div className="min-w-0">
                    <h3 className="truncate text-base text-ink" title={m.name}>{m.name}</h3>
                    {hasRole ? (
                      level && <p className="truncate text-xs text-ink-muted">{roleLabel(level)}</p>
                    ) : (
                      <span className="mt-0.5 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-2xs font-medium text-amber-700">No role</span>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-xs text-ink-muted">{unit ? unit.name : "No team assigned"}</p>
                <Link href={`/app/reports/${m.id}`} className="mt-2 inline-block text-sm text-brand hover:text-brand-hover">
                  Open Relationship Desk →
                </Link>
                <MemberDetails member={m} setMembers={setMembers} />
              </article>
            );
          })}
          {/* Fill the last row so the grid reads as one sheet, not a grey gap. */}
          {Array.from({ length: (columns - (members.length % columns)) % columns }).map((_, i) => (
            <div key={`fill-${i}`} className="bg-canvas" aria-hidden="true" />
          ))}
        </div>
      )}
    </section>
  );
}

function MemberDetails({
  member,
  setMembers,
}: {
  member: TeamMember;
  setMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>;
}) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<TeamMessage[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState(member.email ?? "");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSending, setInviteSending] = useState(false);

  useEffect(() => {
    if (!open || history !== null) return;
    getTeamMessages(member.id)
      .then(setHistory)
      .catch(() => {
        setHistory([]);
        setHistoryFailed(true);
      });
  }, [open, history, member.id]);

  async function submitMessage() {
    if (!draft.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const created = await sendTeamMessage(member.id, draft.trim());
      setHistory((h) => [created, ...(h ?? [])]);
      setMembers((ms) => ms.map((m) => (m.id === member.id ? { ...m, latest_message: created } : m)));
      setDraft("");
    } catch {
      setSendError("Couldn't save the update. Your text is still here.");
    } finally {
      setSending(false);
    }
  }

  async function submitInvite() {
    const email = inviteEmail.trim();
    if (!email || inviteSending) return;
    setInviteSending(true);
    setInviteError(null);
    try {
      const { invite_url } = await inviteDirectReport(member.id, email);
      setInviteUrl(invite_url);
      setMembers((ms) => ms.map((m) => (m.id === member.id ? { ...m, email } : m)));
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Failed to create invite");
    } finally {
      setInviteSending(false);
    }
  }

  const panelId = `team-details-${member.id}`;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-xs text-ink-secondary hover:text-ink"
      >
        <span aria-hidden="true" className="mr-1 inline-block w-2">{open ? "▾" : "▸"}</span>
        Team details &amp; access
      </button>

      {open && (
        <div id={panelId} className="mt-3 space-y-4 text-sm">
          <div>
            <p className="text-2xs uppercase tracking-[0.14em] text-ink-muted">Current work</p>
            {member.priorities.length === 0 && member.projects.length === 0 ? (
              <p className="mt-1 text-xs text-ink-muted">No active priorities or projects.</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {[...member.priorities.map((g) => ({ ...g, kind: "Priority" })), ...member.projects.map((p) => ({ ...p, kind: "Project" }))].map((w) => (
                  <li key={`${w.kind}-${w.id}`} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-ink-body" title={w.title}>
                      <span className="mr-1.5 text-2xs text-ink-muted">{w.kind}</span>
                      {w.title}
                    </span>
                    <span className={`shrink-0 text-2xs ${w.status === "at_risk" ? "text-amber-700" : "text-ink-muted"}`}>
                      <span aria-hidden="true">{STATUS_GLYPH[w.status as Status]} </span>
                      {STATUS_LABEL[w.status as Status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label htmlFor={`update-${member.id}`} className="text-2xs uppercase tracking-[0.14em] text-ink-muted">
              Private update record
            </label>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              Only you can see these — nothing is sent to {member.name}. Private notes and 1:1s live on the Relationship Desk.
            </p>
            <NoteField
              id={`update-${member.id}`}
              value={draft}
              onChange={setDraft}
              rows={2}
              className="mt-2 w-full text-sm"
              placeholder="Record a team update…"
            />
            {sendError && <p className="mt-1 text-xs text-amber-700">{sendError}</p>}
            <button type="button" onClick={submitMessage} disabled={sending || !draft.trim()} className={`${BTN_PRIMARY_SM} mt-2`}>
              {sending ? "Saving…" : "Save update"}
            </button>
            {history === null ? (
              <p className="mt-2 text-xs text-ink-muted">Loading earlier updates…</p>
            ) : historyFailed ? (
              <p className="mt-2 text-xs text-amber-700">Couldn&apos;t load earlier updates.</p>
            ) : history.length > 0 ? (
              <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1">
                {history.map((msg) => (
                  <li key={msg.id} className="text-xs text-ink-secondary">
                    <span className="text-ink-muted">{instantDate(msg.created_at)}</span> — {msg.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div>
            <p className="text-2xs uppercase tracking-[0.14em] text-ink-muted">Account access</p>
            {!IC_INVITES_ENABLED ? (
              <p className="mt-1 text-xs text-ink-muted">
                {member.user_id ? "Account linked." : "Reports can't sign in yet. Nothing on this page is visible to them."}
              </p>
            ) : member.user_id ? (
              <p className="mt-1 text-xs text-ink-secondary">Account linked — they can log in.</p>
            ) : inviting ? (
              <div className="mt-1">
                {inviteUrl ? (
                  <div>
                    <p className="text-xs text-ink-secondary">Share this link with them — it expires in 7 days. No email is sent.</p>
                    <div className="mt-1 flex items-center gap-2">
                      <input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} className={`${INPUT} truncate text-xs`} />
                      <button type="button" onClick={() => navigator.clipboard?.writeText(inviteUrl)} className="shrink-0 rounded-md border border-hairline px-2 py-1 text-xs text-ink-secondary hover:bg-surface">
                        Copy
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="their@email.com" className={`${INPUT} text-xs`} />
                    <button type="button" onClick={submitInvite} disabled={inviteSending || !inviteEmail.trim()} className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-xs text-on-brand disabled:opacity-50">
                      {inviteSending ? "Creating…" : "Create link"}
                    </button>
                  </div>
                )}
                {inviteError && <p className="mt-1 text-xs text-red-700">{inviteError}</p>}
              </div>
            ) : (
              <button type="button" onClick={() => setInviting(true)} className="mt-1 text-xs font-medium text-ink-secondary underline hover:text-ink-body">
                Invite to log in
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
