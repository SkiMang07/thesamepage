// A person's initials in their identity colour — the same id -> colour rule
// the shell roster, Mission Control and the Relationship Desk use
// (identityIndex over the direct report id), so a person looks the same
// everywhere. A null id is the manager ("You"), drawn in neutral carbon so
// it never reads as a report.

import { IDENTITY_BG, IDENTITY_TEXT, identityIndex } from "@/lib/tokens";

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

const SIZES = {
  xs: "h-[22px] w-[22px] text-2xs leading-none",
  sm: "h-7 w-7 text-2xs",
  md: "h-8 w-8 text-2xs",
  lg: "h-10 w-10 text-xs",
} as const;

export default function PersonAvatar({
  id,
  name,
  size = "sm",
  className = "",
}: {
  id: string | null | undefined;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const color = id ? `${IDENTITY_BG[identityIndex(id)]} ${IDENTITY_TEXT}` : "bg-carbon-300 text-ink";
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-full font-semibold ${SIZES[size]} ${color} ${className}`.trim()}
    >
      {id ? initialsOf(name) : "Y"}
    </span>
  );
}
