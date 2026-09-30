"use client";

// One quiet line under a button while an AI call runs. Renders nothing when
// `active` is false. Wording lives in lib/waitMessage.ts.

import { useEffect, useState } from "react";
import { waitMessage } from "@/lib/waitMessage";

export default function WaitNote({ active, typical, className = "" }: { active: boolean; typical: string; className?: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return null;
  return (
    <p role="status" className={`text-xs text-ink-muted ${className}`}>
      {waitMessage(elapsed, typical)}
    </p>
  );
}
