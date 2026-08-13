"use client";

// Scribe drawer — Sessions 32–33 (S3: thread persistence, page context,
// ambiguity chips, edit-in-card polish).
// Full spec in docs/AGENT_SCRIBE_SCOPING.md — Surface spec section.
//
// Confirm handlers call the SAME existing endpoints the forms use.
// The agent never writes; the confirm button does.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DraftEntity,
  GoalLevel,
  GoalStatus,
  ProjectStatus,
  createCommitment,
  createDirectReport,
  createGoal,
  createGoalCheckIn,
  createProject,
  createProjectCheckIn,
  deleteGoal,
  deleteProject,
  getProject,
  sendAssistantMessage,
  updateProject,
} from "@/lib/api";
import { DrawerMessage, useDrawer } from "@/lib/drawer-context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entityLabel(type: DraftEntity["entity_type"]) {
  return {
    project: "New project",
    goal: "New goal",
    link_project_goal: "Link project to goal",
    check_in: "Check-in",
    commitment: "New commitment",
    direct_report: "New direct report",
  }[type] ?? type;
}

function confirmLabel(type: DraftEntity["entity_type"]) {
  return {
    project: "Create project",
    goal: "Create goal",
    link_project_goal: "Link project",
    check_in: "Log check-in",
    commitment: "Add commitment",
    direct_report: "Add direct report",
  }[type] ?? "Confirm";
}

function goalLevelLabel(level: string) {
  return (
    { company: "Company", department: "Department", team: "Team", individual: "Individual" }[level] ??
    level
  );
}

function statusLabel(status: string) {
  return (
    { active: "Active", on_track: "On track", at_risk: "At risk", completed: "Completed", cancelled: "Cancelled" }[status] ??
    status
  );
}

// Human-readable page label sent to the backend as page context.
// Lets the agent resolve pronouns ("give him a commitment") correctly.
function pageLabel(pathname: string, drawerPageContext: string | null): string | undefined {
  // Individual pages may override via setPageContext (e.g. DR detail pages
  // that know the report's name).
  if (drawerPageContext) return drawerPageContext;
  // Generic path-based labels for common pages.
  if (pathname === "/app/dashboard") return "Mission Control (main dashboard)";
  if (pathname === "/app/goals") return "Goals page";
  if (pathname === "/app/projects") return "Projects page";
  if (pathname === "/app/team") return "Team page";
  if (pathname.startsWith("/app/reports/")) return "a direct report's page";
  if (pathname === "/app/assessments") return "Assessments page";
  if (pathname === "/app/capacity") return "Capacity page";
  if (pathname === "/app/context") return "Context (company knowledge) page";
  if (pathname === "/app/org") return "Org chart page";
  if (pathname === "/app/settings") return "Settings page";
  return undefined;
}

// ---------------------------------------------------------------------------
// Ambiguity chips — parse agent text for · delimited candidate options
// ---------------------------------------------------------------------------
//
// The agent asks for clarification with text like:
//   "Which goal? · Improve Onboarding Efficiency · Onboard 2 new AU Support Reps"
// This parser detects that pattern and extracts the options as quick-reply chips.

type ParsedText = { before: string; options: string[] } | null;

function parseCandidates(text: string): ParsedText {
  // Look for a question followed by · delimited items.
  // Pattern: "...question?\s*·\s*option1\s*·\s*option2..."
  const match = text.match(/^([\s\S]*\?)\s*·\s*([\s\S]+)$/m);
  if (!match) return null;
  const options = match[2].split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean);
  if (options.length < 2) return null;
  return { before: match[1].trim(), options };
}

// ---------------------------------------------------------------------------
// Draft field rendering — fills plain, resolved links green, missing muted
// ---------------------------------------------------------------------------

function Field({ label, value, linked }: { label: string; value: string | null | undefined; linked?: boolean }) {
  if (!value) {
    return (
      <div className="flex gap-2 text-sm">
        <span className="w-28 shrink-0 text-gray-400">{label}</span>
        <span className="text-gray-300 italic">none yet</span>
      </div>
    );
  }
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-28 shrink-0 text-gray-400">{label}</span>
      <span className={linked ? "font-medium text-green-700" : "text-gray-800"}>{value}</span>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "date" | "number";
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-28 shrink-0 text-gray-400">{label}</span>
      <input
        type={type}
        className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DraftCard
// ---------------------------------------------------------------------------

type ReceiptData = {
  label: string;
  href?: string;
  entityId: string;
  entityType: DraftEntity["entity_type"];
};

type DraftCardState = "idle" | "editing" | "confirming" | "confirmed" | "discarded";

function DraftCard({ draft }: { draft: DraftEntity }) {
  const [cardState, setCardState] = useState<DraftCardState>("idle");
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoSeconds, setUndoSeconds] = useState<number | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Edit fields — keyed by field name, initialized from payload on edit open
  const [editFields, setEditFields] = useState<Record<string, string>>({});

  function openEdit() {
    const p = draft.payload as Record<string, unknown>;
    setEditFields({
      title: String(p.title ?? ""),
      description: String(p.description ?? ""),
      due_date: String(p.due_date ?? ""),
      note: String(p.note ?? ""),
      success_metrics: String(p.success_metrics ?? ""),
      progress: String(p.progress ?? ""),
    });
    setCardState("editing");
  }

  function cancelEdit() {
    setCardState("idle");
  }

  // Merge edit fields back into the draft payload for confirm
  function mergedPayload(): Record<string, unknown> {
    const base = { ...draft.payload } as Record<string, unknown>;
    if (cardState === "editing") {
      if (editFields.title) base.title = editFields.title;
      if (editFields.description !== undefined && editFields.description !== "undefined")
        base.description = editFields.description || null;
      if (editFields.due_date !== undefined && editFields.due_date !== "undefined")
        base.due_date = editFields.due_date || null;
      if (editFields.note !== undefined && editFields.note !== "undefined")
        base.note = editFields.note || null;
      if (editFields.success_metrics !== undefined && editFields.success_metrics !== "undefined")
        base.success_metrics = editFields.success_metrics || null;
      if (editFields.progress !== "" && editFields.progress !== "undefined") {
        const pct = parseInt(editFields.progress, 10);
        if (!isNaN(pct)) base.progress = pct;
      }
    }
    return base;
  }

  function startUndoTimer(undoFn: () => Promise<void>) {
    setUndoSeconds(30);
    const interval = setInterval(() => {
      setUndoSeconds((s) => {
        if (s === null || s <= 1) {
          clearInterval(interval);
          return null;
        }
        return s - 1;
      });
    }, 1000);
    undoTimerRef.current = interval;
    return () => {
      clearInterval(interval);
      undoTimerRef.current = null;
    };
  }

  async function handleUndo(entityId: string) {
    if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    setUndoSeconds(null);
    try {
      if (draft.entity_type === "project") await deleteProject(entityId);
      else if (draft.entity_type === "goal") await deleteGoal(entityId);
    } catch {
      // best-effort
    }
    setCardState("discarded");
  }

  async function handleConfirm() {
    setError(null);
    setCardState("confirming");
    const p = mergedPayload();

    try {
      let rec: ReceiptData;

      switch (draft.entity_type) {
        case "project": {
          const { owner_id: _oid, ...projectFields } = p as Record<string, unknown> & { owner_id?: unknown };
          const created = await createProject({
            title: String(projectFields.title ?? ""),
            description: (projectFields.description as string | null) ?? null,
            status: ((projectFields.status as string) || "active") as ProjectStatus,
            due_date: (projectFields.due_date as string | null) ?? null,
            direct_report_id: (projectFields.direct_report_id as string | null) ?? null,
            goal_id: (projectFields.goal_id as string | null) ?? null,
          });
          rec = { label: `Project "${created.title}" created`, href: "/app/projects", entityId: created.id, entityType: "project" };
          break;
        }

        case "goal": {
          const created = await createGoal({
            title: String(p.title ?? ""),
            level: p.level as GoalLevel,
            description: (p.description as string | null) ?? null,
            success_metrics: (p.success_metrics as string | null) ?? null,
            due_date: (p.due_date as string | null) ?? null,
            direct_report_id: (p.direct_report_id as string | null) ?? null,
            org_unit_id: (p.org_unit_id as string | null) ?? null,
          });
          rec = { label: `Goal "${created.title}" created`, href: "/app/goals", entityId: created.id, entityType: "goal" };
          break;
        }

        case "link_project_goal": {
          const projectId = String(p.project_id ?? "");
          const goalId = String(p.goal_id ?? "");
          const existing = await getProject(projectId);
          const updated = await updateProject(projectId, {
            title: existing.title,
            description: existing.description,
            status: existing.status,
            due_date: existing.due_date,
            direct_report_id: existing.direct_report_id,
            goal_id: goalId,
          });
          rec = { label: `Project linked to goal`, href: "/app/projects", entityId: updated.id, entityType: "link_project_goal" };
          break;
        }

        case "check_in": {
          const goalId = p.goal_id as string | null;
          const projectId = p.project_id as string | null;
          const checkInBody = {
            status: p.status as GoalStatus,
            progress: p.progress as number | null | undefined,
            note: (p.note as string | null) ?? null,
          };
          if (goalId) {
            await createGoalCheckIn(goalId, checkInBody);
          } else if (projectId) {
            await createProjectCheckIn(projectId, checkInBody);
          } else {
            throw new Error("No goal or project id in check-in draft");
          }
          const parentTitle = (draft.display?.parent_title) ?? "record";
          rec = { label: `Check-in logged on "${parentTitle}"`, entityId: goalId ?? projectId ?? "", entityType: "check_in" };
          break;
        }

        case "commitment": {
          const created = await createCommitment({
            description: String(p.description ?? ""),
            direct_report_id: String(p.direct_report_id ?? ""),
            committed_by: (p.committed_by as "direct_report" | "manager") ?? "direct_report",
            due_date: (p.due_date as string | null) ?? null,
            is_team_commitment: (p.is_team_commitment as boolean) ?? false,
          });
          const assignee = draft.display?.assignee_name ?? "report";
          rec = { label: `Commitment added for ${assignee}`, entityId: created.id, entityType: "commitment" };
          break;
        }

        case "direct_report": {
          const created = await createDirectReport({
            name: String(p.name ?? ""),
            role_title: (p.role_title as string | null) ?? undefined,
          });
          rec = { label: `${created.name} added`, href: `/app/reports/${created.id}`, entityId: created.id, entityType: "direct_report" };
          break;
        }

        default:
          throw new Error(`Unsupported entity type: ${draft.entity_type}`);
      }

      setReceipt(rec);
      setCardState("confirmed");

      // Start undo timer for reversible actions
      if (draft.entity_type === "project" || draft.entity_type === "goal") {
        startUndoTimer(async () => handleUndo(rec.entityId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setCardState("idle");
    }
  }

  if (cardState === "discarded") return null;

  // Receipt view
  if (cardState === "confirmed" && receipt) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-sm font-medium text-green-800">
            <span className="text-green-600">✓</span>
            {receipt.label}
          </span>
          <div className="flex items-center gap-2">
            {receipt.href && (
              <Link
                href={receipt.href}
                className="text-xs text-green-700 underline hover:text-green-900"
              >
                View →
              </Link>
            )}
            {undoSeconds !== null && (
              <button
                onClick={() => handleUndo(receipt.entityId)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Undo ({undoSeconds}s)
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const p = draft.payload as Record<string, unknown>;
  const d = draft.display ?? {};
  const isLoading = cardState === "confirming";

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {/* Card header */}
      <div className="flex items-center justify-between gap-2 rounded-t-lg border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <span className="text-sm font-medium text-gray-700">{entityLabel(draft.entity_type)}</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          Draft — not saved
        </span>
      </div>

      {/* Fields */}
      <div className="space-y-2 px-4 py-3">
        {error && <p className="text-xs text-red-600">{error}</p>}

        {/* === PROJECT === */}
        {draft.entity_type === "project" && (
          <>
            {cardState === "editing" ? (
              <>
                <EditField label="Title" value={editFields.title} onChange={(v) => setEditFields((f) => ({ ...f, title: v }))} />
                <EditField label="Due date" value={editFields.due_date} onChange={(v) => setEditFields((f) => ({ ...f, due_date: v }))} type="date" />
                <EditField label="Description" value={editFields.description} onChange={(v) => setEditFields((f) => ({ ...f, description: v }))} />
              </>
            ) : (
              <>
                <Field label="Title" value={String(p.title ?? "")} />
                <Field label="Linked goal" value={d.goal_title} linked={!!d.goal_title} />
                <Field label="Assignee" value={d.assignee_name} linked={!!d.assignee_name} />
                <Field label="Due date" value={p.due_date as string | null} />
                <Field label="Description" value={p.description as string | null} />
                <Field label="Status" value="Active" />
              </>
            )}
          </>
        )}

        {/* === GOAL === */}
        {draft.entity_type === "goal" && (
          <>
            {cardState === "editing" ? (
              <>
                <EditField label="Title" value={editFields.title} onChange={(v) => setEditFields((f) => ({ ...f, title: v }))} />
                <EditField label="Due date" value={editFields.due_date} onChange={(v) => setEditFields((f) => ({ ...f, due_date: v }))} type="date" />
                <EditField label="Success metric" value={editFields.success_metrics} onChange={(v) => setEditFields((f) => ({ ...f, success_metrics: v }))} />
              </>
            ) : (
              <>
                <Field label="Title" value={String(p.title ?? "")} />
                <Field label="Level" value={goalLevelLabel(String(p.level ?? ""))} />
                <Field label="Due date" value={p.due_date as string | null} />
                <Field label="Success metric" value={p.success_metrics as string | null} />
                <Field label="Assignee" value={d.assignee_name} linked={!!d.assignee_name} />
              </>
            )}
          </>
        )}

        {/* === LINK PROJECT ↔ GOAL === */}
        {draft.entity_type === "link_project_goal" && (
          <>
            <Field label="Project" value={d.project_title} linked />
            <Field label="Goal" value={d.goal_title} linked />
          </>
        )}

        {/* === CHECK-IN === */}
        {draft.entity_type === "check_in" && (
          <>
            {cardState === "editing" ? (
              <>
                <EditField label="Note" value={editFields.note} onChange={(v) => setEditFields((f) => ({ ...f, note: v }))} />
                <EditField label="Progress %" value={editFields.progress} onChange={(v) => setEditFields((f) => ({ ...f, progress: v }))} type="number" />
              </>
            ) : (
              <>
                <Field label="On" value={d.parent_title} linked={!!d.parent_title} />
                <Field label="Status" value={statusLabel(String(p.status ?? ""))} />
                <Field label="Progress" value={p.progress != null ? `${p.progress}%` : null} />
                <Field label="Note" value={p.note as string | null} />
              </>
            )}
          </>
        )}

        {/* === COMMITMENT === */}
        {draft.entity_type === "commitment" && (
          <>
            {cardState === "editing" ? (
              <>
                {/* description field — commitment text (not title) */}
                <EditField
                  label="Description"
                  value={editFields.description}
                  onChange={(v) => setEditFields((f) => ({ ...f, description: v }))}
                />
                <EditField
                  label="Due date"
                  value={editFields.due_date}
                  onChange={(v) => setEditFields((f) => ({ ...f, due_date: v }))}
                  type="date"
                />
              </>
            ) : (
              <>
                <Field label="What" value={String(p.description ?? "")} />
                <Field label="Who owes it" value={d.assignee_name} linked={!!d.assignee_name} />
                <Field label="Committed by" value={p.committed_by === "manager" ? "Manager" : "Direct report"} />
                <Field label="Due date" value={p.due_date as string | null} />
              </>
            )}
          </>
        )}

        {/* === DIRECT REPORT === */}
        {draft.entity_type === "direct_report" && (
          <>
            {cardState === "editing" ? (
              <>
                <EditField label="Name" value={editFields.title} onChange={(v) => setEditFields((f) => ({ ...f, title: v }))} />
              </>
            ) : (
              <>
                <Field label="Name" value={String(p.name ?? "")} />
                <Field label="Role title" value={p.role_title as string | null} />
              </>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 rounded-b-lg border-t border-gray-100 bg-gray-50 px-4 py-2.5">
        {cardState === "editing" ? (
          <>
            <button
              onClick={handleConfirm}
              disabled={isLoading}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 hover:bg-gray-800"
            >
              {confirmLabel(draft.entity_type)}
            </button>
            <button
              onClick={cancelEdit}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleConfirm}
              disabled={isLoading}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 hover:bg-gray-800"
            >
              {isLoading ? "Saving…" : confirmLabel(draft.entity_type)}
            </button>
            <button
              onClick={openEdit}
              disabled={isLoading}
              className="text-xs text-gray-600 hover:text-gray-900"
            >
              Edit details
            </button>
            <button
              onClick={() => setCardState("discarded")}
              disabled={isLoading}
              className="ml-auto text-xs text-gray-400 hover:text-gray-600"
            >
              Discard
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble — renders one message + its draft cards + ambiguity chips
// ---------------------------------------------------------------------------

function MessageBubble({
  msg,
  onQuickReply,
}: {
  msg: DrawerMessage;
  onQuickReply: (text: string) => void;
}) {
  const isUser = msg.role === "user";
  const parsed = !isUser ? parseCandidates(msg.text) : null;

  return (
    <div className={`flex flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser
            ? "bg-gray-900 text-white"
            : "bg-gray-100 text-gray-800"
        }`}
      >
        {parsed ? parsed.before : msg.text}
      </div>

      {/* Ambiguity candidate chips — tappable quick-reply buttons */}
      {parsed && parsed.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-w-[90%]">
          {parsed.options.map((opt) => (
            <button
              key={opt}
              onClick={() => onQuickReply(opt)}
              className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 hover:border-gray-500 hover:bg-gray-50 active:bg-gray-100"
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* Draft cards below the assistant bubble */}
      {msg.drafts && msg.drafts.length > 0 && (
        <div className="w-full space-y-3">
          {msg.drafts.map((draft, i) => (
            <DraftCard key={i} draft={draft} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScribeDrawer — the full panel (thread + composer)
// ---------------------------------------------------------------------------

export default function ScribeDrawer() {
  const { isOpen, close, messages, addTurn, pageContext, hydrating } = useDrawer();
  const pathname = usePathname();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Auto-focus composer when drawer opens
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => composerRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Scroll to the bottom of the thread on new messages
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Resolve page context: drawer context override takes priority, then path label
  const currentPageContext = pageLabel(pathname, pageContext) ?? undefined;

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    if (!text) setInput("");
    setSendError(null);
    setSending(true);
    try {
      const resp = await sendAssistantMessage(msg, currentPageContext);
      addTurn(msg, resp.text, resp.drafts ?? []);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to send");
      if (!text) setInput(msg);
    } finally {
      setSending(false);
    }
  }, [input, sending, addTurn, currentPageContext]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-gray-900">✦</span>
          <span className="text-sm font-medium text-gray-700">The Same Page</span>
        </div>
        <button
          onClick={close}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Thread */}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {hydrating && (
          <p className="mt-8 text-center text-xs text-gray-400">Loading…</p>
        )}
        {!hydrating && messages.length === 0 && (
          <div className="mt-8 text-center text-sm text-gray-400">
            <p className="font-medium text-gray-500">Tell me what&apos;s happening.</p>
            <p className="mt-1">I&apos;ll keep the pages up to date.</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} onQuickReply={(t) => handleSend(t)} />
        ))}
        <div ref={threadEndRef} />
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-3">
        {sendError && <p className="mb-2 text-xs text-red-600">{sendError}</p>}
        <textarea
          ref={composerRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          rows={3}
          placeholder="Tell me what's happening — I'll keep the pages up to date."
          className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-gray-400 focus:outline-none disabled:opacity-50"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-gray-400">⌘J · Nothing saves until you confirm.</p>
          <button
            onClick={() => handleSend()}
            disabled={sending || !input.trim()}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 hover:bg-gray-800"
          >
            {sending ? "Thinking…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
