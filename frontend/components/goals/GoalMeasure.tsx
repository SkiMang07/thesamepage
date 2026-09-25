"use client";

// The success measure block on a goal sheet, in Details and in Review
// together. Three honest states:
//   - a configured measure with a reading: the latest ENTERED value, its own
//     date, the current target, and a plot of real readings by time;
//   - a configured measure without a reading: the target and "No value
//     recorded yet.";
//   - no measure: the written success criterion, verbatim, or its absence.
// Nothing here parses prose, and nothing turns status or completion % into a
// reading. See docs/systems/goals.md.

import { useId } from "react";
import type { Goal, GoalMeasure as Measure, GoalReading } from "@/lib/api";
import {
  formatMoment,
  formatValue,
  meetsTarget,
  plotGeometry,
  targetShort,
  targetText,
  valueParts,
} from "@/lib/goals";

const KICKER = "text-2xs uppercase tracking-[0.14em] text-ink-muted";

type Size = "card" | "detail" | "present";

export default function GoalMeasure({ goal, size = "card" }: { goal: Goal; size?: Size }) {
  const m = goal.measure;
  const big = size === "present";
  if (!m) {
    return (
      <div>
        <p className={KICKER}>Success criterion</p>
        {goal.success_metrics ? (
          <p
            className={`mt-2 whitespace-pre-wrap break-words text-ink ${
              big ? "text-[1.9rem] leading-snug" : "text-[1.3rem] leading-[1.35] tracking-[-0.01em]"
            } ${size === "card" ? "line-clamp-5" : ""}`}
          >
            {goal.success_metrics}
          </p>
        ) : (
          <p className="mt-2 font-serif text-[1.4rem] leading-snug text-ink-muted">
            Success criterion
            <br />
            not recorded.
          </p>
        )}
      </div>
    );
  }
  const reading = goal.latest_reading ?? null;
  const readings = goal.recent_readings ?? [];
  const numberCls = big
    ? "text-[4.2rem] sm:text-[4.9rem]"
    : size === "detail"
      ? "text-[3.1rem]"
      : "text-[2.9rem]";
  if (!reading) {
    return (
      <div>
        <p className={KICKER}>Target</p>
        <p className={`mt-1 font-sans font-normal leading-[1.1] tracking-[-0.04em] text-ink tabular-nums ${numberCls}`}>
          {targetShort(m).replace(/^([≥≤<])/, "$1 ")}
        </p>
        <p className={`mt-2 text-ink-body ${big ? "text-lg" : "text-xs"}`}>{m.label}</p>
        <p className={`mt-3 text-ink-muted ${big ? "text-sm" : "text-xs"}`}>No value recorded yet.</p>
      </div>
    );
  }
  const parts = valueParts(reading.value, m);
  const met = meetsTarget(reading.value, m);
  return (
    <div>
      <p className={KICKER}>Latest measured value</p>
      <div className="mt-1 flex items-baseline gap-2">
        <strong className={`whitespace-nowrap font-sans font-normal leading-none tracking-[-0.05em] text-ink tabular-nums ${numberCls}`}>
          {parts.number}
        </strong>
        {parts.unit && <span className={`${big ? "text-2xl" : "text-[1.05rem]"} text-ink-body`}>{parts.unit}</span>}
        <span className="ml-auto shrink-0 text-right">
          <span className="block text-2xs uppercase tracking-[0.1em] text-ink-muted">Current target</span>
          <b className={`block font-normal leading-tight text-ink-body tabular-nums ${big ? "text-[3rem]" : "text-[1.8rem]"}`}>
            {targetShort(m)}
          </b>
        </span>
      </div>
      <p className={`mt-2 text-ink-body ${big ? "text-xl" : "text-xs"}`}>{m.label}</p>
      <p className={`mt-1.5 text-ink-muted ${big ? "text-sm" : "text-xs"}`}>Value recorded {formatMoment(reading.at)}</p>
      <MeasurePlot readings={readings} measure={m} height={big ? 100 : size === "detail" ? 72 : 42} />
      {met && (
        <p className={`mt-3 text-brand ${big ? "text-sm" : "text-xs"}`}>Recorded value meets the current target.</p>
      )}
    </div>
  );
}

/** Real readings positioned by time against the current target. One reading
 *  draws nothing (there is no line to draw). The SVG stretches to the column;
 *  strokes and dots use non-scaling strokes so they stay crisp and round. */
export function MeasurePlot({ readings, measure, height = 42 }: { readings: GoalReading[]; measure: Measure; height?: number }) {
  const id = useId();
  const W = 300;
  const geo = plotGeometry(readings, measure.target, W, height);
  if (!geo) return null;
  const summary =
    geo.points.map((p) => `${formatMoment(p.reading.at)}: ${formatValue(p.reading.value, measure)}`).join("; ") +
    `. Current target: ${targetText(measure)}.`;
  const line = geo.points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  return (
    <figure className="mt-3" aria-labelledby={id}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="block w-full overflow-visible"
        style={{ height }}
        role="img"
        aria-labelledby={id}
      >
        <line
          x1={0}
          x2={W}
          y1={geo.targetY}
          y2={geo.targetY}
          className="stroke-control"
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
        />
        <path d={line} fill="none" className="stroke-brand" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {geo.points.map((p) => (
          <path
            key={p.reading.check_in_id}
            d={`M${p.x} ${p.y}h0`}
            className="stroke-brand"
            strokeWidth={6}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <figcaption id={id} className="sr-only">
        {summary}
      </figcaption>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-2xs text-ink-muted" aria-hidden>
        <span>{formatMoment(geo.first.at)}</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t border-dashed border-ink-muted" />
          current target
        </span>
        <span>{formatMoment(geo.last.at)}</span>
      </div>
    </figure>
  );
}

/** The readable alternative to the plot: every recorded value, newest first. */
export function ReadingsTable({ readings, measure }: { readings: GoalReading[]; measure: Measure }) {
  if (readings.length === 0) return <p className="mt-2 text-xs text-ink-muted">No value recorded yet.</p>;
  return (
    <table className="mt-3 text-xs">
      <thead>
        <tr className="text-ink-muted">
          <th scope="col" className="py-1.5 pr-8 text-left font-normal">Date</th>
          <th scope="col" className="py-1.5 pr-8 text-left font-normal">Value</th>
        </tr>
      </thead>
      <tbody className="text-ink-body">
        {readings.map((r) => (
          <tr key={r.check_in_id} className="border-t border-divider">
            <td className="py-1.5 pr-8">{formatMoment(r.at)}</td>
            <td className="py-1.5 pr-8 tabular-nums">{formatValue(r.value, measure)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
