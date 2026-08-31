"use client";

// ---------------------------------------------------------------------------
// A handful of bars that respond to live mic input while dictating.
//
// Not a partial transcript — that stays off the table on purpose (see
// docs/systems/dictation.md: batch, never streaming). This is a cheap,
// client-only Web Audio read of the live MediaStream (see useDictation's
// `level`), and it answers exactly one question the timer alone can't: is
// the mic actually hearing me. No network call, no cost, nothing that
// touches the "audio is transcribed and discarded" promise.
// ---------------------------------------------------------------------------
type Props = {
  /** 0-1, smoothed RMS of the live input. */
  level: number;
  className?: string;
};

const BAR_COUNT = 4;

export default function DictationLevelMeter({ level, className = "" }: Props) {
  return (
    <div className={`flex items-end gap-0.5 ${className}`} aria-hidden="true">
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        const threshold = (i + 1) / BAR_COUNT;
        const active = level >= threshold - 0.18;
        return (
          <span
            key={i}
            className={`w-[3px] rounded-full transition-colors duration-100 ${
              active ? "bg-brand" : "bg-ink-faint"
            }`}
            style={{ height: `${5 + i * 3}px` }}
          />
        );
      })}
    </div>
  );
}
