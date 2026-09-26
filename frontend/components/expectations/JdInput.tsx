"use client";

// Paste or upload a job description, plus the manager's own notes beside it.
// The notes box stays whether the description is pasted or attached: a job
// description is often out of date (written before a promotion) or generic,
// and the notes are where the manager says what's true now. Where the two
// disagree, the notes win (backend/routes/role_expectations.py).
// Everything stays in the parent's state, so a failed draft never loses it.

import { useRef, useState } from "react";
import { LABEL, TEXTAREA } from "@/lib/tokens";
import NoteField from "@/components/NoteField";

const ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";

export default function JdInput({
  text,
  onText,
  file,
  onFile,
  context,
  onContext,
  disabled,
}: {
  text: string;
  onText: (t: string) => void;
  file: File | null;
  onFile: (f: File | null) => void;
  context: string;
  onContext: (t: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
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
