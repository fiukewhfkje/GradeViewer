import { useState, type FormEvent } from "react";
import { type Course } from "./core/model";
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
  advanced: "AP / IB / eligible CCP",
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
  const [editing, setEditing] = useState(false);
  const [weighting, setWeighting] = useState(settings?.weighting ?? "equal");
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
      if (await save(next)) {
        delete form.dataset.dirty;
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }
  return (
    <details className="gpa-card">
      <summary>
        <strong>Semester GPA</strong>
        <span className={result?.weighted !== undefined ? "grade" : "muted"}>
          {result?.weighted !== undefined
            ? `${result.weighted.toFixed(2)} / ${result.unweighted!.toFixed(2)}`
            : settings
              ? "Unavailable"
              : "Set up"}
        </span>
      </summary>
      <div className="gpa-content">
        {result?.weighted !== undefined && (
          <p className="muted">Weighted / unweighted estimate</p>
        )}
        {!settings || !result ? (
          <>
            <p className="muted">
              Estimate your GPA with the Dublin City Schools scale.
            </p>
            <button
              className="primary"
              onClick={() => void save({ weighting: "equal", courses: {} })}
            >
              Use Dublin GPA scale
            </button>
          </>
        ) : (
          <>
            <div className="gpa-toolbar">
              {terms.length > 1 ? (
                <select
                  aria-label="Semester"
                  value={term.id}
                  disabled={editing}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  {terms.map(({ id, course }) => {
                    const { ordinal, start } = descriptor(course);
                    return (
                      <option key={id} value={id}>
                        Semester {ordinal}
                        {start !== undefined ? ` · ${date.format(start)}` : ""}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <span>Semester {descriptor(term.course).ordinal}</span>
              )}
              {!editing && (
                <button
                  className="gpa-edit"
                  onClick={() => {
                    setWeighting(settings.weighting);
                    setEditing(true);
                  }}
                >
                  Edit courses
                </button>
              )}
            </div>
            {result.incomplete > 0 && (
              <p className="muted" role="status">
                Partial estimate · {result.incomplete}{" "}
                {result.incomplete === 1 ? "course" : "courses"} missing grades
                or credits
              </p>
            )}
            {editing ? (
              <form key={term.id} onSubmit={submit}>
                <label className="gpa-check">
                  <input
                    type="checkbox"
                    name="weighting"
                    value="credits"
                    checked={weighting === "credits"}
                    onChange={(e) =>
                      setWeighting(e.target.checked ? "credits" : "equal")
                    }
                  />
                  Weight by semester credits
                </label>
                {result.rows.map((row) => (
                  <fieldset key={row.key} className="gpa-course">
                    <legend>{row.title}</legend>
                    <div className="gpa-fields">
                      <label>
                        Level
                        <select
                          name={row.key + ":level"}
                          defaultValue={row.override?.level ?? ""}
                        >
                          <option value="">
                            Auto · {labels[row.suggested]}
                          </option>
                          {Object.entries(labels).map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label hidden={weighting !== "credits"}>
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
                    <label className="gpa-check">
                      <input
                        type="checkbox"
                        name={row.key + ":exclude"}
                        defaultChecked={row.override?.excluded}
                      />
                      Exclude from GPA
                    </label>
                  </fieldset>
                ))}
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={saving}
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                  <button className="primary" disabled={saving}>
                    Save GPA settings
                  </button>
                </div>
              </form>
            ) : (
              <ul className="gpa-list">
                {result.rows.map((row) => (
                  <li key={row.key}>
                    <span>
                      {row.title}
                      <small>
                        {row.reason ??
                          labels[row.override?.level ?? row.suggested]}
                        {row.conflict && " · Letter and percent differ"}
                      </small>
                    </span>
                    <strong>{row.grade ?? "—"}</strong>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted">
              <a href={dublinGuide} target="_blank" rel="noopener noreferrer">
                Dublin scale
              </a>
              {" · "}
              {settings.weighting === "equal"
                ? "Courses count equally"
                : "Weighted by credits"}
            </p>
          </>
        )}
      </div>
    </details>
  );
}
