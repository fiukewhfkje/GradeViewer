import { ConnectionDisclosure, PortalConnection } from "./PortalConnection";
import { refreshCampus } from "./portal-refresh";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type FormEvent,
  type RefObject,
} from "react";
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  RefreshCw,
  User,
  Settings,
  MoreVertical,
  X,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Download,
  SunMoon,
  Globe,
  LockKeyhole,
  KeyRound,
} from "lucide-react";
import { api, errorMessage, RequestError, type Status } from "./api";
import * as repository from "./repository";
import { readSnapshot } from "./refresh";
import {
  type Course,
  type Assignment,
  type SavedState,
  type Scenario,
  emptyState,
  emptyScenario,
  calculationSource,
  percentText,
  pointsText,
  scoreInput,
  recent,
  hasTitle,
  graded,
  updateAge,
} from "./core/model";
import {
  visibleCourses,
  overall,
  semesterScale,
  assignmentPeriods,
  descriptor,
  exams,
  estimateQuarter,
  latestGradeUpdate,
} from "./core/periods";
import { hypothetical, requiredFinal } from "./core/calculator";
import { AssignmentScore } from "./AssignmentScore";
import { GradeGraph } from "./GradeGraph";
import { GpaSummary } from "./GpaSummary";
import { version } from "../package.json";
import {
  checkForAppUpdate,
  activateAppUpdate,
  isNewAppShell,
  readInstallation,
  updateMessage as describeUpdate,
  type Installation,
  type OfficialRelease,
} from "./updates";
import { usePullRefresh } from "./usePullRefresh";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<unknown>;
};
type Modal = { kind: "add" | "edit"; assignment?: Assignment } | undefined;
const changed = (s: Scenario) =>
  !!(s.added.length || s.ignored.length || Object.keys(s.scores).length);
function Grade({
  percent,
  letter,
  estimate = false,
  digits = 2,
  parentheses = true,
}: {
  percent?: number;
  letter?: string;
  estimate?: boolean;
  digits?: number;
  parentheses?: boolean;
}) {
  return (
    <span className="grade">
      {letter && <span>{letter}</span>}
      {(percent !== undefined || !letter) && (
        <span>
          {percent === undefined
            ? "—"
            : parentheses
              ? `(${percentText(percent, digits)})`
              : percentText(percent, digits)}
          {estimate ? "*" : ""}
        </span>
      )}
    </span>
  );
}
function Menu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="menu">
      <summary aria-label={label}>
        <MoreVertical size={20} />
      </summary>
      <div
        className="menu-items"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button"))
            e.currentTarget.parentElement?.removeAttribute("open");
        }}
      >
        {children}
      </div>
    </details>
  );
}
function Dialog({
  title,
  children,
  close,
  initialInput,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  initialInput?: RefObject<HTMLInputElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    const input = initialInput?.current;
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, [initialInput]);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon" onClick={close} aria-label="Close dialog">
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function App() {
  const [state, setState] = useState<SavedState>(emptyState),
    stateRef = useRef(state),
    [status, setStatus] = useState<Status>(),
    [tab, setTab] = useState("grades"),
    [busy, setBusy] = useState(true),
    [fresh, setFresh] = useState(false),
    [cachedUnlocked, setCachedUnlocked] = useState(false),
    [error, setError] = useState(""),
    [deadline, setDeadline] = useState(0),
    [tick, setTick] = useState(Date.now()),
    [selected, setSelected] = useState<string>(),
    [view, setView] = useState("detail"),
    [period, setPeriod] = useState<string>(),
    [modal, setModal] = useState<Modal>(),
    [changingPassword, setChangingPassword] = useState(false),
    [passwordChanged, setPasswordChanged] = useState(false),
    [openConnections, setOpenConnections] = useState({
      schoology: false,
      campus: false,
      carmen: false,
    }),
    [install, setInstall] = useState(false),
    [prompt, setPrompt] = useState<InstallEvent>(),
    [copied, setCopied] = useState(false),
    [update, setUpdate] = useState<ServiceWorker>(),
    [checkingUpdate, setCheckingUpdate] = useState(false),
    [switchingLms, setSwitchingLms] = useState(false),
    [applyingUpdate, setApplyingUpdate] = useState(false),
    [updateMessage, setUpdateMessage] = useState(""),
    [installation, setInstallation] = useState<Installation>(),
    [theme, setTheme] = useState(() => {
      try {
        return localStorage.getItem("theme") ?? "system";
      } catch {
        return "system";
      }
    });
  const flight = useRef<Promise<void> | undefined>(undefined),
    pendingSaves = useRef(0),
    saveFailed = useRef(false),
    channel = useRef<BroadcastChannel | undefined>(undefined),
    mounted = useRef(false),
    cacheGeneration = useRef(0),
    app = useRef<HTMLDivElement>(null);
  function apply(s: SavedState) {
    stateRef.current = s;
    setState(s);
  }
  async function restoreCache() {
    const generation = cacheGeneration.current;
    const [saved, receipt] = await Promise.all([
      repository.load(),
      repository.access(),
    ]);
    if (generation === cacheGeneration.current && receipt?.locked) {
      setStatus({ authenticated: false, connected: false });
      setTab("profile");
    }
    if (
      generation === cacheGeneration.current &&
      repository.canReadCache(saved, receipt)
    ) {
      apply(saved);
      setCachedUnlocked(true);
      setFresh(true);
    }
  }
  function hideCache() {
    cacheGeneration.current++;
    setCachedUnlocked(false);
    setFresh(false);
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* Keep the selected theme in memory when storage is unavailable. */
    }
  }, [theme]);
  async function refresh(
    credentials?: { key: string; secret: string },
    manual = false,
    scope: "active" | "all" | "campus" | "carmen" = "active",
  ) {
    if (flight.current) return flight.current;
    const queuedAt = Date.now();
    const run = async () => {
      const generation = cacheGeneration.current;
      setBusy(true);
      setError("");
      try {
        const [s, latest, recovered, access] = await Promise.all([
          api<Status>("status"),
          repository.load(),
          repository.pending(),
          repository.access(),
        ]);
        setStatus(s);
        if (
          !s.authenticated ||
          access?.locked ||
          (generation !== cacheGeneration.current &&
            (await repository.access())?.locked)
        ) {
          hideCache();
          setStatus({ ...s, authenticated: false });
          await repository.lock();
          setTab("profile");
          return;
        }
        if (access?.account && s.account && access.account !== s.account) {
          hideCache();
        }
        if (!s.connected && !credentials) {
          hideCache();
          if (latest.account || stateRef.current.account) {
            await repository.clear();
            apply(emptyState());
          } else apply(latest);
          setTab("profile");
          setFresh(true);
          return;
        }
        if (latest.account === s.account) {
          apply(latest);
          // Keep the last complete snapshot usable while Schoology refreshes.
          setFresh(latest.courses.length > 0);
          setCachedUnlocked(true);
          await repository.rememberAccess(s.account, s.sessionExpires);
        } else {
          setFresh(false);
        }
        if (
          recovered &&
          s.connected &&
          recovered.account === s.account &&
          s.revision !== recovered.previousRevision
        ) {
          await repository.activate(recovered.state);
          apply(recovered.state);
          setFresh(recovered.state.courses.length > 0);
        }
        if (
          !credentials &&
          !manual &&
          latest.account === s.account &&
          latest.courses.length &&
          latest.courses.every((c) => c.fetched >= queuedAt)
        ) {
          setFresh(true);
          return;
        }
        const target = credentials
          ? "schoology"
          : scope === "active"
            ? (latest.primaryLms ?? stateRef.current.primaryLms) === "carmen"
              ? "carmen"
              : "schoology"
            : scope;
        const portalOnly = target === "campus" || target === "carmen";
        let schoologyError: unknown;
        let next = stateRef.current;
        if (portalOnly && latest.account !== s.account)
          next = await readSnapshot(next, { ...s, schoologyConnected: false });
        try {
          if (!portalOnly) {
            if (s.cooldown && s.cooldown > Date.now())
              throw new RequestError(
                "rateLimited",
                Math.ceil((s.cooldown - Date.now()) / 1000),
              );
            next = await readSnapshot(stateRef.current, s, credentials, manual);
          }
        } catch (e) {
          if (credentials || stateRef.current.account !== s.account) throw e;
          schoologyError = e;
        }
        if (
          generation !== cacheGeneration.current &&
          (await repository.access())?.locked
        )
          return;
        apply(next);
        setFresh(true);
        const portalStatus = s;
        let portalFailed = false;
        setStatus(portalStatus);
        if (
          (target === "all" || target === "schoology" || target === "campus") &&
          (portalStatus.portals?.campus?.connected ||
            next.courses.some((c) => c.fields.provider === "campus"))
        ) {
          try {
            next = await refreshCampus(next, portalStatus.portals?.campus);
            apply(next);
          } catch (e) {
            portalFailed = true;
            setError(errorMessage(e));
          }
        }
        if (
          (target === "all" || target === "carmen") &&
          (portalStatus.portals?.carmen?.connected ||
            next.courses.some((c) => c.fields.provider === "carmen"))
        ) {
          try {
            next = await refreshCampus(
              next,
              portalStatus.portals?.carmen,
              "carmen",
            );
            apply(next);
          } catch (e) {
            portalFailed = true;
            setError(errorMessage(e));
          }
        }
        if (schoologyError) {
          setError(errorMessage(schoologyError));
          if (
            schoologyError instanceof RequestError &&
            schoologyError.retryAfter
          )
            setDeadline(Date.now() + schoologyError.retryAfter * 1000);
        } else if (!portalOnly) setDeadline(0);
        if (
          generation !== cacheGeneration.current &&
          (await repository.access())?.locked
        )
          return;
        await repository.rememberAccess(next.account, s.sessionExpires);
        setCachedUnlocked(true);
        channel.current?.postMessage("saved");
        setStatus({
          ...(credentials || portalFailed || target === "carmen"
            ? await api<Status>("status")
            : portalStatus),
          connected: true,
          account: next.account,
          cooldown: undefined,
        });
      } catch (e) {
        setError(errorMessage(e));
        if (e instanceof RequestError && e.retryAfter)
          setDeadline(Date.now() + e.retryAfter * 1000);
        throw e;
      } finally {
        setBusy(false);
        flight.current = undefined;
      }
    };
    const task = navigator.locks
      ? navigator.locks
          .request("gradeviewer-refresh", run)
          .then(() => undefined)
      : run();
    flight.current = task;
    return task;
  }
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    void restoreCache().catch(() => {});
    void refresh().catch(() => {});
    const bc = new BroadcastChannel("gradeviewer");
    channel.current = bc;
    bc.onmessage = (event) => {
      if (["locked", "disconnect"].includes(event.data)) {
        hideCache();
        setTab("profile");
        setSelected(undefined);
        setModal(undefined);
        setStatus({ authenticated: false, connected: false });
        return;
      }
      void (async () => {
        const remote = await api<Status>("status");
        setStatus(remote);
        if (!remote.authenticated || (await repository.access())?.locked) {
          hideCache();
          setSelected(undefined);
          setModal(undefined);
          setFresh(false);
          setTab("profile");
          return;
        }
        const saved = await repository.load();
        if (remote.connected && saved.account === remote.account) {
          apply(saved);
          if (event.data === "saved") setFresh(true);
        } else {
          setSelected(undefined);
          setModal(undefined);
          setFresh(false);
          setTab("profile");
        }
      })().catch((e) => setError(errorMessage(e)));
    };
    let wasHidden = document.visibilityState === "hidden";
    const visibility = () => {
      const returning = document.visibilityState === "visible" && wasHidden;
      wasHidden = document.visibilityState === "hidden";
      if (returning) {
        void refresh().catch(() => {});
      }
      if (returning && "serviceWorker" in navigator) {
        void navigator.serviceWorker
          .getRegistration()
          .then((reg) => reg && checkForAppUpdate(reg))
          .then((worker) => {
            if (worker) setUpdate(worker);
          })
          .catch(() => {});
      }
    };
    const installer = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", installer);
    document.addEventListener("visibilitychange", visibility);
    void readInstallation()
      .then(setInstallation)
      .catch(() => {});
    if ("serviceWorker" in navigator) {
      let hadController = !!navigator.serviceWorker.controller;
      const offer = (worker: ServiceWorker) => {
        void isNewAppShell(worker)
          .then((changed) => {
            if (changed) setUpdate(worker);
          })
          .catch(() => {});
      };
      void navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((reg) => {
          if (reg.waiting) offer(reg.waiting);
          const observe = () => {
            const worker = reg.installing;
            worker?.addEventListener("statechange", () => {
              if (
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              )
                offer(worker);
            });
          };
          observe();
          reg.addEventListener("updatefound", observe);
        })
        .catch(() => {});
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // Another tab can accept an update without interrupting this tab's forms.
        if (hadController && navigator.serviceWorker.controller)
          offer(navigator.serviceWorker.controller);
        hadController = true;
      });
    }
    // This application root lives for the whole page; the setup guard also tolerates StrictMode.
    window.addEventListener(
      "pagehide",
      () => {
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("beforeinstallprompt", installer);
        bc.close();
      },
      { once: true },
    );
  }, []);
  useEffect(() => {
    if (!passwordChanged) return;
    const timer = setTimeout(() => setPasswordChanged(false), 5000);
    return () => clearTimeout(timer);
  }, [passwordChanged]);
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => {
      setTick(Date.now());
      if (Date.now() >= deadline) {
        setDeadline(0);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  async function persist(next: SavedState) {
    pendingSaves.current++;
    try {
      if (flight.current) {
        const before = stateRef.current;
        await flight.current.catch(() => {});
        const current = stateRef.current;
        if (current.account !== before.account)
          throw new Error("storageFailed");
        // A form can stay open during refresh. Apply only its local changes to
        // the new snapshot instead of saving the older provider data over it.
        const scenarios = { ...current.scenarios };
        for (const [id, value] of Object.entries(next.scenarios))
          if (value !== before.scenarios[id]) scenarios[id] = value;
        const local = new Map(next.courses.map((c) => [c.id, c]));
        const previous = new Map(before.courses.map((c) => [c.id, c]));
        next = {
          ...current,
          scenarios,
          gpa: next.gpa !== before.gpa ? next.gpa : current.gpa,
          carmenGpa:
            next.carmenGpa !== before.carmenGpa
              ? next.carmenGpa
              : current.carmenGpa,
          primaryLms:
            next.primaryLms !== before.primaryLms
              ? next.primaryLms
              : current.primaryLms,
          courses: current.courses.map((c) => {
            const edit = local.get(c.id),
              old = previous.get(c.id);
            return edit && old
              ? {
                  ...c,
                  removed:
                    edit.removed !== old.removed ? edit.removed : c.removed,
                  hidden: edit.hidden !== old.hidden ? edit.hidden : c.hidden,
                  order: edit.order !== old.order ? edit.order : c.order,
                }
              : c;
          }),
        };
      }
      await repository.save(next);
      apply(next);
      channel.current?.postMessage("local");
      saveFailed.current = false;
      return true;
    } catch (e) {
      saveFailed.current = true;
      setError(errorMessage(e));
      return false;
    } finally {
      pendingSaves.current--;
    }
  }
  function scenario(c: Course) {
    return state.scenarios[c.id] ?? emptyScenario();
  }
  function saveScenario(c: Course, s: Scenario) {
    void persist({
      ...stateRef.current,
      scenarios: { ...stateRef.current.scenarios, [c.id]: s },
    });
  }
  function mutateCourse(c: Course, change: Partial<Course>) {
    void persist({
      ...stateRef.current,
      courses: stateRef.current.courses.map((x) =>
        x.id === c.id ? { ...x, ...change } : x,
      ),
    });
  }
  const usingCarmen = state.primaryLms === "carmen";
  const workspaceCourses = state.courses.filter((c) =>
    usingCarmen
      ? c.fields.provider === "carmen"
      : c.fields.provider !== "carmen",
  );
  const original = workspaceCourses.find((c) => c.id === selected),
    course = original
      ? ((view !== "detail"
          ? state.courses.find((c) => c.id === period)
          : undefined) ?? original)
      : undefined;
  const choose = (c: Course) => {
    setSelected(c.id);
    setPeriod(c.id);
    setView("detail");
  };
  function list(
    c: Course,
    all = false,
    readOnly = false,
    subset?: Assignment[],
  ) {
    const s = scenario(c),
      rows =
        subset ??
        (readOnly
          ? c.assignments
          : [
              ...s.added,
              ...c.assignments.filter((a) => !c.removed.includes(a.id)),
            ]),
      items = readOnly
        ? recent(rows)
        : all
          ? [
              ...recent(rows),
              ...rows
                .filter((a) => !graded(a) && hasTitle(a))
                .sort(
                  (a, b) =>
                    (a.due ?? Infinity) - (b.due ?? Infinity) ||
                    a.title.localeCompare(b.title) ||
                    a.id.localeCompare(b.id),
                ),
            ]
          : [
              ...[...s.added].reverse(),
              ...recent(
                rows.filter((a) => !s.added.some((added) => added.id === a.id)),
              ),
            ].slice(0, 5);
    return items.length ? (
      <div className="rows">
        {items.map((a) => {
          const dropped = s.ignored.includes(a.id),
            modified =
              s.scores[a.id] !== undefined ||
              s.added.some((x) => x.id === a.id) ||
              dropped,
            age = graded(a) ? updateAge(a.updated) : undefined;
          return (
            <div
              key={a.id}
              className={"assignment row " + (dropped ? "dropped" : "")}
            >
              <div className="row-text">
                <strong>{a.title}</strong>
                <small>
                  {age?.text ?? (!graded(a) ? "Not graded" : "")}
                  {age &&
                    (age.fresh ? (
                      <CheckCircle2 size={14} />
                    ) : (
                      <Clock size={14} />
                    ))}
                  {a.excluded ? " · Not counted" : ""}
                </small>
              </div>
              <div className={"score " + (modified ? "modified" : "")}>
                <AssignmentScore score={a.score} override={s.scores[a.id]} />
              </div>
              {!readOnly && (
                <Menu label={"Options for " + a.title}>
                  <button
                    onClick={() => setModal({ kind: "edit", assignment: a })}
                  >
                    Edit Grade
                  </button>
                  <button
                    onClick={() =>
                      saveScenario(c, {
                        ...s,
                        ignored: dropped
                          ? s.ignored.filter((id) => id !== a.id)
                          : [...s.ignored, a.id],
                      })
                    }
                  >
                    {dropped ? "Undrop Assignment" : "Drop Assignment"}
                  </button>
                  {s.added.some((x) => x.id === a.id) ? (
                    <button
                      onClick={() => {
                        const scores = { ...s.scores };
                        delete scores[a.id];
                        saveScenario(c, {
                          ...s,
                          added: s.added.filter((x) => x.id !== a.id),
                          scores,
                          ignored: s.ignored.filter((id) => id !== a.id),
                        });
                      }}
                    >
                      Remove Grade
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          const scores = { ...s.scores };
                          delete scores[a.id];
                          saveScenario(c, {
                            ...s,
                            scores,
                            ignored: s.ignored.filter((id) => id !== a.id),
                          });
                        }}
                      >
                        Reset Assignment
                      </button>
                      {!hasTitle(a) && (
                        <button
                          onClick={() =>
                            mutateCourse(c, { removed: [...c.removed, a.id] })
                          }
                        >
                          Remove Assignment
                        </button>
                      )}
                    </>
                  )}
                </Menu>
              )}
            </div>
          );
        })}
      </div>
    ) : (
      <p className="muted">
        {readOnly
          ? "No graded exam assignments."
          : `No ${all ? "assignments" : "graded assignments"} in this period.`}
      </p>
    );
  }
  function groupedAssignments(c: Course) {
    const added = scenario(c).added;
    const actual = c.assignments.filter(
      (a) => !c.removed.includes(a.id) && (graded(a) || hasTitle(a)),
    );
    const groups: { id: string; title: string; rows: Assignment[] }[] = [];
    if (added.length)
      groups.push({ id: "added", title: "Added Grades", rows: added });
    if (!c.categories.length) {
      if (actual.length)
        groups.push({ id: "total", title: "Total Points", rows: actual });
    } else {
      const used = new Set<string>();
      for (const category of c.categories) {
        const rows = actual.filter((a) => a.categoryID === category.id);
        rows.forEach((a) => used.add(a.id));
        if (rows.length)
          groups.push({ id: category.id, title: category.name, rows });
      }
      const other = actual.filter((a) => !used.has(a.id));
      if (other.length)
        groups.push({ id: "other", title: "Other Assignments", rows: other });
    }
    return groups.length ? (
      groups.map((group) => (
        <details key={group.id} className="assignment-group">
          <summary aria-label={group.title}>
            <span className="group-chevron">
              <ChevronRight size={19} />
            </span>
            <strong>{group.title}</strong>
            {group.id === "total" && <Grade {...c.grade} />}
          </summary>
          {list(c, true, false, group.rows)}
        </details>
      ))
    ) : (
      <p className="muted">No assignments in this period.</p>
    );
  }
  function quarterSummary(c: Course) {
    if (descriptor(c).kind !== "quarter") return null;
    const estimate = estimateQuarter(c, state.courses),
      label = descriptor(c).label;
    return (
      <section className="quarter-summary row">
        <div className="section-heading">
          <h2>{label} Grade</h2>
          {estimate ? (
            <span className="grade">
              {percentText(estimate.percent, estimate.digits)}*
            </span>
          ) : (
            <Grade {...c.grade} />
          )}
        </div>
        {estimate && (
          <p className="muted">
            *Estimated from {estimate.semester} and reported period weights.
            {estimate.blankExam ? " Blank exam omitted." : ""} Rounded totals
            limit precision. Replaced when grades are available.
          </p>
        )}
      </section>
    );
  }
  function summary(c: Course, whole: boolean) {
    const base = whole ? overall(c, state.courses) : c,
      est = estimateQuarter(c, state.courses),
      s = scenario(c),
      hasChanges = changed(s),
      q = hasChanges ? hypothetical(calculationSource(c), s) : undefined,
      scale =
        base.id === c.id ? undefined : semesterScale(c, base, state.courses),
      semesterDelta =
        q?.delta !== undefined && scale !== undefined
          ? q.delta * scale
          : undefined,
      projected =
        semesterDelta !== undefined && base.grade.percent !== undefined,
      sim = projected ? base.grade.percent! + semesterDelta : q?.percent,
      delta = projected ? semesterDelta : q?.delta,
      simulatedPeriod = descriptor(projected ? base : c).label;
    const age = updateAge(latestGradeUpdate(c, state.courses));
    return (
      <>
        <div className="summary row">
          <div className="row-text">
            <strong>Course Grade</strong>
            <small>
              {whole && base.id !== c.id
                ? descriptor(base).label + " overall"
                : descriptor(c).label}
            </small>
            {base.fields.overall_override === "true" && (
              <small>
                <span className="override-tag">Teacher override</span>
              </small>
            )}
            {age && (
              <small className={age.fresh ? "updated fresh" : "updated"}>
                <span>{age.text}</span>
                {age.fresh ? <CheckCircle2 size={14} /> : <Clock size={14} />}
              </small>
            )}
          </div>
          <Grade
            percent={base.grade.percent ?? est?.percent}
            letter={base.grade.letter}
            estimate={base.grade.percent === undefined && !!est}
            digits={base.grade.percent === undefined && est ? est.digits : 2}
          />
          <Menu label="Course options">
            <button
              onClick={() => {
                setView("assignments");
                setPeriod(c.id);
              }}
            >
              View All Assignments
            </button>
            <button onClick={() => setModal({ kind: "add" })}>Add Grade</button>
            <button
              onClick={() => {
                setView("categories");
                setPeriod(c.id);
              }}
            >
              Categories
            </button>
            <button onClick={() => setView("final")}>
              Final Grade Calculator
            </button>
            <button
              disabled={!changed(s)}
              onClick={() => saveScenario(c, emptyScenario())}
            >
              Reset All Changes
            </button>
            {!!c.removed.length && (
              <button onClick={() => mutateCourse(c, { removed: [] })}>
                Restore Removed Assignments
              </button>
            )}
          </Menu>
        </div>

        {sim !== undefined && (
          <div className="scenario-grade what-if" aria-label="What-If grade">
            <small>What-if · {simulatedPeriod}</small>
            <strong>{percentText(sim)}</strong>
            {delta !== undefined && (
              <small className="scenario-delta">
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(2)}%
              </small>
            )}
          </div>
        )}
        {hasChanges && sim === undefined && (
          <p className="muted">
            Changes apply to assignments only. A what-if course grade is
            unavailable.
          </p>
        )}
        {base.grade.percent === undefined && est && (
          <p className="muted">
            * Estimated from {est.semester} and reported period weights. Rounded
            inputs limit precision.
            {est.blankExam ? " Blank exam excluded." : ""}
          </p>
        )}
      </>
    );
  }
  async function activateUpdate() {
    if (!update || applyingUpdate || modal || changingPassword) return;
    if (
      flight.current ||
      pendingSaves.current ||
      saveFailed.current ||
      document.querySelector("form[data-dirty='true']")
    ) {
      setUpdateMessage(
        flight.current
          ? "Finishing your grade refresh. Try Update now in a moment."
          : "Save or close your open changes before updating.",
      );
      return;
    }
    setApplyingUpdate(true);
    try {
      await activateAppUpdate(update, () => location.reload());
    } catch {
      setUpdateMessage(
        "The update could not activate. Your data is retained. Check again and retry.",
      );
      setApplyingUpdate(false);
    }
  }
  async function checkUpdates() {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    setUpdateMessage("");
    try {
      if (!navigator.onLine) throw new Error("offline");
      const registration =
        "serviceWorker" in navigator
          ? await navigator.serviceWorker.getRegistration()
          : undefined;
      const [shell, deployed, official] = await Promise.allSettled([
        registration
          ? checkForAppUpdate(registration)
          : Promise.resolve(undefined),
        readInstallation(),
        api<OfficialRelease>("releases/latest"),
      ]);
      let worker = shell.status === "fulfilled" ? shell.value : undefined;
      if (deployed.status === "fulfilled") {
        setInstallation(deployed.value);
      }
      if (worker) {
        setUpdate(worker);
        setUpdateMessage(
          "Update ready. Save any open changes, then choose Update now.",
        );
      } else if (update && update.state !== "redundant") {
        setUpdateMessage(
          "Update ready. Save any open changes, then choose Update now.",
        );
      } else if (shell.status === "rejected") throw shell.reason;
      else if (
        deployed.status === "fulfilled" &&
        official.status === "fulfilled"
      )
        setUpdateMessage(
          describeUpdate(version, deployed.value, official.value, false),
        );
      else throw new Error("release check unavailable");
    } catch {
      setUpdateMessage(
        navigator.onLine
          ? "Couldn’t check official releases or your deployment. Try again; your saved data is retained."
          : "You’re offline. Connect to check for updates.",
      );
    } finally {
      setCheckingUpdate(false);
    }
  }
  async function disconnect() {
    try {
      if (status?.portals?.carmen?.connected) {
        await api("schoology/disconnect", {});
        const current = stateRef.current;
        const next = {
          ...current,
          courses: current.courses.filter(
            (c) => c.fields.provider === "carmen",
          ),
          scenarios: Object.fromEntries(
            Object.entries(current.scenarios).filter(([id]) =>
              id.startsWith("carmen:"),
            ),
          ),
          metadata: undefined,
          gpa: undefined,
        };
        await repository.save(next);
        apply(next);
        await refresh(undefined, true);
        return;
      }
      await api("disconnect", {});
      hideCache();
      apply(emptyState());
      setStatus({ authenticated: false, connected: false });
      setSelected(undefined);
      setFresh(false);
      setError("");
      channel.current?.postMessage("disconnect");
      await repository.clear();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    app.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [tab, selected, view]);
  const locked = !status?.authenticated && !cachedUnlocked;
  const schoologyConnected = !!(
    status?.schoologyConnected ?? status?.connected
  );
  const disclose = (kind: keyof typeof openConnections, open: boolean) =>
    setOpenConnections((previous) =>
      previous[kind] === open ? previous : { ...previous, [kind]: open },
    );
  const schoologyForm = (
    <Connection
      connected={schoologyConnected}
      busy={busy}
      connect={async (credentials) => {
        await refresh(credentials);
        setTab("grades");
      }}
      disconnect={disconnect}
      retainsCarmen={!!status?.portals?.carmen?.connected}
    />
  );
  const canRefresh =
    !busy &&
    !locked &&
    (!!status?.connected || cachedUnlocked) &&
    (usingCarmen || deadline <= Date.now());
  async function refreshStatus() {
    const current = await api<Status>("status");
    if (!current.authenticated) {
      await refresh();
      return;
    }
    setStatus(current);
  }
  async function switchLms(carmen: boolean) {
    const before = stateRef.current.primaryLms;
    const next: SavedState = {
      ...stateRef.current,
      primaryLms: carmen ? "carmen" : "schoology",
    };
    setSwitchingLms(true);
    setError("");
    const saving = persist(next);
    apply(next);
    setSelected(undefined);
    setPeriod(undefined);
    try {
      if (!(await saving)) apply({ ...stateRef.current, primaryLms: before });
    } finally {
      setSwitchingLms(false);
    }
  }
  const pull = usePullRefresh(
    app,
    canRefresh && tab === "grades" && fresh && !modal && !install,
    () => refresh(undefined, true),
  );
  return (
    <>
      <div
        className="app-scroll"
        ref={app}
        onInputCapture={(e) => {
          const form = (e.target as HTMLElement).closest("form");
          if (form) form.dataset.dirty = "true";
        }}
      >
        <div
          className={
            "app" +
            (tab === "profile" ? " settings-screen" : "") +
            (tab === "grades" && selected && fresh ? " course-screen" : "")
          }
        >
          <div
            className="pull-refresh"
            role="status"
            aria-live="polite"
            data-visible={pull.distance > 0}
            data-phase={pull.phase}
            style={{ transform: `translateY(${pull.distance - 50}px)` }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              aria-hidden="true"
              className={pull.phase === "refreshing" ? "spinning" : ""}
              style={
                pull.phase === "refreshing"
                  ? undefined
                  : { transform: `rotate(${pull.distance * 4}deg)` }
              }
            >
              {Array.from({ length: 12 }, (_, i) => (
                <line
                  key={i}
                  x1="12"
                  y1="3"
                  x2="12"
                  y2="6"
                  transform={`rotate(${i * 30} 12 12)`}
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity={(i + 1) / 12}
                />
              ))}
            </svg>
            <span className="sr-only">
              {pull.phase === "refreshing" ? "Refreshing grades" : ""}
            </span>
          </div>
          <div
            className="refresh-content"
            data-pulling={pull.phase === "pulling"}
            style={{ transform: `translateY(${pull.distance}px)` }}
          >
            <header>
              <div>
                {selected && (
                  <button
                    className="back"
                    aria-label="Back"
                    onClick={() => {
                      if (view !== "detail") setView("detail");
                      else setSelected(undefined);
                    }}
                  >
                    <ChevronLeft />
                    {view === "detail" ? "My grades" : original?.title}
                  </button>
                )}
                <h1>
                  {tab === "profile"
                    ? "Settings"
                    : selected
                      ? view === "detail"
                        ? original?.title
                        : view === "assignments" || view === "categories"
                          ? original?.title
                          : "Final grade"
                      : "My grades"}
                </h1>
              </div>
              {selected ? (
                <button
                  className="icon"
                  aria-label="Close course"
                  onClick={() => setSelected(undefined)}
                >
                  <X />
                </button>
              ) : (
                <button
                  className={"icon desktop-refresh " + (busy ? "spinning" : "")}
                  aria-label="Refresh grades"
                  disabled={!canRefresh}
                  onClick={() => void refresh(undefined, true).catch(() => {})}
                >
                  <RefreshCw size={21} />
                </button>
              )}
            </header>
            {update && (
              <aside className="update">
                {applyingUpdate ? "Installing update…" : "An update is ready."}
                <button
                  disabled={busy || applyingUpdate || !!modal}
                  onClick={activateUpdate}
                >
                  {applyingUpdate ? "Updating…" : "Reload to update"}
                </button>
              </aside>
            )}
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            {fresh && tab === "grades" && error && (
              <div className="refresh-status" role="status">
                Showing saved grades.{" "}
                <button
                  disabled={!canRefresh}
                  onClick={() => void refresh().catch(() => {})}
                >
                  Retry
                </button>
              </div>
            )}
            <main
              className={
                tab === "profile"
                  ? "profile"
                  : course && view === "detail"
                    ? "course-detail"
                    : undefined
              }
            >
              {tab === "profile" ? (
                <>
                  <div className="settings-layout">
                    <div className="settings-column settings-connections">
                      {locked ? (
                        <section className="settings-group">
                          <h2>Unlock GradeViewer</h2>
                          <div className="settings-card">
                            <Unlock
                              onUnlock={async (password) => {
                                await api("login", { password });
                                await repository.unlock();
                                await refresh();
                              }}
                            />
                          </div>
                        </section>
                      ) : (
                        <section className="settings-group">
                          <h2>Connections</h2>
                          <div className="settings-card">
                            {!usingCarmen && (
                              <>
                                {schoologyConnected ? (
                                  <ConnectionDisclosure
                                    title="Schoology"
                                    icon={<User size={20} />}
                                    label="Connected"
                                    tone="connected"
                                    open={openConnections.schoology}
                                    onToggle={(open) =>
                                      disclose("schoology", open)
                                    }
                                  >
                                    {schoologyForm}
                                  </ConnectionDisclosure>
                                ) : (
                                  <>
                                    <div className="connection-heading">
                                      <span className="settings-icon">
                                        <User size={20} />
                                      </span>
                                      <strong>Schoology</strong>
                                      <span
                                        className="connection"
                                        data-health="neutral"
                                      >
                                        <span className="status-dot" />
                                        Set up
                                      </span>
                                    </div>
                                    {schoologyForm}
                                  </>
                                )}
                                <PortalConnection
                                  status={status?.portals?.campus}
                                  refreshStatus={refreshStatus}
                                  disabled={!schoologyConnected}
                                  open={openConnections.campus}
                                  onToggle={(open) => disclose("campus", open)}
                                  refresh={async () => {
                                    await flight.current?.catch(() => {});
                                    await refresh(undefined, true, "campus");
                                  }}
                                />
                              </>
                            )}
                            <PortalConnection
                              provider="carmen"
                              status={status?.portals?.carmen}
                              refreshStatus={refreshStatus}
                              disabled={!status?.authenticated || busy}
                              open={openConnections.carmen}
                              onToggle={(open) => disclose("carmen", open)}
                              refresh={async () => {
                                await flight.current?.catch(() => {});
                                await refresh(undefined, true, "carmen");
                              }}
                            >
                              <div className="portal-body">
                                <label className="gpa-check">
                                  <input
                                    type="checkbox"
                                    role="switch"
                                    checked={usingCarmen}
                                    disabled={busy || switchingLms}
                                    onChange={(event) =>
                                      void switchLms(
                                        event.target.checked,
                                      ).catch((e) => setError(errorMessage(e)))
                                    }
                                  />
                                  <span
                                    className="gpa-toggle-track"
                                    aria-hidden="true"
                                  />
                                  <span>Use Carmen as main LMS</span>
                                </label>
                              </div>
                            </PortalConnection>
                          </div>
                        </section>
                      )}
                      <section className="settings-group">
                        <h2>Preferences</h2>
                        <label className="settings-card settings-row">
                          <span className="settings-icon">
                            <SunMoon size={20} />
                          </span>
                          <span className="settings-label">Theme</span>
                          <span className="theme-control">
                            <select
                              aria-label="Theme"
                              value={theme}
                              onChange={(e) => setTheme(e.target.value)}
                            >
                              <option value="system">System</option>
                              <option value="light">Light</option>
                              <option value="dark">Dark</option>
                            </select>
                            <ChevronDown size={15} aria-hidden="true" />
                          </span>
                        </label>
                      </section>
                    </div>
                    <div className="settings-column settings-preferences">
                      {!locked && (
                        <section className="settings-group app-actions">
                          <h2>Security</h2>
                          <div className="settings-card">
                            <button
                              disabled={!status?.authenticated || busy}
                              onClick={() => {
                                setPasswordChanged(false);
                                setChangingPassword(true);
                              }}
                            >
                              <KeyRound size={18} /> Change app password
                            </button>
                            {(status?.authenticated || cachedUnlocked) && (
                              <button
                                className="secondary"
                                onClick={async () => {
                                  try {
                                    await repository.lock();
                                    hideCache();
                                    setStatus({
                                      authenticated: false,
                                      connected: false,
                                    });
                                    channel.current?.postMessage("locked");
                                    await api("logout", {});
                                  } catch (e) {
                                    setError(errorMessage(e));
                                  }
                                }}
                              >
                                <LockKeyhole size={18} /> Lock app
                              </button>
                            )}
                          </div>
                          {passwordChanged && (
                            <p className="settings-note" role="status">
                              App password changed.
                            </p>
                          )}
                        </section>
                      )}
                      <section className="settings-group personal-site">
                        <h2>Your personal website</h2>
                        <div className="settings-card site-card">
                          <div className="site-heading">
                            <span className="settings-icon">
                              <Globe size={20} />
                            </span>
                            <strong>Your app address</strong>
                          </div>
                          <label>
                            Website address
                            <input
                              readOnly
                              value={location.origin}
                              onFocus={(e) => e.target.select()}
                            />
                          </label>
                          <div className="button-row">
                            <button
                              className="secondary"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(
                                    location.origin,
                                  );
                                  setCopied(true);
                                } catch {
                                  setCopied(false);
                                  setError(
                                    "Select the website address above and copy it.",
                                  );
                                }
                              }}
                            >
                              {copied ? (
                                <Check size={17} />
                              ) : (
                                <Copy size={17} />
                              )}{" "}
                              {copied ? "Copied" : "Copy address"}
                            </button>
                            <a
                              className="secondary"
                              href={location.origin}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open <ExternalLink size={16} />
                            </a>
                          </div>
                          <button
                            className="secondary full"
                            onClick={() => setInstall(true)}
                          >
                            <Download size={18} /> Add to Home Screen{" "}
                            <ChevronRight size={17} />
                          </button>
                        </div>
                      </section>
                      <section className="settings-group app-actions">
                        <h2>App</h2>
                        <div className="settings-card">
                          <button
                            disabled={
                              checkingUpdate || applyingUpdate || !!modal
                            }
                            onClick={() => void checkUpdates()}
                          >
                            <Download
                              size={18}
                              className={checkingUpdate ? "spinning" : ""}
                            />
                            {checkingUpdate
                              ? "Checking for updates…"
                              : "Check for updates"}
                          </button>
                          {update && (
                            <button
                              disabled={busy || applyingUpdate || !!modal}
                              onClick={activateUpdate}
                            >
                              <RefreshCw size={18} />{" "}
                              {applyingUpdate ? "Updating…" : "Update now"}
                            </button>
                          )}
                          {(status?.authenticated || cachedUnlocked) && (
                            <button
                              className="secondary full"
                              disabled={!canRefresh}
                              onClick={() =>
                                void refresh(undefined, true).catch(() => {})
                              }
                            >
                              <RefreshCw size={18} /> Refresh grades
                            </button>
                          )}
                        </div>
                      </section>
                    </div>
                  </div>
                  {installation?.automation === "missing" && (
                    <p className="settings-note" role="status">
                      Automatic updates need a one-time setup repair.{" "}
                      <a
                        href="https://github.com/fiukewhfkje/GradeViewer/blob/main/docs/AUTOMATIC_UPDATES.md"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Setup guide
                      </a>
                    </p>
                  )}
                  {updateMessage && (
                    <p className="update-result" role="status">
                      {updateMessage}
                    </p>
                  )}
                  <p className="profile-footnote">GradeViewer {version}</p>
                </>
              ) : !fresh ? (
                !busy && (
                  <div className="gate">
                    <>
                      <h2>
                        {locked && status
                          ? "Unlock GradeViewer"
                          : "Fresh grades unavailable"}
                      </h2>
                      <p>
                        Your saved data is retained. Retry or check your
                        connection in Settings.
                      </p>
                      {deadline > Date.now() && (
                        <p>
                          Retrying in{" "}
                          {Math.max(0, Math.ceil((deadline - tick) / 1000))}s
                        </p>
                      )}
                      <button
                        className="primary"
                        disabled={deadline > Date.now()}
                        onClick={() =>
                          locked && status
                            ? setTab("profile")
                            : void refresh().catch(() => {})
                        }
                      >
                        {locked && status ? "Open Settings" : "Retry"}
                      </button>
                    </>
                  </div>
                )
              ) : !course ? (
                <>
                  {!usingCarmen && (
                    <GpaSummary
                      key={state.account}
                      courses={state.courses.filter(
                        (c) => c.fields.provider !== "carmen",
                      )}
                      settings={state.gpa}
                      save={(gpa) => persist({ ...stateRef.current, gpa })}
                    />
                  )}
                  {usingCarmen && (
                    <GpaSummary
                      key={state.account + ":carmen"}
                      policy="osu"
                      courses={state.courses.filter(
                        (c) => c.fields.provider === "carmen",
                      )}
                      settings={state.carmenGpa}
                      save={(carmenGpa) =>
                        persist({ ...stateRef.current, carmenGpa })
                      }
                    />
                  )}
                  <div className="courses">
                    {visibleCourses(workspaceCourses).map((c) => {
                      const grade = overall(c, state.courses).grade,
                        age = updateAge(latestGradeUpdate(c, state.courses));
                      return (
                        <button
                          className="course row"
                          key={c.id}
                          onClick={() => choose(c)}
                        >
                          <div className="row-text">
                            <strong>{c.title}</strong>
                            {age && (
                              <small
                                className={
                                  age.fresh ? "updated fresh" : "updated"
                                }
                              >
                                <span>{age.text}</span>
                                {age.fresh ? (
                                  <CheckCircle2 size={14} />
                                ) : (
                                  <Clock size={14} />
                                )}
                              </small>
                            )}
                          </div>
                          <Grade {...grade} />
                          <ChevronRight size={22} />
                        </button>
                      );
                    })}
                  </div>
                  {!workspaceCourses.length && (
                    <div className="gate">
                      <h2>
                        {usingCarmen ? "No Carmen grades yet" : "No grades yet"}
                      </h2>
                      {usingCarmen && (
                        <p>
                          {status?.portals?.carmen?.connected
                            ? "The connection can still be checked in Settings even when your course list is empty."
                            : "Connect CarmenCanvas in Settings to start the session experiment."}
                        </p>
                      )}
                      <button
                        className="primary"
                        onClick={() => setTab("profile")}
                      >
                        Open Settings
                      </button>
                    </div>
                  )}
                </>
              ) : view === "final" ? (
                <FinalCalculator course={overall(course, state.courses)} />
              ) : view === "assignments" || view === "categories" ? (
                <>
                  <div className="pills" aria-label="Assignment periods">
                    {assignmentPeriods(original!, state.courses).map((c) => (
                      <button
                        key={c.id}
                        aria-pressed={c.id === course.id}
                        onClick={() => setPeriod(c.id)}
                      >
                        {descriptor(c).label}
                      </button>
                    ))}
                  </div>
                  {summary(course, true)}
                  {quarterSummary(course)}
                  {groupedAssignments(course)}
                  {exams(course, state.courses).map((exam) => (
                    <section key={exam.id}>
                      <div className="section-heading">
                        <h2>Exam</h2>
                        {(exam.grade.percent !== undefined ||
                          exam.grade.letter) && <Grade {...exam.grade} />}
                      </div>
                      {list(exam, true, true)}
                    </section>
                  ))}
                </>
              ) : (
                <>
                  <div className="course-overview">
                    {summary(course, true)}
                    <GradeGraph
                      key={course.id}
                      course={course}
                      all={state.courses}
                    />
                  </div>
                  <section className="recent-assignments">
                    <h2>Recently Graded Assignments</h2>
                    {list(course)}
                    <button
                      className="primary full view-all"
                      onClick={() => {
                        setView("assignments");
                        setPeriod(course.id);
                      }}
                    >
                      View All Assignments <ArrowRight size={20} />
                    </button>
                  </section>
                </>
              )}
            </main>
          </div>
          <footer>
            <img
              className="sidebar-brand"
              src="/icon-192.png"
              alt=""
              width={56}
              height={56}
            />
            <button
              className={tab === "grades" ? "active" : ""}
              aria-label="Grades"
              aria-pressed={tab === "grades"}
              onClick={() => {
                setTab("grades");
                setSelected(undefined);
              }}
            >
              <span className="tab-grade">A+</span>
              <span>grades</span>
            </button>
            <button
              className={tab === "profile" ? "active" : ""}
              aria-label="Settings"
              aria-pressed={tab === "profile"}
              onClick={() => {
                setTab("profile");
                setSelected(undefined);
              }}
            >
              <Settings strokeWidth={1.4} />
              <span>settings</span>
            </button>
            <div className="sidebar-courses">
              <span className="sidebar-label">Your courses</span>
              {fresh &&
                visibleCourses(workspaceCourses).map((c) => (
                  <button
                    key={c.id}
                    aria-current={
                      tab === "grades" && selected === c.id ? "page" : undefined
                    }
                    onClick={() => {
                      setTab("grades");
                      choose(c);
                    }}
                  >
                    <span>{c.title}</span>
                    <span className="sidebar-percent">
                      {percentText(overall(c, state.courses).grade.percent)}
                    </span>
                  </button>
                ))}
            </div>
          </footer>
        </div>
      </div>
      {modal && course && (
        <ScoreDialog
          key={modal.kind + (modal.assignment?.id ?? "")}
          modal={modal}
          course={course}
          scenario={scenario(course)}
          close={() => setModal(undefined)}
          save={(s) => {
            saveScenario(course, s);
            setModal(undefined);
          }}
        />
      )}
      {changingPassword && !locked && (
        <PasswordChange
          close={() => setChangingPassword(false)}
          changed={(expires) => {
            void repository
              .rememberAccess(stateRef.current.account, expires)
              .catch(() => {});
            setStatus(
              (previous) =>
                previous && { ...previous, sessionExpires: expires },
            );
            setChangingPassword(false);
            setPasswordChanged(true);
          }}
        />
      )}
      {install && (
        <Dialog title="Add to Home Screen" close={() => setInstall(false)}>
          <p>
            GradeViewer works in your web browser, or as an app on your phone.
            Your personal address is always in Settings.
          </p>
          <h3>iPhone / iPad</h3>
          <p>
            Open your personal website in Safari. Tap <strong>Share</strong>,
            then <strong>Add to Home Screen</strong> (under More if needed).
            Turn on <strong>Open as Web App</strong> if shown, then tap{" "}
            <strong>Add</strong>.
          </p>
          <h3>Android</h3>
          <p>
            Open your personal website in Chrome. Tap the{" "}
            <strong>⋮ menu</strong>, then <strong>Add to Home screen</strong> or{" "}
            <strong>Install app</strong>.
          </p>
          {prompt && (
            <button
              className="primary full"
              onClick={async () => {
                await prompt.prompt();
                await prompt.userChoice;
                setPrompt(undefined);
              }}
            >
              Install GradeViewer
            </button>
          )}
          <p className="muted">
            Use the same website address on each device. You may need to unlock
            again after installation. Each browser keeps its own grade history
            and local edits.
          </p>
        </Dialog>
      )}
    </>
  );
}
function PasswordChange({
  close,
  changed,
}: {
  close: () => void;
  changed: (expires: number) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      title="Change app password"
      close={() => {
        if (!busy) close();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const currentPassword = form.get("currentPassword");
          const newPassword = form.get("newPassword");
          if (newPassword !== form.get("confirmPassword")) {
            setError("The new passwords don’t match.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            const { sessionExpires } = await api<{ sessionExpires: number }>(
              "password",
              { currentPassword, newPassword },
            );
            changed(sessionExpires);
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">
          Your connections stay saved. Other browsers will need to unlock again.
        </p>
        <label>
          Current password
          <input
            name="currentPassword"
            autoComplete="current-password"
            type="password"
            required
            disabled={busy}
          />
        </label>
        <label>
          New password
          <input
            name="newPassword"
            autoComplete="new-password"
            type="password"
            minLength={12}
            maxLength={256}
            required
            disabled={busy}
          />
        </label>
        <label>
          Confirm new password
          <input
            name="confirmPassword"
            autoComplete="new-password"
            type="password"
            minLength={12}
            maxLength={256}
            required
            disabled={busy}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary full" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </Dialog>
  );
}
function Unlock({
  onUnlock,
}: {
  onUnlock: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onUnlock(password);
          setPassword("");
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>Enter your GradeViewer password to see your grades.</p>
      <label>
        App password
        <input
          name="password"
          autoComplete="current-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="primary full" disabled={busy || !password}>
        {busy ? "Unlocking…" : "Unlock app"}
      </button>
      <details className="password-help">
        <summary>Forgot your app password?</summary>
        <ol>
          <li>
            In{" "}
            <a
              href="https://dash.cloudflare.com/?to=/:account/workers-and-pages"
              target="_blank"
              rel="noopener noreferrer"
            >
              Cloudflare
            </a>
            , open your Worker’s{" "}
            <strong>Settings → Variables and Secrets</strong>.
          </li>
          <li>
            Add a <strong>Secret</strong> named <code>APP_PASSWORD_RESET</code>.
            Set its value to the new password you want (at least 12 characters)
            and click <strong>Deploy</strong>.
          </li>
          <li>
            Unlock GradeViewer with that password once. It automatically becomes
            your regular app password.
          </li>
          <li>
            Delete <code>APP_PASSWORD_RESET</code> in Cloudflare and click{" "}
            <strong>Deploy</strong> to apply the deletion. Your new password
            still works.
          </li>
        </ol>
        <p>
          To reset again, reuse the same <code>APP_PASSWORD_RESET</code> name
          with a fresh password. Keep <code>APP_PASSWORD</code> in place so your
          connections stay saved.
        </p>
      </details>
    </form>
  );
}
function Connection({
  connected,
  busy,
  connect,
  disconnect,
  retainsCarmen = false,
}: {
  connected: boolean;
  busy: boolean;
  connect: (c: { key: string; secret: string }) => Promise<void>;
  disconnect: () => Promise<void>;
  retainsCarmen?: boolean;
}) {
  const [editing, setEditing] = useState(!connected),
    [key, setKey] = useState(""),
    [secret, setSecret] = useState(""),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setEditing(!connected);
  }, [connected]);
  return (
    <>
      {editing ? (
        <form
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            setError("");
            const credentials = { key: key.trim(), secret: secret.trim() };
            setKey("");
            setSecret("");
            try {
              await connect(credentials);
              setEditing(false);
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          <a
            className="help-link"
            href="https://app.schoology.com/api"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get my Schoology keys <ExternalLink size={16} />
          </a>
          <p>
            Sign in on Schoology’s API page, generate a key if needed, then copy
            the API key and secret below. These are not your school password.
            Your school must allow API access.
          </p>
          <label>
            Schoology API key
            <input
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
            />
          </label>
          <label>
            Schoology API secret
            <input
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button
            className="primary full"
            disabled={busy || !key.trim() || !secret.trim()}
          >
            {busy ? "Verifying grades…" : "Connect Schoology"}
          </button>
          {connected && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setEditing(false);
                setKey("");
                setSecret("");
              }}
            >
              Cancel
            </button>
          )}
        </form>
      ) : connected ? (
        <>
          <button
            className="settings-action"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            Update connection <ChevronRight size={17} />
          </button>
          <button
            className="settings-action danger"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            Disconnect
          </button>
        </>
      ) : null}
      {confirm && (
        <Dialog title="Disconnect Schoology?" close={() => setConfirm(false)}>
          <p>
            {retainsCarmen
              ? "This removes Schoology and IC grades, history and local changes. Your Carmen connection and data stay available."
              : "This removes saved grades, history and local changes from this browser and revokes access on your other devices. It does not change Schoology."}
          </p>
          <button
            className="primary full"
            onClick={async () => {
              await disconnect();
              setConfirm(false);
            }}
          >
            Disconnect and clear data
          </button>
        </Dialog>
      )}
    </>
  );
}
function ScoreDialog({
  modal,
  course,
  scenario,
  close,
  save,
}: {
  modal: NonNullable<Modal>;
  course: Course;
  scenario: Scenario;
  close: () => void;
  save: (s: Scenario) => void;
}) {
  const a = modal.assignment,
    [title, setTitle] = useState(""),
    [earned, setEarned] = useState(
      a ? String(scenario.scores[a.id] ?? a.score.earned ?? "") : "",
    ),
    [possible, setPossible] = useState("100"),
    [category, setCategory] = useState(
      course.categories.find((c) => !c.excluded)?.id ?? "",
    ),
    scoreField = useRef<HTMLInputElement>(null);
  const n = scoreInput(earned),
    p = scoreInput(possible),
    valid =
      n !== undefined &&
      (a ||
        (title.trim() &&
          p !== undefined &&
          p > 0 &&
          (course.method === "points" ||
            category ||
            !course.categories.some((c) => !c.excluded))));
  return (
    <Dialog
      title={a ? "Edit Assignment Grade" : "Add Grade"}
      close={close}
      initialInput={a ? scoreField : undefined}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          if (a)
            save({ ...scenario, scores: { ...scenario.scores, [a.id]: n! } });
          else
            save({
              ...scenario,
              added: [
                ...scenario.added,
                {
                  id: "local:" + crypto.randomUUID(),
                  title: title.trim(),
                  categoryID: category || undefined,
                  score: { earned: n, possible: p, excused: false },
                  multiplier: 1,
                  excluded: false,
                  fields: {},
                },
              ],
            });
        }}
      >
        {!a && (
          <label>
            Name
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              maxLength={200}
              required
            />
          </label>
        )}
        <label>
          Score
          <input
            ref={scoreField}
            inputMode="decimal"
            value={earned}
            onChange={(e) => setEarned(e.target.value)}
          />
        </label>
        {a ? (
          <p className="muted">Out of {pointsText(a.score.possible)} points</p>
        ) : (
          <>
            <label>
              Total points
              <input
                inputMode="decimal"
                value={possible}
                onChange={(e) => setPossible(e.target.value)}
              />
            </label>
            {course.method !== "points" && course.categories.length > 1 && (
              <label>
                Category
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {course.categories
                    .filter((c) => !c.excluded)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </>
        )}
        <button className="primary full" disabled={!valid}>
          {a ? "Save" : "Add"}
        </button>
      </form>
    </Dialog>
  );
}
function FinalCalculator({ course }: { course: Course }) {
  const [current, setCurrent] = useState(
      pointsText(course.grade.percent) === "—"
        ? ""
        : String(course.grade.percent),
    ),
    [target, setTarget] = useState("90"),
    [weight, setWeight] = useState("20");
  let value;
  try {
    const c = scoreInput(current),
      t = scoreInput(target),
      w = scoreInput(weight);
    if (c !== undefined && t !== undefined && w !== undefined)
      value = requiredFinal(c, t, w / 100);
  } catch {}
  return (
    <section>
      {[
        ["Current grade (%)", current, setCurrent],
        ["Target grade (%)", target, setTarget],
        ["Final weight (%)", weight, setWeight],
      ].map(([label, value, set]) => (
        <label key={String(label)}>
          {String(label)}
          <input
            inputMode="decimal"
            value={String(value)}
            onChange={(e) => (set as (v: string) => void)(e.target.value)}
          />
        </label>
      ))}
      <p className="muted">
        Enter the final exam weight from your course syllabus.
      </p>
      <div className="row">
        <strong>Needed on final</strong>
        <Grade percent={value} parentheses={false} />
      </div>
      {value !== undefined && value > 100 && <p>Requires extra credit.</p>}
      {value !== undefined && value < 0 && (
        <p>A zero on the final still meets this target.</p>
      )}
    </section>
  );
}
