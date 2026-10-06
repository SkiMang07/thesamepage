"use client";

// Completion modal for setup mode (docs/design-proposals/2026-09-29-onboarding-path/
// CHUNK_D_PLAN.md): shown once when all three steps hold. A receipt of what is
// now on record, counted from the records (no AI), and an optional "when there
// is time" list. Closing it marks it seen on the server; the chip and the card
// are already gone by then. If the receipt cannot be read, the modal still says
// setup is complete and can be closed.
//
// Voice: past tense, plain counts, no cheer.
//
// It opens the moment setup completes, with the counts filling in, and only a
// deliberate act closes it (Done, Escape once the counts are in, or a "next"
// link). It used to wait for the receipt before drawing anything and close on a
// backdrop click, so it appeared a second or two after "Skip for now", on a page
// that already looked finished, and the manager's next click landed on the
// backdrop and marked it seen unread (onboarding review 2026-10-05, finding #6).

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SetupReceipt, getSetupReceipt, markSetupReceiptSeen } from "@/lib/api";
import { BTN_PRIMARY, EYEBROW } from "@/lib/tokens";

export default function SetupCompleteModal({ onClose }: { onClose: () => void }) {
  const [receipt, setReceipt] = useState<SetupReceipt | null>(null);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getSetupReceipt().then(
      (r) => {
        if (cancelled) return;
        // Null: nothing is pending any more (another tab closed it).
        loaded.current = true;
        if (r === null) onClose();
        else setReceipt(r);
      },
      () => {
        loaded.current = true;
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() {
    void markSetupReceiptSeen();
    onClose();
  }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && loaded.current) close();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-10">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-complete-title"
        className="w-full max-w-lg rounded-xl border border-hairline bg-surface p-5 shadow-xl sm:p-6"
      >
        <p className={EYEBROW}>Setup</p>
        <h2 id="setup-complete-title" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
          Setup is complete
        </h2>

        {!receipt && !failed && (
          <p className="mt-3 text-sm text-ink-secondary" aria-live="polite">Counting what is on record…</p>
        )}

        {receipt && (
          <>
            <ul className="mt-3 space-y-1.5 text-sm text-ink-body">
              {receipt.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-ink-secondary">
              The setup card and the Setup chip are gone. Anything added later shows a small note on that record only.
            </p>

            {receipt.next.length > 0 && (
              <div className="mt-5 border-t border-hairline pt-4">
                <p className={EYEBROW}>Next, when there is time</p>
                <ul className="mt-2 divide-y divide-hairline">
                  {receipt.next.map((item) => (
                    <li key={item.key} className="py-2.5 first:pt-0 last:pb-0">
                      <Link href={item.href} onClick={close} className="text-[14px] font-medium text-brand hover:text-brand-hover hover:underline">
                        {item.label}
                      </Link>
                      <p className="text-[13px] text-ink-secondary">{item.detail}</p>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-muted">None of these is required.</p>
              </div>
            )}
          </>
        )}

        <div className="mt-5 flex justify-end">
          <button ref={closeRef} type="button" onClick={close} className={BTN_PRIMARY}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
