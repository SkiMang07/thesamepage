// All calls to the FastAPI backend go through here — same convention as
// Prism Tree's frontend/src/lib/api.ts. Add new backend calls to this file
// rather than calling fetch() ad hoc from components.
import { createClient } from "./supabase";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

async function authedFetch(path: string, options: RequestInit = {}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DirectReport = {
  id: string;
  name: string;
  role_title: string | null;
  notes: string | null;
};

export type OneOnOne = {
  id: string;
  direct_report_id: string;
  summary: string;
  created_at: string;
};

export type Commitment = {
  id: string;
  description: string;
  due_date: string | null;
  status: "open" | "done";
};

export type AgendaItem = {
  title: string;
  rationale: string;
  suggested_questions: string[];
};

export type PrepResponse = {
  situation_summary: string;
  agenda_items: AgendaItem[];
  open_commitments_to_check: Commitment[];
};

// ---------------------------------------------------------------------------
// Direct reports
// ---------------------------------------------------------------------------

export const getDirectReports = (): Promise<DirectReport[]> =>
  authedFetch("/api/direct-reports");

export const getDirectReport = (id: string): Promise<DirectReport> =>
  authedFetch(`/api/direct-reports/${id}`);

export const createDirectReport = (body: { name: string; role_title?: string; notes?: string }): Promise<DirectReport> =>
  authedFetch("/api/direct-reports", { method: "POST", body: JSON.stringify(body) });

// ---------------------------------------------------------------------------
// 1:1s
// ---------------------------------------------------------------------------

export const getOneOnOneHistory = (directReportId: string): Promise<OneOnOne[]> =>
  authedFetch(`/api/one-on-ones/${directReportId}/history`);

export const prepOneOnOne = (body: { direct_report_id: string; raw_notes: string }): Promise<PrepResponse> =>
  authedFetch("/api/one-on-ones/prep", { method: "POST", body: JSON.stringify(body) });

export const logOneOnOne = (body: { direct_report_id: string; summary: string; new_commitments?: string[] }): Promise<OneOnOne> =>
  authedFetch("/api/one-on-ones", { method: "POST", body: JSON.stringify(body) });
