"use client";

// React wiring for lib/aiDraftTelemetry.ts. A component calls start() when a
// draft appears, then accept() after its save succeeds or discard() when the
// manager throws the draft away. A draft still open when the component
// unmounts or the tab closes is reported as abandoned (best effort).
// Telemetry is never load-bearing: every send swallows its own failure.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { reportAiDraft } from "@/lib/api";
import { AiDraftSurface, DraftShape, DraftTracker } from "@/lib/aiDraftTelemetry";

export function useAiDraft(surface: AiDraftSurface) {
  const tracker = useRef<DraftTracker | null>(null);

  useEffect(() => {
    const onHide = () => tracker.current?.abandon();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      tracker.current?.abandon();
    };
  }, []);

  // A new draft replacing an open one means the old one was thrown away.
  const start = useCallback(
    (draft: DraftShape) => {
      tracker.current?.discard();
      tracker.current = new DraftTracker(surface, draft, (r) => void reportAiDraft(r));
    },
    [surface],
  );
  const accept = useCallback((saved: DraftShape) => tracker.current?.accept(saved), []);
  const discard = useCallback(() => tracker.current?.discard(), []);
  const isOpen = useCallback(() => !!tracker.current && !tracker.current.isResolved, []);

  // Stable identity, so callers can list it in effect dependencies.
  return useMemo(() => ({ start, accept, discard, isOpen }), [start, accept, discard, isOpen]);
}
