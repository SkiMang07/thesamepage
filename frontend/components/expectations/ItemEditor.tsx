"use client";

// One editable expectation in the plain-language role document. The manager
// never classifies sentences: the section and the "measured by a number"
// switch are the only structure, and they map onto the existing model
// server-side (docs/systems/expectations.md).

import { RoleItem } from "@/lib/api";
import { INPUT, LABEL, TEXTAREA } from "@/lib/tokens";
import { PERIODS, kindBadge, provenance, targetStatus } from "@/components/expectations/shared";

export default function ItemEditor({
  item,
  onChange,
  onRemove,
  highlighted,
}: {
  item: RoleItem;
  onChange: (next: RoleItem) => void;
  onRemove: () => void;
  highlighted?: boolean;
}) {
  const id = item.key;
  const patch = (p: Partial<RoleItem>) => onChange({ ...item, ...p, edited: true });
  const tStatus = targetStatus(item);
  const textareaCls = `${TEXTAREA} text-sm`;

  return (
    <article
      id={`item-${id}`}
      aria-labelledby={`item-title-${id}`}
      className={`scroll-mt-24 border-b border-divider pb-6 pt-1 last:border-b-0 last:pb-0 ${highlighted ? "rounded-lg ring-2 ring-blue-600/40 ring-offset-4 ring-offset-surface" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={`item-title-${id}`} className="min-w-0 text-[15px] font-semibold text-ink">
          {item.title || <span className="font-normal text-ink-muted">Untitled expectation</span>}
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-secondary">{kindBadge(item)}</span>
          <button type="button" onClick={onRemove} className="text-xs text-ink-muted hover:text-red-700" aria-label={`Remove ${item.title || "this expectation"}`}>
            Remove
          </button>
        </div>
      </div>

      <label className={`${LABEL} mt-3`} htmlFor={`title-${id}`}>
        {item.section === "value" ? "Value" : "Expectation"}
      </label>
      <input id={`title-${id}`} data-field="title" value={item.title} onChange={(e) => patch({ title: e.target.value })} className={INPUT} />

      {item.section !== "value" && (
        <>
          <label className={`${LABEL} mt-3`} htmlFor={`resp-${id}`}>
            {item.section === "responsibility" ? "What they own" : "What it covers · optional"}
          </label>
          <textarea
            id={`resp-${id}`}
            data-field="responsibility"
            rows={2}
            value={item.responsibility}
            onChange={(e) => patch({ responsibility: e.target.value })}
            className={textareaCls}
          />
        </>
      )}

      <label className={`${LABEL} mt-3`} htmlFor={`meets-${id}`}>
        {item.section === "value" ? "What it looks like in this role" : "Meets expectations"}
      </label>
      <textarea id={`meets-${id}`} data-field="meets" rows={3} value={item.meets} onChange={(e) => patch({ meets: e.target.value })} className={textareaCls} />

      {item.section === "responsibility" && (
        <div className="mt-3">
          <label className="flex items-center gap-2 text-sm text-ink-body">
            <input
              type="checkbox"
              checked={item.measure === "numeric"}
              onChange={(e) =>
                patch(
                  e.target.checked
                    ? { measure: "numeric", target: item.target ?? { status: "unresolved" }, legacy_target: false, measurement_period: item.measurement_period ?? "quarter" }
                    : { measure: "judged", target: null, legacy_target: false, measurement_period: null }
                )
              }
            />
            Measured by a number
          </label>
          {item.measure === "numeric" && (
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_11rem]">
              <div>
                <label className={LABEL} htmlFor={`target-${id}`}>
                  Target
                </label>
                {tStatus === "legacy" ? (
                  <div className="rounded-md border border-dashed border-control px-3 py-2 text-sm text-ink-secondary">
                    Not recorded separately — any target is in the wording above.{" "}
                    <button type="button" className="font-medium text-brand hover:text-brand-hover" onClick={() => patch({ target: { status: "unresolved" }, legacy_target: false })}>
                      Add a target
                    </button>
                  </div>
                ) : (
                  <input
                    id={`target-${id}`}
                    data-field="target"
                    value={item.target && item.target.status === "set" ? item.target.text : ""}
                    onChange={(e) =>
                      patch({
                        target: e.target.value.trim()
                          ? { status: "set", text: e.target.value, source: "manager", quote: null }
                          : { status: "unresolved" },
                      })
                    }
                    placeholder="Not set — add the agreed target"
                    className={INPUT}
                  />
                )}
              </div>
              <div>
                <label className={LABEL} htmlFor={`period-${id}`}>
                  Measured
                </label>
                <select
                  id={`period-${id}`}
                  value={item.measurement_period ?? "quarter"}
                  onChange={(e) => patch({ measurement_period: e.target.value })}
                  className={INPUT}
                >
                  {PERIODS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-ink-muted sm:col-span-2">
                {item.target?.status === "set" && item.target.source === "source" && item.target.quote
                  ? `From your job description: “${item.target.quote}”`
                  : item.target?.status === "set"
                    ? "Your target."
                    : tStatus === "legacy"
                      ? ""
                      : "No target set. It won’t be treated as a standard — results can be discussed, not judged against a number."}
              </p>
            </div>
          )}
        </div>
      )}

      <label className={`${LABEL} mt-3`} htmlFor={`exceeds-${id}`}>
        Exceeds expectations · optional
      </label>
      <textarea
        id={`exceeds-${id}`}
        data-field="exceeds"
        rows={2}
        value={item.exceeds}
        onChange={(e) => patch({ exceeds: e.target.value })}
        placeholder="Leave empty unless there’s a meaningful step beyond meeting"
        className={textareaCls}
      />

      <p className="mt-2.5 text-xs text-ink-muted">
        {provenance(item)}
        {item.source_quote && !item.edited && item.origin === "source" ? ` · from “${item.source_quote}”` : ""}
      </p>
    </article>
  );
}
