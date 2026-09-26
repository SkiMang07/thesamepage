"use client";

// The role definition read as one document — what the approved standard
// says (role page), or exactly what approval will make active (review).
// Missing targets are shown as missing, never as zero.

import Link from "next/link";
import { RoleItem } from "@/lib/api";
import { CARD } from "@/lib/tokens";
import { PERIODS, SECTION_COPY, SECTION_ORDER, targetStatus } from "@/components/expectations/shared";

export default function RoleDocument({
  items,
  orgValues,
  editHref,
  openTargets,
}: {
  items: RoleItem[];
  orgValues: { id: string; name: string; description: string | null }[];
  /** When set, each item gets an Edit link back to its field. */
  editHref?: (item: RoleItem) => string;
  /** Item keys whose missing target has a follow-up date. */
  openTargets?: Set<string>;
}) {
  return (
    <section className={`${CARD} p-5 sm:p-6`} aria-label="Role expectations">
      {SECTION_ORDER.map((section) => {
        const list = items.filter((i) => i.section === section);
        if (!list.length && section !== "value") return null;
        return (
          <div key={section} className="mb-6 last:mb-0">
            <h2 className="border-b border-divider pb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {section === "value" ? "Values" : SECTION_COPY[section].heading}
            </h2>
            {list.map((item) => {
              const t = targetStatus(item);
              const period = PERIODS.find((p) => p.id === item.measurement_period)?.label;
              return (
                <article key={item.key} className="border-b border-divider py-4 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[15px] font-semibold text-ink">{item.title}</h3>
                    {editHref && (
                      <Link href={editHref(item)} className="shrink-0 text-sm text-ink-secondary hover:text-ink">
                        Edit
                      </Link>
                    )}
                  </div>
                  {item.responsibility && <p className="mt-1 text-sm text-ink-secondary">{item.responsibility}</p>}
                  <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-muted">
                    {section === "value" ? "What it looks like in this role" : "Meets expectations"}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-body">{item.meets || <span className="text-ink-muted">Not written yet.</span>}</p>
                  {t && (
                    <>
                      <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-muted">
                        Target{period && item.measurement_period !== "none" ? ` · ${period.toLowerCase()}` : ""}
                      </p>
                      {t === "set" && item.target?.status === "set" ? (
                        <p className="mt-0.5 text-sm text-ink-body">
                          {item.target.text}
                          <span className="ml-2 text-xs text-ink-muted">{item.target.source === "source" ? "from the job description" : "your target"}</span>
                        </p>
                      ) : t === "legacy" ? (
                        <p className="mt-0.5 text-sm text-ink-muted">Not recorded separately.</p>
                      ) : (
                        <p className="mt-1">
                          <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            Not set · excluded from evaluation{openTargets?.has(item.key) || openTargets?.has(item.config_id ?? "") ? " · follow-up scheduled" : ""}
                          </span>
                        </p>
                      )}
                    </>
                  )}
                  {item.exceeds ? (
                    <>
                      <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-muted">Exceeds expectations</p>
                      <p className="mt-0.5 text-sm text-ink-body">{item.exceeds}</p>
                    </>
                  ) : (
                    <p className="mt-3 text-xs text-ink-muted">Exceeds expectations: not defined.</p>
                  )}
                </article>
              );
            })}
            {section === "value" && (
              <p className="pt-3 text-sm text-ink-secondary">
                {orgValues.length
                  ? `Company values apply to this role too: ${orgValues.map((v) => v.name).join(", ")}.`
                  : list.length
                    ? ""
                    : "No values yet."}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
