"use client";

// "Ask about …" — opens the Scribe drawer from inside a page, with the
// composer pre-filled and (optionally) a narrower page context. Nothing is
// sent until the manager presses Send, so a click costs nothing.

import type { AssistantPageContext } from "@/lib/api";
import { useDrawer } from "@/lib/drawer-context";

const DEFAULT_CLASS =
  "inline-flex items-center gap-1.5 rounded-md py-1.5 text-xs font-medium text-brand hover:text-brand-hover";

export default function AskAboutButton({
  label,
  prompt,
  context,
  className = DEFAULT_CLASS,
}: {
  label: string;
  prompt: string;
  context?: AssistantPageContext;
  className?: string;
}) {
  const { ask } = useDrawer();
  return (
    <button type="button" onClick={() => ask(prompt, context)} className={className}>
      <span aria-hidden="true">✦</span>
      {label}
    </button>
  );
}
