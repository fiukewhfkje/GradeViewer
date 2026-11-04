import { useState, type FormEvent } from "react";
import { type Course, percentText } from "./core/model";
import {
  estimateGpa,
  gpaSemesters,
  type CourseLevel,
  type GpaSettings,
} from "./core/gpa";
import { descriptor } from "./core/periods";

const labels: Record<CourseLevel, string> = {
  regular: "Regular",
  honors: "Honors",
  advanced: "AP / IB / eligible CCP or CTAG",
};
const dublinGuide =
  "https://www.dublinschools.net/fs/resource-manager/view/9fee7ad1-f701-493e-96cf-32b6901e5015";
const date = new Intl.DateTimeFormat(undefined, {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function GpaSummary({
  courses,
  settings,
  save,
}: {
  courses: Course[];
  settings?: GpaSettings;
  save: (settings: GpaSettings) => Promise<boolean>;
}) {
  const [period, setPeriod] = useState("");
  const [saving, setSaving] = useState(false);
  const terms = gpaSemesters(courses);
  const term = terms.find(({ id }) => id === period) ?? terms[0];
  if (!term) return null;
  const result = settings && estimateGpa(courses, term, settings);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!settings || !result || saving) return;
    const form = e.currentTarget,
      data = new FormData(form);
    const next = { ...settings, courses: { ...settings.courses } };
    next.weighting = data.get("weighting") === "credits" ? "credits" : "equal";
    for (const row of result.rows) {
      const level = data.get(row.key + ":level"),
        credits = Number(data.get(row.key + ":credits")),
        excluded = data.has(row.key + ":exclude");
      const override =
        level === "regular" || level === "honors" || level === "advanced"
          ? level
          : undefined;
      if (override || credits > 0 || excluded)
        next.courses[row.key] = {
          level: override,
          credits: credits > 0 ? credits : undefined,
          excluded,
        };
      else delete next.courses[row.key];
    }
    setSaving(true);
    try {
      if (await save(next)) delete form.dataset.dirty;
    } finally {
      setSaving(false);
    }
  }
  return (
    <details className="gpa-card">
      <summary>
        <strong>Estimated semester GPA</strong>
        <span className={result?.weighted !== undefined ? "grade" : "muted"}>
          {result?.weighted !== undefined
            ? `${result.weighted.toFixed(2)} weighted · ${result.unweighted!.toFixed(2)} unweighted`
            : settings
              ? "Unavailable"
              : "Set up"}
        </span>
      </summary>
      <div className="gpa-content">
        <p className="muted">
          Uses the{" "}
          <a href={dublinGuide} target="_blank" rel="noopener noreferrer">
            Dublin City Schools scale
          </a>
          . Based on semester grades in this app. It may differ from your
          transcript.
        </p>
        {!settings || !result ? (
          <button
            className="primary"
            onClick={() => void save({ weighting: "equal", courses: {} })}
          >
            Use Dublin GPA scale
          </button>
        ) : (
          <>
            <label>
              Semester
              <select
                value={term.id}
                onChange={(e) => setPeriod(e.target.value)}
                disabled={saving}
              >
                {terms.map(({ id, course }) => {
                  const { ordinal, start, end } = descriptor(course);
                  return (
                    <option key={id} value={id}>
                      Semester {ordinal} ·{" "}
                      {start !== undefined && end !== undefined
                        ? `${date.format(start)} – ${date.format(end)}`
                        : "dates unavailable"}
                    </option>
                  );
                })}
              </select>
            </label>
            <p className="muted" role="status">
              {settings.weighting === "equal"
                ? "Each course counts equally."
                : "Courses are weighted by entered semester credits."}
              {result.incomplete > 0 &&
                ` Partial estimate: ${result.incomplete} ${result.incomplete === 1 ? "course needs" : "courses need"} more information.`}
            </p>
            <form key={term.id} onSubmit={submit}>
              <label>
                Course weighting
                <select name="weighting" defaultValue={settings.weighting}>
                  <option value="equal">Count courses equally</option>
                  <option value="credits">Use entered semester credits</option>
                </select>
              </label>
              <p className="muted">
                Check the suggested levels and exclude classes that don’t count
                toward GPA. When a letter grade is missing, the estimate uses
                Dublin’s published percentage cutoffs.
              </p>
              {result.rows.map((row) => (
                <fieldset key={row.key} className="gpa-course">
                  <legend>{row.title}</legend>
                  <p className="muted">
                    {row.grade ?? "—"}
                    {row.inferredGrade && ` (from ${percentText(row.percent)})`}
                    {row.reason
                      ? ` · ${row.reason}`
                      : ` · ${row.weightedPoints?.toFixed(2)} weighted / ${row.points?.toFixed(2)} unweighted points`}
                    {row.conflict &&
                      " · Reported letter differs from the percentage conversion."}
                  </p>
                  <div className="gpa-fields">
                    <label>
                      Level
                      <select
                        name={row.key + ":level"}
                        defaultValue={row.override?.level ?? ""}
                      >
                        <option value="">
                          Suggested: {labels[row.suggested]}
                        </option>
                        {Object.entries(labels).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Semester credits
                      <input
                        name={row.key + ":credits"}
                        type="number"
                        min="0.001"
                        max="100"
                        step="any"
                        inputMode="decimal"
                        defaultValue={row.override?.credits ?? ""}
                      />
                    </label>
                  </div>
                  <label className="gpa-exclude">
                    <input
                      type="checkbox"
                      name={row.key + ":exclude"}
                      defaultChecked={row.override?.excluded}
                    />
                    Exclude from GPA
                  </label>
                </fieldset>
              ))}
              <button className="primary" disabled={saving}>
                Save GPA settings
              </button>
            </form>
          </>
        )}
      </div>
    </details>
  );
}
