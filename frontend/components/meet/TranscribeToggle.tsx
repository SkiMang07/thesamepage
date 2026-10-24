"use client";

// The Transcribe switch and its consent line, shared by the Meet picker and
// the Start 1:1 popover (build plan B2). The switch remembers the last
// choice on this device; consent is per person, confirmed once.

export function TranscribeToggle({ on, onChange, id }: { on: boolean; onChange: (on: boolean) => void; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Transcribe this call"
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 motion-reduce:transition-none ${
        on ? "bg-brand" : "bg-carbon-300"
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-4 w-4 rounded-full bg-surface shadow transition motion-reduce:transition-none ${on ? "translate-x-[18px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}

export function consentLine(transcribe: boolean, firstName: string, consented: boolean) {
  if (!transcribe) return "Notes only, no transcript";
  if (consented) return `${firstName} knows calls are transcribed ✓`;
  return `First time with ${firstName}: you'll confirm they know`;
}
