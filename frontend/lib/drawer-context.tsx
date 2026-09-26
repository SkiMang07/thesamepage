"use client";

// Scribe drawer state — Sessions 32–33 (S3: DB hydration + page context).
//
// Thread now persists to assistant_messages (DB) on the backend. On mount,
// the drawer hydrates by calling GET /api/assistant/thread. The React state
// is authoritative for in-session display; the DB is authoritative for
// cross-device / post-refresh continuity.
//
// pageContext: a human-readable label for the page the drawer is open over
// (e.g. "Jordan's direct report page"). Individual pages set this via
// setPageContext so the agent can resolve pronouns correctly. Cleared when
// the page is unmounted (set to null). Sent with every message but not stored.
//
// ask(prompt, ctx?): the in-page "Ask about …" launchers. Opens the drawer with
// the composer pre-filled (never sent — the manager reads and presses Send) and,
// optionally, a narrower context (one goal on the Goals board). That narrower
// context lasts until the drawer closes or the route changes, then the page's
// own context returns.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import {
  DraftEntity,
  AssistantPageContext,
  StoredMessage,
  clearAssistantThread,
  getAssistantThread,
} from "./api";

export type DrawerMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  // draft cards emitted with this assistant turn
  drafts?: DraftEntity[];
};

type DrawerContextType = {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  messages: DrawerMessage[];
  addTurn: (userText: string, assistantText: string, drafts: DraftEntity[]) => void;
  clearThread: () => Promise<void>;
  refreshThread: () => Promise<void>;
  // Page context — set by individual pages; read by ScribeDrawer
  pageContext: AssistantPageContext | null;
  setPageContext: (ctx: AssistantPageContext | null) => void;
  // In-page launchers: open with a pre-filled prompt (and optional context).
  ask: (prompt: string, ctx?: AssistantPageContext) => void;
  prefill: string | null;
  clearPrefill: () => void;
  hydrating: boolean;
};

const DrawerContext = createContext<DrawerContextType | null>(null);

function storedToDrawerMessages(rows: StoredMessage[]): DrawerMessage[] {
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    text: r.content,
    drafts: r.drafts ?? undefined,
  }));
}

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<DrawerMessage[]>([]);
  const [baseContext, setPageContext] = useState<AssistantPageContext | null>(null);
  const [askContext, setAskContext] = useState<AssistantPageContext | null>(null);
  const [prefill, setPrefill] = useState<string | null>(null);
  const pageContext = askContext ?? baseContext;
  const [hydrating, setHydrating] = useState(true);

  // Hydrate isOpen from sessionStorage once on mount.
  useEffect(() => {
    if (sessionStorage.getItem("scribe:open") === "true") setIsOpen(true);
  }, []);

  useEffect(() => {
    sessionStorage.setItem("scribe:open", String(isOpen));
  }, [isOpen]);

  const refreshThread = useCallback(async () => {
    const rows = await getAssistantThread();
    setMessages(storedToDrawerMessages(rows));
  }, []);

  // Hydrate thread from DB on mount.
  useEffect(() => {
    refreshThread()
      .catch(() => {
        // Hydration failure is non-fatal — the thread starts fresh in-session.
      })
      .finally(() => setHydrating(false));
  }, [refreshThread]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    setAskContext(null);
  }, []);
  const toggle = useCallback(() => {
    if (isOpen) setAskContext(null);
    setIsOpen(!isOpen);
  }, [isOpen]);

  // A launcher's narrower context belongs to the page it was asked from.
  const pathname = usePathname();
  useEffect(() => setAskContext(null), [pathname]);

  const ask = useCallback((prompt: string, ctx?: AssistantPageContext) => {
    setAskContext(ctx ?? null);
    setPrefill(prompt);
    setIsOpen(true);
  }, []);
  const clearPrefill = useCallback(() => setPrefill(null), []);

  const addTurn = useCallback(
    (userText: string, assistantText: string, drafts: DraftEntity[]) => {
      const replaced = new Set(
        drafts.map((draft) => draft.replaces_draft_id).filter((id): id is string => !!id),
      );
      setMessages((prev) => [
        ...prev.map((message) => ({
          ...message,
          drafts: message.drafts?.map((draft) =>
            draft.draft_id && replaced.has(draft.draft_id)
              ? { ...draft, status: "superseded" as const }
              : draft,
          ),
        })),
        { id: crypto.randomUUID(), role: "user", text: userText },
        { id: crypto.randomUUID(), role: "assistant", text: assistantText, drafts },
      ]);
    },
    [],
  );

  const clearThread = useCallback(async () => {
    await clearAssistantThread();
    setMessages([]);
  }, []);

  return (
    <DrawerContext.Provider
      value={{
        isOpen, toggle, open, close,
        messages, addTurn, clearThread, refreshThread,
        pageContext, setPageContext,
        ask, prefill, clearPrefill,
        hydrating,
      }}
    >
      {children}
    </DrawerContext.Provider>
  );
}

export function useDrawer() {
  const ctx = useContext(DrawerContext);
  if (!ctx) throw new Error("useDrawer must be inside DrawerProvider");
  return ctx;
}
