import {
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import { type Course } from "./core/model";
import {
  estimateGpa,
  gpaLetters,
  osuLetters,
  type GpaPolicy,
  gpaSemesters,
  type CourseLevel,
  type GpaLetter,
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

function GpaToggle({
  children,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { children: ReactNode }) {
  return (
    <label className="gpa-check">
      <input {...props} type="checkbox" role="switch" />
      <span className="gpa-toggle-track" aria-hidden="true" />
      {children}
    </label>
  );
}

export function GpaSummary({
  courses,
  settings,
  save,
  policy = "dublin",
}: {
  policy?: GpaPolicy;
  courses: Course[];
  settings?: GpaSettings;
  save: (settings: GpaSettings) => Promise<boolean>;
}) {
  const osu = policy === "osu",
    letters = osu ? osuLetters : gpaLetters;
  const [period, setPeriod] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [weighting, setWeighting] = useState(
    settings?.weighting ?? (osu ? "credits" : "equal"),
  );
  const [projectedGrades, setProjectedGrades] =
    useState<Partial<Record<string, GpaLetter>>>();
  const terms = gpaSemesters(courses);
  const term = terms.find(({ id }) => id === period) ?? terms[0];
  if (!term) return null;
  const result = settings && estimateGpa(courses, term, settings, {}, policy);
  const projection =
    settings &&
    projectedGrades &&
    estimateGpa(courses, term, settings, projectedGrades, policy);
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
        excluded = data.has(row.key + ":exclude"),
        letter = osuLetters.find((l) => l === data.get(row.key + ":letter"));
      const override =
        level === "regular" || level === "honors" || level === "advanced"
          ? level
          : undefined;
      if (override || credits > 0 || excluded || letter)
        next.courses[row.key] = {
          level: override,
          credits: credits > 0 ? credits : undefined,
          excluded,
          ...(osu && letter ? { letter } : {}),
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
        <strong>{osu ? "Ohio State semester GPA" : "Semester GPA"}</strong>
        <span className={result?.weighted !== undefined ? "grade" : "muted"}>
          {result?.weighted !== undefined
            ? osu
              ? result.unweighted!.toFixed(2)
              : `${result.weighted.toFixed(2)} / ${result.unweighted!.toFixed(2)}`
            : settings
              ? "Unavailable"
              : "Set up"}
        </span>
      </summary>
      <div className="gpa-content">
        {result?.weighted !== undefined && (
          <p className="muted">
            {osu
              ? "Estimate · enter credits from your schedule"
              : "Weighted / unweighted estimate"}
          </p>
        )}
        {!settings || !result ? (
          <>
            <p className="muted">
              {osu
                ? "Estimate GPA using Ohio State letter points. Course credits and any missing letters are entered locally. Carmen totals are estimates, not transcript grades."
                : "Estimate your GPA with the Dublin City Schools scale."}
            </p>
            <button
              className="primary"
              onClick={() =>
                void save({ weighting: osu ? "credits" : "equal", courses: {} })
              }
            >
              {osu ? "Use Ohio State GPA scale" : "Use Dublin GPA scale"}
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
                  onChange={(e) => {
                    setPeriod(e.target.value);
                    if (projectedGrades) setProjectedGrades({});
                  }}
                >
                  {terms.map(({ id, course }) => {
                    const { ordinal, start } = descriptor(course);
                    return (
                      <option key={id} value={id}>
                        {osu ? course.term.name : `Semester ${ordinal}`}
                        {start !== undefined ? ` · ${date.format(start)}` : ""}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <span>
                  {osu
                    ? term.course.term.name
                    : `Semester ${descriptor(term.course).ordinal}`}
                </span>
              )}
              {!editing && (
                <div className="gpa-actions">
                  {!projectedGrades && (
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
                  <button
                    className="gpa-edit"
                    onClick={() =>
                      setProjectedGrades(projectedGrades ? undefined : {})
                    }
                  >
                    {projectedGrades ? "Done" : "What-if GPA"}
                  </button>
                </div>
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
                <GpaToggle
                  name="weighting"
                  value="credits"
                  checked={weighting === "credits"}
                  onChange={(e) =>
                    setWeighting(e.target.checked ? "credits" : "equal")
                  }
                >
                  Weight by semester credits
                </GpaToggle>
                {result.rows.map((row) => (
                  <fieldset key={row.key} className="gpa-course">
                    <legend>{row.title}</legend>
                    <div className="gpa-fields">
                      <label hidden={osu}>
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
                      {osu && (
                        <label>
                          GPA letter override
                          <select
                            name={row.key + ":letter"}
                            defaultValue={row.override?.letter ?? ""}
                          >
                            <option value="">Use Carmen letter</option>
                            {osuLetters.map((l) => (
                              <option key={l}>{l}</option>
                            ))}
                          </select>
                        </label>
                      )}
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
                    <GpaToggle
                      name={row.key + ":exclude"}
                      defaultChecked={row.override?.excluded}
                    >
                      Exclude from GPA
                    </GpaToggle>
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
              <>
                {projection && (
                  <div
                    className="gpa-projection"
                    role="status"
                    aria-label="What-if GPA estimate"
                  >
                    <strong>What-if GPA</strong>
                    <span className="grade">
                      {projection.weighted === undefined
                        ? "Unavailable"
                        : osu
                          ? projection.unweighted!.toFixed(2)
                          : `${projection.weighted.toFixed(2)} / ${projection.unweighted!.toFixed(2)}`}
                    </span>
                    {projection.incomplete > 0 && (
                      <small className="muted">Partial estimate</small>
                    )}
                  </div>
                )}
                <ul className="gpa-list">
                  {result.rows.map((row) => (
                    <li key={row.key}>
                      <span>
                        {row.title}
                        <small>
                          {row.reason ??
                            (osu
                              ? row.override?.letter
                                ? "Local GPA letter"
                                : "Carmen letter"
                              : labels[row.override?.level ?? row.suggested])}
                          {row.conflict && " · Letter and percent differ"}
                        </small>
                      </span>
                      {projectedGrades && row.canProject ? (
                        <select
                          className="gpa-letter"
                          aria-label={`What-if grade for ${row.title}`}
                          value={projectedGrades[row.key] ?? ""}
                          onChange={(e) => {
                            const letter = letters.find(
                              (value) => value === e.target.value,
                            );
                            setProjectedGrades({
                              ...projectedGrades,
                              [row.key]: letter,
                            });
                          }}
                        >
                          <option value="">
                            {row.grade ? `${row.grade} (current)` : "No grade"}
                          </option>
                          {letters.map((letter) => (
                            <option key={letter}>{letter}</option>
                          ))}
                        </select>
                      ) : (
                        <strong>{row.grade ?? "—"}</strong>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="muted">
              <a
                href={
                  osu
                    ? "https://registrar.osu.edu/student-hub/transcripts-and-verifications/transcript-key/"
                    : dublinGuide
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                {osu ? "Ohio State scale" : "Dublin scale"}
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
