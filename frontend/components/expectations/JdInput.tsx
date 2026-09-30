"use client";

// Paste or upload a job description, plus the manager's own notes beside it.
// The notes box stays whether the description is pasted or attached: a job
// description is often out of date (written before a promotion) or generic,
// and the notes are where the manager says what's true now. Where the two
// disagree, the notes win (backend/routes/role_expectations.py).
// Everything stays in the parent's state, so a failed draft never loses it.
//
// Setup mode chunk C: with `onDescribe` the manager can instead describe the
// role in a few sentences, typed or spoken, with no document. That text travels
// as the same `context` field; with no job description the server treats it as
// the only source and marks each drafted line as drawn from it or as only
// typical for the role (backend/routes/role_expectations.py).
//
// Build 3b: with `onDocuments`, supporting documents can go alongside the job
// description, plus an optional "anything to ignore?" instruction. Documents
// rank below the job description, inform this one draft and are not kept.

import { useRef, useState } from "react";
import { LABEL, TEXTAREA } from "@/lib/tokens";
import NoteField from "@/components/NoteField";

export const MAX_DOCUMENTS = 5;
const ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";

export default function JdInput({
  text,
  onText,
  file,
  onFile,
  context,
  onContext,
  disabled,
  describe = false,
  onDescribe,
  documents,
  onDocuments,
  ignore,
  onIgnore,
}: {
  text: string;
  onText: (t: string) => void;
  file: File | null;
  onFile: (f: File | null) => void;
  context: string;
  onContext: (t: string) => void;
  disabled?: boolean;
  describe?: boolean;
  onDescribe?: (v: boolean) => void;
  documents?: File[];
  onDocuments?: (f: File[]) => void;
  ignore?: string;
  onIgnore?: (t: string) => void;
}) {
  const tabCls = (on: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${on ? "bg-brand text-on-brand" : "text-ink-secondary hover:text-ink"}`;
  return (
    <div>
      {onDescribe && (
        <div role="tablist" aria-label="How to start" className="mb-4 inline-flex gap-1 rounded-lg border border-control p-1">
          <button type="button" role="tab" aria-selected={!describe} disabled={disabled} onClick={() => onDescribe(false)} className={tabCls(!describe)}>
            Attach a job description
          </button>
          <button type="button" role="tab" aria-selected={describe} disabled={disabled} onClick={() => onDescribe(true)} className={tabCls(describe)}>
            Describe the role
          </button>
        </div>
      )}
      {describe ? (
        <div>
          <label htmlFor="jd-context" className={LABEL}>
            Describe the role
          </label>
          <p className="mb-2 text-sm text-ink-muted">
            What it owns, how you’d tell it’s going well, and any numbers you already track. Speak or type; a few sentences is enough. Lines drawn from what you write are marked as yours. A line that is only typical for the role is marked too and waits until you use it.
          </p>
          <NoteField
            id="jd-context"
            value={context}
            onChange={onContext}
            disabled={disabled}
            rows={8}
            placeholder="e.g. Priya leads six support reps. She owns first response time and keeps CSAT above 90 each month. She coaches each rep weekly."
            className="text-sm leading-relaxed"
          />
        </div>
      ) : (
        <>
      <SourceInput text={text} onText={onText} file={file} onFile={onFile} disabled={disabled} />
      <div className="mt-5">
        <label htmlFor="jd-context" className={LABEL}>
          What the job description doesn’t say <span className="font-normal text-ink-muted">· optional</span>
        </label>
        <p className="mb-2 text-sm text-ink-muted">
          How the role has changed, what you expect now, targets you’ve already agreed. Where this and the job description disagree, this wins.
        </p>
        <NoteField
          id="jd-context"
          value={context}
          onChange={onContext}
          disabled={disabled}
          rows={5}
          placeholder="e.g. He was promoted from Director of Support — he now owns renewals and onboarding too, and leads three managers."
          className="text-sm leading-relaxed"
        />
      </div>
      {onDocuments && <DocumentsInput documents={documents ?? []} onDocuments={onDocuments} disabled={disabled} />}
      {onIgnore && (
        <div className="mt-5">
          <label htmlFor="jd-ignore" className={LABEL}>
            Anything to ignore? <span className="font-normal text-ink-muted">· optional</span>
          </label>
          <p className="mb-2 text-sm text-ink-muted">Anything the draft should leave out, wherever it appears. Only what you write here is ignored.</p>
          <textarea
            id="jd-ignore"
            value={ignore ?? ""}
            disabled={disabled}
            onChange={(e) => onIgnore(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="e.g. The travel section, and the on-call duty — that moved to another team."
            className={`${TEXTAREA} text-sm leading-relaxed`}
          />
        </div>
      )}
        </>
      )}
    </div>
  );
}

function DocumentsInput({
  documents,
  onDocuments,
  disabled,
}: {
  documents: File[];
  onDocuments: (f: File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const full = documents.length >= MAX_DOCUMENTS;
  function add(list: FileList | null) {
    if (!list) return;
    onDocuments([...documents, ...Array.from(list)].slice(0, MAX_DOCUMENTS));
  }
  return (
    <div className="mt-5">
      <p className={LABEL} id="jd-documents-label">
        Other documents <span className="font-normal text-ink-muted">· optional</span>
      </p>
      <p className="mb-2 text-sm text-ink-muted">
        A team playbook, a levelling guide, last year’s goals. They add detail where the job description is silent. The job description still wins, and a
        figure in a document can’t become a target by itself. Where one disagrees with the job description, you’ll get a question. They’re read for
        this draft only and not kept.
      </p>
      {documents.length > 0 && (
        <ul aria-labelledby="jd-documents-label" className="mb-2 space-y-1.5">
          {documents.map((d, i) => (
            <li key={`${d.name}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-control bg-sunken px-4 py-2">
              <p className="min-w-0 truncate text-sm text-ink">
                <span className="font-medium">{d.name}</span>
                <span className="ml-2 text-ink-muted">{Math.max(1, Math.round(d.size / 1024))} KB</span>
              </p>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDocuments(documents.filter((_, j) => j !== i))}
                className="shrink-0 text-sm text-ink-secondary hover:text-ink"
                aria-label={`Remove ${d.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <button
          type="button"
          disabled={disabled || full}
          onClick={() => inputRef.current?.click()}
          className="font-medium text-brand hover:text-brand-hover disabled:text-ink-muted"
        >
          {documents.length ? "Add another document" : "Add a document"}
        </button>
        <span>{full ? `Up to ${MAX_DOCUMENTS} documents.` : "PDF, Word, or text"}</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

function SourceInput({
  text,
  onText,
  file,
  onFile,
  disabled,
}: {
  text: string;
  onText: (t: string) => void;
  file: File | null;
  onFile: (f: File | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  if (file) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-control bg-sunken px-4 py-3">
        <p className="min-w-0 truncate text-sm text-ink">
          <span className="font-medium">{file.name}</span>
          <span className="ml-2 text-ink-muted">{Math.max(1, Math.round(file.size / 1024))} KB</span>
        </p>
        <button type="button" disabled={disabled} onClick={() => onFile(null)} className="shrink-0 text-sm text-ink-secondary hover:text-ink">
          Remove
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={dragging ? "rounded-lg ring-2 ring-brand" : ""}
    >
      <label htmlFor="jd-text" className="sr-only">
        Job description
      </label>
      <textarea
        id="jd-text"
        value={text}
        disabled={disabled}
        onChange={(e) => onText(e.target.value)}
        rows={12}
        placeholder="Paste the job description here — responsibilities, requirements, anything you have. Boilerplate is fine."
        className={`${TEXTAREA} text-sm leading-relaxed`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <span>or</span>
        <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="font-medium text-brand hover:text-brand-hover">
          upload a file
        </button>
        <span>(PDF, Word, or text — drop it here too)</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
