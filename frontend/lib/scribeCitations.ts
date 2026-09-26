// Scribe citations (C2). The backend (backend/scribe_citations.py) returns
// Scribe's reply with every record it names written as [[type:id|Name]],
// already checked against the ids its read tools returned — so a marker here
// is always a real, manager-visible record. This file turns the text into
// plain segments and chips, and builds each chip's route from type + id.
import { useEffect, useRef } from "react";

export type CitationType = "person" | "goal" | "project" | "org_unit" | "document";

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "cite"; type: CitationType; id: string; label: string; href: string };

const MARKER = /\[\[([a-z_]+):([A-Za-z0-9-]{1,64})\|([^\]\n]{1,160})\]\]/g;

export function citationHref(type: string, id: string): string | null {
  const q = encodeURIComponent(id);
  switch (type) {
    case "person":
      return `/app/reports/${q}`;
    case "goal":
      return `/app/goals?goal=${q}`;
    case "project":
      return `/app/projects?project=${q}`;
    case "org_unit":
      return "/app/org";
    case "document":
      return "/app/context";
    default:
      return null;
  }
}

export function parseCitations(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKER)) {
    const [whole, type, id, label] = m;
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    const href = citationHref(type, id);
    out.push(href ? { kind: "cite", type: type as CitationType, id, label: label.trim(), href } : { kind: "text", text: label });
    last = start + whole.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  // Merge neighbouring text so callers get the fewest nodes.
  return out.reduce<Segment[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    if (s.kind === "text" && prev?.kind === "text") prev.text += s.text;
    else acc.push({ ...s });
    return acc;
  }, []);
}

/** Label-only text, for quick-reply options and anywhere chips don't fit. */
export function stripCitations(text: string): string {
  return parseCitations(text).map((s) => (s.kind === "text" ? s.text : s.label)).join("");
}

// A chip whose record lives on the page already open can't rely on a route
// change (the page reads its ?goal= / ?project= only on load), so it sends
// this event and the page opens the record through its own unsaved-edits guard.
export const OPEN_RECORD_EVENT = "tsp:open-record";
export type OpenRecordDetail = { type: CitationType; id: string };

export function requestOpenRecord(detail: OpenRecordDetail) {
  window.dispatchEvent(new CustomEvent<OpenRecordDetail>(OPEN_RECORD_EVENT, { detail }));
}

export function useOpenRecord(type: CitationType, handler: (id: string) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<OpenRecordDetail>).detail;
      if (d?.type === type && d.id) latest.current(d.id);
    };
    window.addEventListener(OPEN_RECORD_EVENT, on);
    return () => window.removeEventListener(OPEN_RECORD_EVENT, on);
  }, [type]);
}
