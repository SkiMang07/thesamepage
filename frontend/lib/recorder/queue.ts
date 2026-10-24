// ---------------------------------------------------------------------------
// The call recorder's on-device queue (CALL_TRANSCRIPTION_SCOPING §6, §13).
//
// Audio waits here, in the manager's own browser, until the server confirms
// it, then it is deleted. Nothing in this file decides what is recorded; the
// engine (browserEngine.ts) hands it finished segments and 1-second chunks.
//
// IndexedDB "tsp-recorder", three stores:
//   chunks       [transcriptId, track, seq, idx]  each 1-second recorder chunk
//                as it arrives, so a reload or a crash loses about a second
//                instead of up to three minutes. Deleted when the segment
//                closes; leftovers are stitched into a segment on recovery.
//   segments     [transcriptId, track, seq]  a closed segment waiting to send:
//                the blob, offset_ms, duration_ms, attempts, next retry time.
//   transcripts  transcriptId  every seq queued per track (what End must
//                list in seqs_by_track, across reloads), the last seq, and the
//                minutes captured so far (for the 2-hour stop).
//
// If IndexedDB can't be opened (blocked storage), the same shapes live in
// memory: the call still transcribes, it just can't survive a reload.
//
// The uploader sends oldest first, one at a time, and only in one tab at a
// time (Web Locks). A segment is deleted on success or on a "duplicate"
// reply. Network errors and 5xx retry with backoff for up to 24 hours;
// permanent refusals drop the segment (§13).
// ---------------------------------------------------------------------------

import { ApiError, callTranscriptRefusal, uploadCallSegment, type CallTrack } from "@/lib/api";
import type { SeqsByTrack } from "./types";

export type ChunkRow = {
  transcriptId: string;
  track: CallTrack;
  seq: number;
  idx: number;
  /** Segment start, ms since the transcript's started_at. */
  offsetMs: number;
  /** When this chunk arrived, ms since started_at. */
  endMs: number;
  /** Epoch ms written, so recovery can tell a live recording from a dead one. */
  writtenAt: number;
  mime: string;
  vocabulary: string;
  blob: Blob;
};

export type SegmentRow = {
  transcriptId: string;
  track: CallTrack;
  seq: number;
  offsetMs: number;
  durationMs: number;
  mime: string;
  vocabulary: string;
  blob: Blob;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
};

export type TranscriptMeta = {
  transcriptId: string;
  seqsByTrack: SeqsByTrack;
  lastSeq: number;
  /** Time the recorders were open, excluding pauses: the 2-hour clock. */
  capturedMs: number;
  updatedAt: number;
};

const DB_NAME = "tsp-recorder";
const DB_VERSION = 1;
const RETRY_FOR_MS = 24 * 60 * 60 * 1000;
const META_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** A chunk group untouched this long belongs to a page that is gone. */
const ORPHAN_AFTER_MS = 30_000;
const UPLOAD_LOCK = "tsp-recorder-upload";
const LIVE_LOCK_PREFIX = "tsp-recorder-live:";

// ── storage: IndexedDB, or memory when that's unavailable ─────────────────

type StoreName = "chunks" | "segments" | "transcripts";

interface Backend {
  put(store: StoreName, value: unknown): Promise<void>;
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  all<T>(store: StoreName): Promise<T[]>;
  del(store: StoreName, key: IDBValidKey): Promise<void>;
  /** Several writes that land together or not at all. */
  batch(ops: { store: StoreName; put?: unknown; del?: IDBValidKey }[]): Promise<void>;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
  });
}

function idbBackend(db: IDBDatabase): Backend {
  return {
    async put(store, value) {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      await txDone(tx);
    },
    async get<T>(store: StoreName, key: IDBValidKey) {
      return (await req(db.transaction(store).objectStore(store).get(key))) as T | undefined;
    },
    async all<T>(store: StoreName) {
      return (await req(db.transaction(store).objectStore(store).getAll())) as T[];
    },
    async del(store, key) {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      await txDone(tx);
    },
    async batch(ops) {
      if (!ops.length) return;
      const names = Array.from(new Set(ops.map((o) => o.store)));
      const tx = db.transaction(names, "readwrite");
      for (const op of ops) {
        const s = tx.objectStore(op.store);
        if (op.put !== undefined) s.put(op.put);
        if (op.del !== undefined) s.delete(op.del);
      }
      await txDone(tx);
    },
  };
}

const KEYS: Record<StoreName, string[]> = {
  chunks: ["transcriptId", "track", "seq", "idx"],
  segments: ["transcriptId", "track", "seq"],
  transcripts: ["transcriptId"],
};

function keyOf(store: StoreName, value: Record<string, unknown>): string {
  return JSON.stringify(KEYS[store].map((k) => value[k]));
}

function memoryBackend(): Backend {
  const maps: Record<StoreName, Map<string, unknown>> = {
    chunks: new Map(),
    segments: new Map(),
    transcripts: new Map(),
  };
  const k = (key: IDBValidKey) => JSON.stringify(Array.isArray(key) ? key : [key]);
  const b: Backend = {
    async put(store, value) {
      maps[store].set(keyOf(store, value as Record<string, unknown>), value);
    },
    async get<T>(store: StoreName, key: IDBValidKey) {
      return maps[store].get(k(key)) as T | undefined;
    },
    async all<T>(store: StoreName) {
      return Array.from(maps[store].values()) as T[];
    },
    async del(store, key) {
      maps[store].delete(k(key));
    },
    async batch(ops) {
      for (const op of ops) {
        if (op.put !== undefined) await b.put(op.store, op.put);
        if (op.del !== undefined) await b.del(op.store, op.del);
      }
    },
  };
  return b;
}

let backendPromise: Promise<Backend> | null = null;

function backend(): Promise<Backend> {
  if (backendPromise) return backendPromise;
  backendPromise = new Promise<Backend>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(memoryBackend());
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: KEYS.chunks });
        if (!db.objectStoreNames.contains("segments")) db.createObjectStore("segments", { keyPath: KEYS.segments });
        if (!db.objectStoreNames.contains("transcripts")) db.createObjectStore("transcripts", { keyPath: "transcriptId" });
      };
      open.onsuccess = () => resolve(idbBackend(open.result));
      open.onerror = () => resolve(memoryBackend());
      open.onblocked = () => resolve(memoryBackend());
    } catch {
      resolve(memoryBackend());
    }
  });
  return backendPromise;
}

// ── meta ──────────────────────────────────────────────────────────────────

export async function readMeta(transcriptId: string): Promise<TranscriptMeta> {
  try {
    const found = await (await backend()).get<TranscriptMeta>("transcripts", transcriptId);
    if (found) return found;
  } catch {
    /* fall through to a fresh record */
  }
  return { transcriptId, seqsByTrack: {}, lastSeq: -1, capturedMs: 0, updatedAt: Date.now() };
}

function withSeq(meta: TranscriptMeta, track: CallTrack, seq: number): TranscriptMeta {
  const seqs = new Set(meta.seqsByTrack[track] ?? []);
  seqs.add(seq);
  return {
    ...meta,
    seqsByTrack: { ...meta.seqsByTrack, [track]: Array.from(seqs).sort((a, b) => a - b) },
    lastSeq: Math.max(meta.lastSeq, seq),
    updatedAt: Date.now(),
  };
}

// ── what the engine calls ─────────────────────────────────────────────────

export async function putChunk(row: ChunkRow): Promise<void> {
  try {
    await (await backend()).put("chunks", row);
  } catch {
    /* a lost chunk only matters after a crash; the segment itself is held in memory */
  }
}

/** A closed segment: queue it (or skip it if `blob` is null) and clear its chunks. */
export async function closeSegment(args: {
  transcriptId: string;
  track: CallTrack;
  seq: number;
  chunkCount: number;
  segment: Omit<SegmentRow, "createdAt" | "attempts" | "nextAttemptAt"> | null;
  capturedMs: number;
}): Promise<void> {
  const b = await backend();
  let meta = await readMeta(args.transcriptId);
  meta = { ...meta, lastSeq: Math.max(meta.lastSeq, args.seq), capturedMs: Math.max(meta.capturedMs, args.capturedMs), updatedAt: Date.now() };
  const ops: { store: StoreName; put?: unknown; del?: IDBValidKey }[] = [];
  if (args.segment) {
    const now = Date.now();
    ops.push({ store: "segments", put: { ...args.segment, createdAt: now, attempts: 0, nextAttemptAt: now } satisfies SegmentRow });
    meta = withSeq(meta, args.track, args.seq);
  }
  ops.push({ store: "transcripts", put: meta });
  for (let i = 0; i < args.chunkCount; i++) ops.push({ store: "chunks", del: [args.transcriptId, args.track, args.seq, i] });
  try {
    await b.batch(ops);
  } catch {
    // IndexedDB failed mid-call (quota, eviction). Keep the segment in memory
    // rather than lose it.
    const mem = memoryBackend();
    backendPromise = Promise.resolve(mem);
    await mem.batch(ops.filter((o) => o.put !== undefined));
  }
}

export async function seqsFor(transcriptId: string): Promise<SeqsByTrack> {
  const meta = await readMeta(transcriptId);
  const out: SeqsByTrack = {};
  for (const [track, seqs] of Object.entries(meta.seqsByTrack)) {
    if (seqs && seqs.length) out[track as CallTrack] = [...seqs];
  }
  return out;
}

/** Turn leftover chunks into segments. `transcriptId` set: only that call,
 *  regardless of age (the engine owns it and the old page is gone). Unset:
 *  any call whose chunks have gone quiet and that no tab is recording. */
export async function recoverChunks(transcriptId?: string): Promise<number> {
  let b: Backend;
  let chunks: ChunkRow[];
  try {
    b = await backend();
    chunks = await b.all<ChunkRow>("chunks");
  } catch {
    return 0;
  }
  if (!chunks.length) return 0;

  const live = await liveTranscripts();
  const groups = new Map<string, ChunkRow[]>();
  for (const c of chunks) {
    if (transcriptId ? c.transcriptId !== transcriptId : live.has(c.transcriptId)) continue;
    const key = JSON.stringify([c.transcriptId, c.track, c.seq]);
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  let recovered = 0;
  const now = Date.now();
  for (const list of Array.from(groups.values())) {
    list.sort((a, b2) => a.idx - b2.idx);
    const last = list[list.length - 1];
    if (!transcriptId && now - last.writtenAt < ORPHAN_AFTER_MS) continue;
    const first = list[0];
    const durationMs = last.endMs - first.offsetMs;
    const blob = new Blob(list.map((c) => c.blob), { type: first.mime });
    // The first chunk carries the container header; without it the rest is
    // undecodable. Under a second isn't worth a transcription call.
    const usable = first.idx === 0 && durationMs >= 1000 && blob.size > 0;
    await closeSegment({
      transcriptId: first.transcriptId,
      track: first.track,
      seq: first.seq,
      chunkCount: last.idx + 1,
      capturedMs: 0,
      segment: usable
        ? {
            transcriptId: first.transcriptId,
            track: first.track,
            seq: first.seq,
            offsetMs: first.offsetMs,
            durationMs: Math.min(durationMs, 600_000),
            mime: first.mime,
            vocabulary: first.vocabulary,
            blob,
          }
        : null,
    });
    if (usable) recovered += 1;
  }
  return recovered;
}

// ── locks: one recorder per call, one uploader per browser ────────────────

type LockManagerLike = {
  request: (name: string, opts: { ifAvailable?: boolean }, cb: (lock: unknown) => Promise<unknown> | unknown) => Promise<unknown>;
  query?: () => Promise<{ held?: { name?: string }[] }>;
};

function locks(): LockManagerLike | null {
  const l = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined;
  return l && typeof l.request === "function" ? l : null;
}

async function liveTranscripts(): Promise<Set<string>> {
  const l = locks();
  const out = new Set<string>();
  if (!l?.query) return out;
  try {
    const { held } = await l.query();
    for (const lock of held ?? []) {
      if (lock.name?.startsWith(LIVE_LOCK_PREFIX)) out.add(lock.name.slice(LIVE_LOCK_PREFIX.length));
    }
  } catch {
    /* no query support: fall back to chunk age alone */
  }
  return out;
}

/** Claim "this tab is recording this call". Resolves to a release function,
 *  or null if another tab already holds it. Without Web Locks, always claims. */
export function claimLive(transcriptId: string): Promise<(() => void) | null> {
  const l = locks();
  if (!l) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    l.request(LIVE_LOCK_PREFIX + transcriptId, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return;
      }
      return new Promise<void>((release) => resolve(() => release()));
    }).catch(() => resolve(() => {}));
  });
}

// ── uploader ──────────────────────────────────────────────────────────────

type Outcome = "sent" | "retry" | "drop" | "max_length";

function classify(err: unknown): Outcome {
  if (!(err instanceof ApiError)) return "retry"; // network: offline, DNS, reset
  const s = err.status;
  if (s === 409 && callTranscriptRefusal(err)?.code === "max_length") return "max_length";
  // 401: the session is refreshing. 402: read-only, may clear. 408/425/429: wait.
  if (s === 401 || s === 402 || s === 408 || s === 425 || s === 429 || s >= 500) return "retry";
  return "drop"; // 403, 404 (deleted), 413, 415, 422 and the rest won't change on retry
}

function backoff(attempts: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempts, 10));
}

let flushing = false;
let again = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const maxLengthListeners = new Set<(transcriptId: string) => void>();

/** The engine listens for the server's 2-hour refusal. */
export function onMaxLength(listener: (transcriptId: string) => void): () => void {
  maxLengthListeners.add(listener);
  return () => maxLengthListeners.delete(listener);
}

async function drain(): Promise<void> {
  const b = await backend();
  for (;;) {
    let rows: SegmentRow[];
    try {
      rows = await b.all<SegmentRow>("segments");
    } catch {
      return;
    }
    const now = Date.now();
    rows.sort((x, y) => x.createdAt - y.createdAt);
    const expired = rows.filter((r) => now - r.createdAt > RETRY_FOR_MS);
    for (const r of expired) {
      console.warn("[recorder] dropped a segment that couldn't send for 24 hours");
      await b.del("segments", [r.transcriptId, r.track, r.seq]).catch(() => {});
    }
    const due = rows.find((r) => now - r.createdAt <= RETRY_FOR_MS && r.nextAttemptAt <= now);
    if (!due) {
      const waiting = rows.filter((r) => now - r.createdAt <= RETRY_FOR_MS);
      if (waiting.length) {
        const next = Math.min(...waiting.map((r) => r.nextAttemptAt));
        scheduleRetry(Math.max(1000, next - now));
      }
      return;
    }

    let outcome: Outcome;
    try {
      await uploadCallSegment(due.transcriptId, {
        blob: due.blob,
        seq: due.seq,
        track: due.track,
        offset_ms: due.offsetMs,
        duration_ms: due.durationMs,
        vocabulary: due.vocabulary,
      });
      outcome = "sent";
    } catch (err) {
      outcome = classify(err);
    }

    const key: IDBValidKey = [due.transcriptId, due.track, due.seq];
    if (outcome === "retry") {
      await b.put("segments", { ...due, attempts: due.attempts + 1, nextAttemptAt: Date.now() + backoff(due.attempts) }).catch(() => {});
      continue;
    }
    if (outcome === "drop") console.warn("[recorder] the server refused a segment; it won't be retried");
    await b.del("segments", key).catch(() => {});
    // The server took one, so it's back: send the rest now rather than each
    // waiting out its own backoff.
    if (outcome === "sent") await sendWaitingNow(b, rows.filter((r) => r !== due));
    if (outcome === "max_length") maxLengthListeners.forEach((l) => l(due.transcriptId));
  }
}

async function sendWaitingNow(b: Backend, rows: SegmentRow[]) {
  const now = Date.now();
  const ops = rows.filter((r) => r.nextAttemptAt > now).map((r) => ({ store: "segments" as StoreName, put: { ...r, nextAttemptAt: now } }));
  await b.batch(ops).catch(() => {});
}

function scheduleRetry(ms: number) {
  if (typeof window === "undefined") return;
  if (retryTimer) clearTimeout(retryTimer);
  // A timer is fine here: it only paces retries. Rotation never waits on one.
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flush();
  }, ms);
}

/** Send whatever is queued. Safe to call often: concurrent calls coalesce,
 *  and only one tab uploads at a time. `now`: skip any backoff in progress
 *  (after a reload, or when the browser comes back online). */
export async function flush(opts: { now?: boolean } = {}): Promise<void> {
  if (typeof window === "undefined") return;
  if (opts.now) {
    try {
      const b = await backend();
      await sendWaitingNow(b, await b.all<SegmentRow>("segments"));
    } catch {
      /* the normal schedule still applies */
    }
  }
  if (flushing) {
    again = true;
    return;
  }
  flushing = true;
  try {
    do {
      again = false;
      const l = locks();
      if (l) {
        await l.request(UPLOAD_LOCK, { ifAvailable: true }, async (lock) => {
          if (lock) await drain();
          else scheduleRetry(30_000); // another tab is sending; look again later
        });
      } else {
        await drain();
      }
    } while (again);
  } catch {
    scheduleRetry(30_000);
  } finally {
    flushing = false;
  }
}

/** Housekeeping on load: send anything a closed tab left behind, and forget
 *  call records nothing refers to any more. */
let booted = false;

export async function bootQueue(): Promise<void> {
  if (typeof window === "undefined" || booted) return;
  booted = true;
  try {
    await recoverChunks();
    const b = await backend();
    const [metas, segments, chunks] = await Promise.all([
      b.all<TranscriptMeta>("transcripts"),
      b.all<SegmentRow>("segments"),
      b.all<ChunkRow>("chunks"),
    ]);
    const inUse = new Set([...segments.map((s) => s.transcriptId), ...chunks.map((c) => c.transcriptId)]);
    const now = Date.now();
    for (const m of metas) {
      if (!inUse.has(m.transcriptId) && now - m.updatedAt > META_KEEP_MS) await b.del("transcripts", m.transcriptId);
    }
  } catch {
    /* housekeeping only */
  }
  void flush({ now: true });
  window.addEventListener("online", () => void flush({ now: true }));
}
