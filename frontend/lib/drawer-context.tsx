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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { DraftEntity, StoredMessage, getAssistantThread } from "./api";

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
  clearThread: () => void;
  // Page context — set by individual pages; read by ScribeDrawer
  pageContext: string | null;
  setPageContext: (ctx: string | null) => void;
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
  const [pageContext, setPageContext] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(true);

  // Hydrate isOpen from sessionStorage once on mount.
  useEffect(() => {
    if (sessionStorage.getItem("scribe:open") === "true") setIsOpen(true);
  }, []);

  useEffect(() => {
    sessionStorage.setItem("scribe:open", String(isOpen));
  }, [isOpen]);

  // Hydrate thread from DB on mount.
  useEffect(() => {
    getAssistantThread()
      .then((rows) => {
        if (rows.length > 0) setMessages(storedToDrawerMessages(rows));
      })
      .catch(() => {
        // Hydration failure is non-fatal — the thread starts fresh in-session.
      })
      .finally(() => setHydrating(false));
  }, []);

  const toggle = useCallback(() => setIsOpen((s) => !s), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const addTurn = useCallback(
    (userText: string, assistantText: string, drafts: DraftEntity[]) => {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", text: userText },
        { id: crypto.randomUUID(), role: "assistant", text: assistantText, drafts },
      ]);
    },
    [],
  );

  const clearThread = useCallback(() => setMessages([]), []);

  return (
    <DrawerContext.Provider
      value={{
        isOpen, toggle, open, close,
        messages, addTurn, clearThread,
        pageContext, setPageContext,
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
