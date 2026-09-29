"use client";

import { useQuickAdd } from "@/lib/quick-add-context";

// Empty-state action: opens Quick add in place instead of sending the
// manager to the dashboard.
export default function AddDirectReportButton({ className = "" }: { className?: string }) {
  const { open } = useQuickAdd();
  return (
    <button type="button" onClick={open} className={className}>
      Add a direct report
    </button>
  );
}
