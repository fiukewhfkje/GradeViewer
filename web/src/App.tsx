import {
  useState,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  User,
  MoreVertical,
  X,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Download,
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
import {
  reliable,
  hypothetical,
  requiredFinal,
  safelyCalculate,
} from "./core/calculator";
import { progression, curve } from "./core/progression";
import { demoCourses } from "./core/demo";
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
}: {
  percent?: number;
  letter?: string;
  estimate?: boolean;
  digits?: number;
}) {
  return (
    <span className="grade">
      {letter && <span>{letter}</span>}
      <span>
        {percentText(percent, digits)}
        {estimate ? "*" : ""}
      </span>
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
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} aria-label={title}>
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
function Graph({ course, all }: { course: Course; all: Course[] }) {
  const points = useMemo(() => progression(course, all), [course, all]),
    [selection, setSelection] = useState<number>();
  const selected = selection === undefined ? undefined : points[selection];
  return (
    <section>
      <h2>Grade Progression</h2>
      {points.length ? (
        <>
          <div
            className="chart"
            onPointerMove={(e) => {
              if (e.buttons || e.pointerType === "mouse") {
                const bounds = e.currentTarget.getBoundingClientRect();
                setSelection(
                  Math.min(
                    points.length - 1,
                    Math.max(
                      0,
                      Math.round(
                        ((e.clientX - bounds.left) / bounds.width) *
                          (points.length - 1),
                      ),
                    ),
                  ),
                );
              }
            }}
            onPointerLeave={() => setSelection(undefined)}
          >
            <svg
              viewBox="0 0 1000 160"
              role="img"
              aria-label="Grade progression"
            >
              <path d={curve(points)} />
            </svg>
            <output className="chart-tooltip">
              {selected
                ? `${percentText(selected.percent)} · ${new Date(selected.date).toLocaleDateString()}`
                : " "}
            </output>
          </div>
          <input
            className="chart-scrubber"
            type="range"
            min="0"
            max={points.length - 1}
            value={selection ?? points.length - 1}
            aria-label="Explore grade history"
            aria-valuetext={
              selected
                ? `${percentText(selected.percent)} on ${new Date(selected.date).toLocaleDateString()}`
                : undefined
            }
            onChange={(e) => setSelection(Number(e.target.value))}
          />
        </>
      ) : (
        <p className="muted">No dated grades available.</p>
      )}
    </section>
  );
}
export default function App() {
  const [state, setState] = useState<SavedState>(emptyState),
    stateRef = useRef(state),
    [status, setStatus] = useState<Status>(),
    [tab, setTab] = useState("grades"),
    [demo, setDemo] = useState(false),
    demoRef = useRef(false),
    [busy, setBusy] = useState(true),
    [fresh, setFresh] = useState(false),
    [error, setError] = useState(""),
    [deadline, setDeadline] = useState(0),
    [tick, setTick] = useState(Date.now()),
    [selected, setSelected] = useState<string>(),
    [view, setView] = useState("detail"),
    [period, setPeriod] = useState<string>(),
    [modal, setModal] = useState<Modal>(),
    [install, setInstall] = useState(false),
    [prompt, setPrompt] = useState<InstallEvent>(),
    [copied, setCopied] = useState(false),
    [update, setUpdate] = useState<ServiceWorker>(),
    [theme, setTheme] = useState(() => {
      try {
        return localStorage.getItem("theme") ?? "system";
      } catch {
        return "system";
      }
    });
  const flight = useRef<Promise<void> | undefined>(undefined),
    channel = useRef<BroadcastChannel | undefined>(undefined),
    mounted = useRef(false),
    touch = useRef<number | undefined>(undefined);
  function apply(s: SavedState) {
    stateRef.current = s;
    setState(s);
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
  ) {
    if (flight.current) return flight.current;
    if (demoRef.current) return;
    const queuedAt = Date.now();
    const run = async () => {
      setBusy(true);
      setError("");
      try {
        const s = await api<Status>("status");
        setStatus(s);
        if (!s.authenticated) {
          setFresh(false);
          setTab("profile");
          return;
        }
        if (!s.connected && !credentials) {
          if (stateRef.current.account) {
            await repository.clear();
            apply(emptyState());
          }
          setTab("profile");
          setFresh(true);
          return;
        }
        const latest = await repository.load();
        if (latest.account === s.account) apply(latest);
        const recovered = await repository.pending();
        if (
          recovered &&
          s.connected &&
          recovered.account === s.account &&
          s.revision !== recovered.previousRevision
        ) {
          await repository.activate(recovered.state);
          apply(recovered.state);
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
        if (s.cooldown && s.cooldown > Date.now())
          throw new RequestError(
            "rateLimited",
            Math.ceil((s.cooldown - Date.now()) / 1000),
          );
        const next = await readSnapshot(
          stateRef.current,
          s,
          credentials,
          manual,
        );
        apply(next);
        setStatus(await api<Status>("status"));
        setFresh(true);
        setDeadline(0);
        channel.current?.postMessage("saved");
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
    void (async () => {
      try {
        const loaded = await repository.load();
        apply(loaded);
        const s = await api<Status>("status"),
          p = await repository.pending();
        setStatus(s);
        if (
          s.authenticated &&
          p &&
          s.connected &&
          s.account === p.account &&
          s.revision !== p.previousRevision
        ) {
          await repository.activate(p.state);
          apply(p.state);
        }
        await refresh();
      } catch (e) {
        setError(errorMessage(e));
        setBusy(false);
      }
    })();
    const bc = new BroadcastChannel("gradeviewer");
    channel.current = bc;
    bc.onmessage = (event) => {
      if (!demoRef.current) {
        setSelected(undefined);
        setModal(undefined);
        void (async () => {
          const remote = await api<Status>("status");
          setStatus(remote);
          if (!remote.authenticated) {
            setFresh(false);
            setTab("profile");
            return;
          }
          apply(await repository.load());
          if (event.data === "saved") setFresh(remote.connected);
        })().catch((e) => setError(errorMessage(e)));
      }
    };
    const visibility = () => {
      if (document.visibilityState === "visible" && !demoRef.current) {
        setFresh(false);
        setModal(undefined);
        void refresh().catch(() => {});
      }
    };
    const timer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !demoRef.current &&
        !flight.current
      )
        void refresh().catch(() => {});
    }, 60000);
    const installer = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", installer);
    document.addEventListener("visibilitychange", visibility);
    if ("serviceWorker" in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      void navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          if (reg.waiting) setUpdate(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            worker?.addEventListener("statechange", () => {
              if (
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              )
                setUpdate(worker);
            });
          });
        })
        .catch(() => {});
      let reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadController && !reloading) {
          reloading = true;
          location.reload();
        }
      });
    }
    // This application root lives for the whole page; the setup guard also tolerates StrictMode.
    window.addEventListener(
      "pagehide",
      () => {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("beforeinstallprompt", installer);
        bc.close();
      },
      { once: true },
    );
  }, []);
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => {
      setTick(Date.now());
      if (
        Date.now() >= deadline &&
        document.visibilityState === "visible" &&
        !demoRef.current &&
        !flight.current
      ) {
        setDeadline(0);
        void refresh().catch(() => {});
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  async function persist(next: SavedState) {
    try {
      if (!demoRef.current) await repository.save(next);
      apply(next);
      channel.current?.postMessage("local");
    } catch (e) {
      setError(errorMessage(e));
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
  const original = state.courses.find((c) => c.id === selected),
    course =
      (view !== "detail"
        ? state.courses.find((c) => c.id === period)
        : undefined) ?? original;
  const choose = (c: Course) => {
    setSelected(c.id);
    setPeriod(c.id);
    setView("detail");
  };
  function list(c: Course, all = false, readOnly = false) {
    const s = scenario(c),
      rows = readOnly
        ? c.assignments
        : [
            ...s.added,
            ...c.assignments.filter((a) => !c.removed.includes(a.id)),
          ],
      items = all
        ? rows.filter((a) => graded(a) || hasTitle(a))
        : recent(rows).slice(0, 5);
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
                  {modified
                    ? "Local change"
                    : (age?.text ??
                      (a.score.excused
                        ? "Excused"
                        : !graded(a)
                          ? "Not graded"
                          : ""))}
                  {a.excluded ? " · Not counted" : ""}
                </small>
              </div>
              <div className={"score " + (modified ? "modified" : "")}>
                <strong>
                  {pointsText(s.scores[a.id] ?? a.score.earned)} /{" "}
                  {pointsText(a.score.possible)}
                </strong>
                <small>
                  {a.score.letter ??
                    percentText(
                      a.score.possible && a.score.earned !== undefined
                        ? ((s.scores[a.id] ?? a.score.earned) /
                            a.score.possible) *
                            100
                        : undefined,
                    )}
                </small>
              </div>
              {!readOnly && (
                <Menu label={"Options for " + a.title}>
                  <button
                    disabled={!reliable(calculationSource(c))}
                    onClick={() => setModal({ kind: "edit", assignment: a })}
                  >
                    Edit Grade
                  </button>
                  <button
                    disabled={!reliable(calculationSource(c))}
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
        No {all ? "assignments" : "graded assignments"} in this period.
      </p>
    );
  }
  function summary(c: Course, whole: boolean) {
    const base = whole ? overall(c, state.courses) : c,
      est = estimateQuarter(c, state.courses),
      s = scenario(c),
      q =
        changed(s) && reliable(calculationSource(c))
          ? hypothetical(calculationSource(c), s)
          : undefined,
      scale = base.id === c.id ? 1 : semesterScale(c, base, state.courses),
      sim =
        q !== undefined &&
        scale !== undefined &&
        base.grade.percent !== undefined &&
        c.grade.percent !== undefined
          ? base.grade.percent + (q - c.grade.percent) * scale
          : undefined;
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
          </div>
          <Grade
            percent={sim ?? base.grade.percent ?? est?.percent}
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
            <button
              disabled={!reliable(calculationSource(c))}
              onClick={() => setModal({ kind: "add" })}
            >
              Add Grade
            </button>
            <button onClick={() => setView("categories")}>Categories</button>
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
        {changed(s) && (
          <p className="notice">
            {sim !== undefined
              ? `Local changes · original ${percentText(base.grade.percent)}`
              : "Local changes · total unavailable for this scenario."}
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
  async function disconnect() {
    try {
      await api("disconnect", {});
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
  const locked = !demo && !status?.authenticated;
  return (
    <>
      <div className="app">
        <header>
          <div>
            {selected ? (
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
            ) : (
              <span className="brand">GradeViewer</span>
            )}
            <h1>
              {tab === "profile"
                ? "Profile"
                : selected
                  ? view === "detail"
                    ? original?.title
                    : view === "assignments"
                      ? "Assignments"
                      : view === "categories"
                        ? "Categories"
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
              className={"icon " + (busy ? "spinning" : "")}
              aria-label="Refresh grades"
              disabled={busy || locked || demo || deadline > Date.now()}
              onClick={() => void refresh(undefined, true).catch(() => {})}
            >
              <RefreshCw size={21} />
            </button>
          )}
        </header>
        {update && (
          <aside className="update">
            An update is ready.
            <button
              disabled={busy || !!modal}
              onClick={() => {
                setBusy(true);
                setFresh(false);
                update.postMessage({ type: "ACTIVATE" });
              }}
            >
              Reload to update
            </button>
          </aside>
        )}
        {demo && (
          <aside className="notice demo">
            Sample grades · synthetic data
            <button
              onClick={() => {
                demoRef.current = false;
                setFresh(false);
                setDemo(false);
                setSelected(undefined);
                void repository
                  .load()
                  .then(apply)
                  .then(() => refresh())
                  .catch(() => {});
              }}
            >
              Exit demo
            </button>
          </aside>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <main
          onTouchStart={(e) => {
            touch.current =
              window.scrollY === 0 ? e.touches[0].clientY : undefined;
          }}
          onTouchEnd={(e) => {
            if (
              touch.current !== undefined &&
              e.changedTouches[0].clientY - touch.current > 100 &&
              tab === "grades" &&
              !busy &&
              !locked &&
              !demo
            )
              void refresh().catch(() => {});
            touch.current = undefined;
          }}
        >
          {tab === "profile" ? (
            <>
              <section>
                <h2>Schoology</h2>
                {locked ? (
                  <Unlock
                    onUnlock={async (password) => {
                      await api("login", { password });
                      await refresh();
                    }}
                  />
                ) : (
                  <>
                    <p className="connection">
                      <span className="status-dot" />
                      {demo
                        ? "Sample connection"
                        : status?.connected
                          ? "Connected"
                          : "Not connected"}
                    </p>
                    <Connection
                      connected={!!status?.connected || demo}
                      busy={busy}
                      connect={async (credentials) => {
                        await refresh(credentials);
                        setTab("grades");
                      }}
                      disconnect={disconnect}
                      demo={demo}
                    />
                  </>
                )}
              </section>
              <section>
                <h2>Appearance</h2>
                <label className="row">
                  Theme
                  <select
                    aria-label="Theme"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>
              </section>
              <section className="personal-site">
                <h2>Your personal website</h2>
                <p>
                  Open this address on any phone or computer. Save it as a
                  bookmark to find your app again.
                </p>
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
                        await navigator.clipboard.writeText(location.origin);
                        setCopied(true);
                      } catch {
                        setCopied(false);
                        setError(
                          "Select the website address above and copy it.",
                        );
                      }
                    }}
                  >
                    {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
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
                  <Download size={18} /> Add to Home Screen
                </button>
              </section>
              {!demo && status?.authenticated && (
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      await api("logout", {});
                      setFresh(false);
                      setStatus(await api<Status>("status"));
                      channel.current?.postMessage("locked");
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                >
                  Lock app
                </button>
              )}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  demoRef.current = true;
                  setDemo(true);
                  apply({ schema: 1, courses: demoCourses(), scenarios: {} });
                  setFresh(true);
                  setBusy(false);
                  setError("");
                  setTab("grades");
                }}
              >
                Try sample grades
              </button>
            </>
          ) : !fresh && !demo ? (
            <div className="gate">
              {busy ? (
                <>
                  <RefreshCw className="spinning" />
                  <h2>Refreshing grades…</h2>
                </>
              ) : (
                <>
                  <h2>
                    {locked && status
                      ? "Unlock GradeViewer"
                      : "Fresh grades unavailable"}
                  </h2>
                  <p>
                    Your saved data is retained. Retry or check your connection
                    in Profile.
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
                    {locked && status ? "Open Profile" : "Retry"}
                  </button>
                </>
              )}
            </div>
          ) : !course ? (
            <>
              <div className="courses">
                {visibleCourses(state.courses).map((c) => {
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
                          <small>
                            {age.text}
                            {age.fresh && <Check size={14} />}
                          </small>
                        )}
                      </div>
                      <Grade {...grade} />
                      <ChevronRight size={22} />
                    </button>
                  );
                })}
              </div>
              {!state.courses.length && (
                <div className="gate">
                  <h2>No grades yet</h2>
                  <button className="primary" onClick={() => setTab("profile")}>
                    Connect Schoology
                  </button>
                </div>
              )}
            </>
          ) : view === "final" ? (
            <FinalCalculator course={overall(course, state.courses)} />
          ) : view === "categories" ? (
            <>
              {course.categories.map((k) => {
                const rows = calculationSource(course).assignments.filter(
                    (a) => a.categoryID === k.id,
                  ),
                  value = safelyCalculate(
                    {
                      ...course,
                      assignments: rows,
                      categories: [{ ...k, weight: 1 }],
                      method: "weightedCategories",
                    },
                    {
                      ...scenario(course),
                      added: scenario(course).added.filter(
                        (a) => a.categoryID === k.id,
                      ),
                    },
                  );
                return (
                  <section key={k.id}>
                    <div className="section-heading">
                      <h2>{k.name}</h2>
                      <span>
                        {k.weight !== undefined ? k.weight + "% weight" : ""}
                      </span>
                    </div>
                    <p className="muted">
                      {k.method === "points"
                        ? "Total points"
                        : "Average percentages"}
                      {k.dropLowest ? ` · Drop lowest ${k.dropLowest}` : ""}
                    </p>
                    <Grade percent={value} />
                  </section>
                );
              })}
              {!course.categories.length && (
                <p className="muted">No categories available.</p>
              )}
            </>
          ) : view === "assignments" ? (
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
              {summary(course, false)}
              {list(course, true)}
              {exams(course, state.courses).map((exam) => (
                <section key={exam.id}>
                  <div className="section-heading">
                    <h2>Exam</h2>
                    <Grade {...exam.grade} />
                  </div>
                  {list(exam, true, true)}
                </section>
              ))}
            </>
          ) : (
            <>
              {summary(course, true)}
              <Graph key={course.id} course={course} all={state.courses} />
              <section>
                <h2>Recently Graded Assignments</h2>
                {list(course)}
              </section>
              <button
                className="primary full view-all"
                onClick={() => {
                  setView("assignments");
                  setPeriod(course.id);
                }}
              >
                View All Assignments <ArrowRight size={20} />
              </button>
            </>
          )}
        </main>
        <footer>
          <button
            className={tab === "grades" ? "active" : ""}
            aria-label="Grades"
            aria-pressed={tab === "grades"}
            onClick={() => setTab("grades")}
          >
            <span className="tab-grade">A+</span>
            <span>grades</span>
          </button>
          <button
            className={tab === "profile" ? "active" : ""}
            aria-label="Profile"
            aria-pressed={tab === "profile"}
            onClick={() => {
              setTab("profile");
              setSelected(undefined);
            }}
          >
            <User strokeWidth={1.4} />
            <span>profile</span>
          </button>
        </footer>
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
      {install && (
        <Dialog title="Add to Home Screen" close={() => setInstall(false)}>
          <p>
            GradeViewer works in your web browser, or as an app on your phone.
            Your personal address is always in Profile.
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
      <p>
        Use the private app password you chose when setting up this website.
      </p>
      <label>
        App password
        <input
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
    </form>
  );
}
function Connection({
  connected,
  busy,
  connect,
  disconnect,
  demo,
}: {
  connected: boolean;
  busy: boolean;
  connect: (c: { key: string; secret: string }) => Promise<void>;
  disconnect: () => Promise<void>;
  demo: boolean;
}) {
  const [editing, setEditing] = useState(!connected),
    [key, setKey] = useState(""),
    [secret, setSecret] = useState(""),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (connected) setEditing(false);
  }, [connected]);
  return (
    <>
      {editing && !demo ? (
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
            className="secondary full"
            disabled={busy || demo}
            onClick={() => setEditing(true)}
          >
            Update connection
          </button>
          <button
            className="text-button danger"
            disabled={busy || demo}
            onClick={() => setConfirm(true)}
          >
            Disconnect
          </button>
        </>
      ) : null}
      {confirm && (
        <Dialog title="Disconnect Schoology?" close={() => setConfirm(false)}>
          <p>
            This removes saved grades, history and local changes from this
            browser and revokes access on your other devices. It does not change
            Schoology.
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
    );
  const n = scoreInput(earned),
    p = scoreInput(possible),
    valid =
      n !== undefined &&
      (a ||
        (title.trim() &&
          p !== undefined &&
          p > 0 &&
          (course.method === "points" || category)));
  return (
    <Dialog title={a ? "Edit Assignment Grade" : "Add Grade"} close={close}>
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
            inputMode="decimal"
            value={earned}
            onChange={(e) => setEarned(e.target.value)}
            autoFocus={!!a}
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
        <Grade percent={value} />
      </div>
      {value !== undefined && value > 100 && <p>Requires extra credit.</p>}
      {value !== undefined && value < 0 && (
        <p>A zero on the final still meets this target.</p>
      )}
    </section>
  );
}
