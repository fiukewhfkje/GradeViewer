import { useId, useMemo, useState } from "react";
import type { Course } from "./core/model";
import { gradeCurve, progression } from "./core/progression";

export function GradeGraph({ course, all }: { course: Course; all: Course[] }) {
  const curve = useMemo(
    () => gradeCurve(progression(course, all)),
    [course, all],
  );
  const [selection, setSelection] = useState<number>();
  const id = useId().replaceAll(":", "");
  const event = curve.event(selection ?? 1);
  const date = event && new Date(event.date).toLocaleDateString();
  const value = event?.percent.toFixed(2);
  return (
    <section className="graph-section">
      <h2>Grade Progression</h2>
      {curve.points.length ? (
        <div
          className="chart"
          data-no-pull
          role="slider"
          tabIndex={0}
          aria-label="Explore grade history"
          aria-valuemin={0}
          aria-valuemax={curve.points.length - 1}
          aria-valuenow={Math.round(
            (selection ?? 1) * (curve.points.length - 1),
          )}
          aria-valuetext={`${value}% on ${date}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const rect = e.currentTarget.getBoundingClientRect();
            setSelection(
              Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
            );
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const rect = e.currentTarget.getBoundingClientRect();
            setSelection(
              Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
            );
          }}
          onPointerUp={() => setSelection(undefined)}
          onPointerCancel={() => setSelection(undefined)}
          onLostPointerCapture={() => setSelection(undefined)}
          onBlur={() => setSelection(undefined)}
          onKeyDown={(e) => {
            const step = 1 / Math.max(1, curve.points.length - 1);
            let next = selection ?? 1;
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") next -= step;
            else if (e.key === "ArrowRight" || e.key === "ArrowUp")
              next += step;
            else if (e.key === "Home") next = 0;
            else if (e.key === "End") next = 1;
            else if (e.key === "Escape") {
              setSelection(undefined);
              return;
            } else return;
            e.preventDefault();
            setSelection(Math.max(0, Math.min(1, next)));
          }}
        >
          <div className="chart-plot">
            <svg
              viewBox="0 0 1000 154"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="currentColor"
                    stopOpacity="0.2"
                  />
                  <stop
                    offset="100%"
                    stopColor="currentColor"
                    stopOpacity="0"
                  />
                </linearGradient>
                <clipPath id={`${id}-selection`}>
                  <rect width={(selection ?? 1) * 1000} height="154" />
                </clipPath>
              </defs>
              <path
                className="chart-area"
                d={`${curve.path} L1000,154 L0,154 Z`}
                fill={`url(#${id}-fill)`}
              />
              <path
                className="chart-line"
                d={curve.path}
                opacity={selection === undefined ? 1 : 0.25}
              />
              {selection !== undefined && (
                <path
                  className="chart-line"
                  d={curve.path}
                  clipPath={`url(#${id}-selection)`}
                />
              )}
            </svg>
          </div>
          {selection !== undefined && (
            <>
              <span
                className="chart-marker"
                style={{
                  left: `${selection * 100}%`,
                  top: curve.trace(selection),
                }}
              />
              <output
                className="chart-tooltip"
                style={{
                  left: `clamp(52px, ${selection * 100}%, calc(100% - 52px))`,
                }}
              >
                <strong>{value}</strong>
                <span>{date}</span>
              </output>
            </>
          )}
        </div>
      ) : (
        <p className="muted">No dated grades available.</p>
      )}
    </section>
  );
}
