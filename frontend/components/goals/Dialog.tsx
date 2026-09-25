"use client";

// A small modal for the Goals page: scrim, focus moved in and kept in, Escape
// closes, focus returns to whatever opened it.

import { useEffect, useRef, type ReactNode } from "react";
import { ELEVATED, SCRIM } from "@/lib/tokens";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(onEscape: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const escRef = useRef(onEscape);
  escRef.current = onEscape;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    function onKey(e: KeyboardEvent) {
      if (!node) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        escRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const [a, z] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);
  return ref;
}

export default function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useFocusTrap(onClose);
  return (
    <div className={`${SCRIM} z-[70] flex items-end justify-center p-0 sm:items-center sm:p-6`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="goals-dialog-title"
        className={`${ELEVATED} max-h-[90dvh] w-full overflow-y-auto p-6 ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}
      >
        <h2 id="goals-dialog-title" className="font-serif text-2xl font-normal text-ink">
          {title}
        </h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
