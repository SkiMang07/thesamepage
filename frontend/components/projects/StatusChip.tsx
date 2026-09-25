import type { ProjectStatus } from "@/lib/api";
import { BADGE, STATUS_GLYPH, STATUS_STYLES } from "@/lib/tokens";
import { PROJECT_STATUS_LABEL } from "@/lib/projects";

export function StatusChip({ status }: { status: ProjectStatus }) {
  return (
    <span className={`${BADGE} ${STATUS_STYLES[status]} inline-flex shrink-0 items-center gap-1 whitespace-nowrap`}>
      <span aria-hidden>{STATUS_GLYPH[status]}</span>
      {PROJECT_STATUS_LABEL[status]}
    </span>
  );
}
