type Fields = { [key: string]: true | Fields };
type Resource = "profile" | "courses" | "assignmentGroups" | "enrollments";
type ValueType =
  "missing" | "null" | "array" | "object" | "boolean" | "number" | "string";

// Only fixed Canvas field names and JSON types may enter a shareable report.
// Provider values, URLs, and arbitrary property names are never copied.
const enrollment: Fields = {
  user_id: true,
  course_id: true,
  type: true,
  enrollment_state: true,
  has_grading_periods: true,
  override_score: true,
  override_grade: true,
  grades: {
    current_score: true,
    current_grade: true,
    final_score: true,
    final_grade: true,
  },
};
const fields: Record<Resource, Fields> = {
  profile: { id: true },
  courses: {
    id: true,
    name: true,
    workflow_state: true,
    apply_assignment_group_weights: true,
    grading_periods: true,
    enrollments: enrollment,
    teachers: { display_name: true },
    term: { id: true, name: true, start_at: true, end_at: true },
  },
  assignmentGroups: {
    id: true,
    name: true,
    group_weight: true,
    rules: { drop_lowest: true, drop_highest: true, never_drop: true },
    assignments: {
      id: true,
      assignment_group_id: true,
      name: true,
      points_possible: true,
      due_at: true,
      omit_from_final_grade: true,
      published: true,
      grading_type: true,
      submission: {
        user_id: true,
        assignment_id: true,
        posted_at: true,
        graded_at: true,
        score: true,
        excused: true,
        missing: true,
        late: true,
      },
    },
  },
  enrollments: enrollment,
};

interface ResponseShape {
  httpStatuses: number[];
  fields: Record<string, ValueType[]>;
  sampledResponses: number;
}
export interface CarmenCompatibilityAttempt {
  result: "waiting" | "ok" | "failed";
  phase: "signIn" | "profile" | "courses" | "details" | "normalize";
  error?: string;
  responses: Partial<Record<Resource, ResponseShape>>;
}
export interface CarmenCompatibilityReport {
  schema: 1;
  signIn?: CarmenCompatibilityAttempt;
  sync?: CarmenCompatibilityAttempt;
}

export function compatibilityResource(path: string): Resource {
  if (path.endsWith("/profile")) return "profile";
  if (path.endsWith("/assignment_groups")) return "assignmentGroups";
  if (path.endsWith("/enrollments")) return "enrollments";
  return "courses";
}

export function observeCompatibility(
  attempt: CarmenCompatibilityAttempt,
  resource: Resource,
  status: number,
  data?: unknown,
) {
  const response = (attempt.responses[resource] ??= {
    httpStatuses: [],
    fields: {},
    sampledResponses: 0,
  });
  if (!response.httpStatuses.includes(status))
    response.httpStatuses.push(status);
  if (data === undefined || response.sampledResponses >= 6) return;
  response.sampledResponses++;
  function visit(value: unknown, path: string, expected: true | Fields) {
    const type: ValueType =
      value === undefined
        ? "missing"
        : value === null
          ? "null"
          : Array.isArray(value)
            ? "array"
            : typeof value === "object"
              ? "object"
              : typeof value === "boolean"
                ? "boolean"
                : typeof value === "number"
                  ? "number"
                  : "string";
    const observed = (response.fields[path] ??= []);
    if (!observed.includes(type)) observed.push(type);
    if (expected === true) return;
    if (Array.isArray(value)) {
      // A nested malformed array must not create unbounded paths.
      if (!path.endsWith("[]"))
        for (const item of value.slice(0, 5))
          visit(item, path + "[]", expected);
    } else if (value && typeof value === "object") {
      for (const [field, child] of Object.entries(expected))
        visit(
          Object.hasOwn(value, field)
            ? (value as Record<string, unknown>)[field]
            : undefined,
          path + "." + field,
          child,
        );
    }
  }
  visit(data, "$", fields[resource]);
}
