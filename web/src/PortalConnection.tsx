import {
  useEffect,
  useEffectEvent,
  useState,
  useRef,
  type ReactNode,
} from "react";
import {
  CheckCircle2,
  School,
  ChevronDown,
  ChevronRight,
  LogIn,
  ListChecks,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import {
  api as request,
  errorMessage,
  RequestError,
  type PortalStatus,
} from "./api";
import type { CampusChoice } from "./core/campus";
import { CarmenDiagnostics } from "./CarmenDiagnostics";
type Login = { url: string; expires: number; attempt?: string };
type SignInProgress =
  { state: "waiting" } | { state: "connected"; firstConnection: boolean };

export function ConnectionDisclosure({
  title,
  icon,
  label,
  connected,
  open,
  onToggle,
  className = "",
  children,
}: {
  title: string;
  icon: ReactNode;
  label: string;
  connected: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      className={"settings-provider " + className}
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="connection-heading">
        <span className="settings-icon">{icon}</span>
        <strong>{title}</strong>
        <span className="connection" data-connected={connected}>
          <span className="status-dot" />
          {label}
        </span>
        <ChevronDown
          size={16}
          className="provider-chevron"
          aria-hidden="true"
        />
      </summary>
      {children}
    </details>
  );
}

export function PortalConnection({
  status,
  disabled,
  refresh,
  provider = "campus",
  refreshStatus = refresh,
  open,
  onToggle,
  children,
}: {
  provider?: "campus" | "carmen";
  status?: PortalStatus;
  disabled: boolean;
  refresh: () => Promise<void>;
  refreshStatus?: () => Promise<void>;
  open: boolean;
  onToggle: (open: boolean) => void;
  children?: ReactNode;
}) {
  const carmen = provider === "carmen",
    title = carmen ? "CarmenCanvas" : "Infinite Campus";
  const api = <T,>(path: string, data?: unknown) =>
    request<T>(path.replace("campus/", provider + "/"), data);
  const [working, setWorking] = useState(""),
    [message, setMessage] = useState(""),
    [login, setLogin] = useState<Login>(),
    [signInOpened, setSignInOpened] = useState(false),
    [confirmation, setConfirmation] = useState(""),
    [courses, setCourses] = useState<CampusChoice[]>(),
    [choosing, setChoosing] = useState(false),
    [selected, setSelected] = useState(status?.selected ?? []);
  const [maintenance, setMaintenance] = useState(!!status?.maintenance);
  useEffect(() => setMaintenance(!!status?.maintenance), [status?.maintenance]);
  const signInWindow = useRef<Window | null>(null);
  const busy = !!working;
  async function run(task: () => Promise<void>, label = "Working…") {
    setWorking(label);
    setMessage("");
    try {
      await task();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setWorking("");
    }
  }
  async function choices() {
    setChoosing(true);
    setSelected(status?.selected ?? []);
    if (courses !== undefined) return;
    const r = await api<{ courses: CampusChoice[]; selected: string[] }>(
      "campus/courses",
      {},
    );
    setCourses(r.courses);
    setSelected(r.selected);
  }
  function closeSignIn() {
    signInWindow.current?.close();
    signInWindow.current = null;
    setLogin(undefined);
  }
  async function connected(firstConnection: boolean) {
    closeSignIn();
    setConfirmation(`${title} connected.`);
    await run(async () => {
      try {
        if (!carmen && firstConnection) await choices();
      } finally {
        await refresh();
      }
    });
  }
  const finishAutomatically = useEffectEvent(connected);
  useEffect(() => {
    if (!login?.attempt || message || busy) return;
    const attempt = login.attempt;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const result = await api<SignInProgress>("campus/progress", {
          attempt,
        });
        if (!active) return;
        if (result.state === "connected")
          void finishAutomatically(result.firstConnection);
        else timer = setTimeout(check, 2000);
      } catch (error) {
        if (!active) return;
        if (
          error instanceof RequestError &&
          error.code === "portalSignInExpired"
        )
          closeSignIn();
        setMessage(errorMessage(error));
      }
    }
    void check();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [login, message, busy]);

  async function start() {
    setConfirmation("");
    setSignInOpened(false);
    const pending = await api<Login>("campus/start", {});
    setCourses(undefined);
    setChoosing(false);
    setLogin(pending);
  }
  const count = status?.selected.length ?? 0;
  return (
    <ConnectionDisclosure
      title={title}
      icon={<School size={20} />}
      className="portal-connection"
      connected={!!status?.connected && !status.needsReconnect}
      label={
        login
          ? signInOpened
            ? "Signing in"
            : "Ready to sign in"
          : status?.needsReconnect
            ? "Sign-in needed"
            : status?.connected
              ? "Connected"
              : "Not connected"
      }
      open={open}
      onToggle={onToggle}
    >
      <div aria-busy={busy}>
        {children}
        {login ? (
          <div className="portal-body">
            <div className="portal-login-note">
              <LogIn size={22} />
              <div>
                <strong>
                  {carmen
                    ? "Sign in to CarmenCanvas"
                    : "Sign in to Campus Student"}
                </strong>
                <p>
                  {carmen ? (
                    "Complete Ohio State sign-in in the other window. GradeViewer will verify the connection and close the temporary browser automatically."
                  ) : (
                    <>
                      Find your district and complete your school’s sign-in.
                      {login.attempt
                        ? " GradeViewer will verify the connection and close the temporary browser automatically."
                        : " Then return here to finish connecting."}
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="button-row">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api("campus/cancel", { attempt: login.attempt });
                    closeSignIn();
                    await refresh();
                  })
                }
              >
                Cancel sign-in
              </button>
              <a
                className="primary"
                href={login.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  setSignInOpened(true);
                  if (
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  const popup = window.open("about:blank", "_blank");
                  if (!popup) return;
                  event.preventDefault();
                  popup.opener = null;
                  popup.location.replace(login.url);
                  signInWindow.current = popup;
                }}
              >
                {carmen ? "Open CarmenCanvas" : "Open Campus Student"}{" "}
                <ExternalLink size={14} />
              </a>
              {(!login.attempt || message) && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (login.attempt) {
                        await api("campus/progress", {
                          attempt: login.attempt,
                          retry: true,
                        });
                      } else {
                        await api("campus/finish", {});
                        await connected(!status?.connected);
                      }
                    })
                  }
                >
                  {login.attempt
                    ? "Retry connection check"
                    : "Finish connecting"}
                </button>
              )}
            </div>
          </div>
        ) : choosing ? (
          <div className="portal-body portal-selection">
            <div className="portal-selection-heading">
              <div>
                <h3>Choose your classes</h3>
                <p>
                  Choose classes missing from Schoology. Both copies of a class
                  count toward GPA.
                </p>
              </div>
              <span className="portal-count">{selected.length} selected</span>
            </div>
            <fieldset disabled={busy || disabled}>
              <legend className="sr-only">Include these IC classes</legend>
              <div className="portal-course-list">
                {courses === undefined ? (
                  <p className="muted" role="status">
                    {busy ? "Loading IC courses…" : "IC courses couldn’t load."}
                  </p>
                ) : courses.length ? (
                  courses.map((c) => (
                    <label className="gpa-check portal-course" key={c.id}>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={selected.includes(c.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, c.id]
                              : selected.filter((x) => x !== c.id),
                          )
                        }
                      />
                      <span className="gpa-toggle-track" aria-hidden="true" />
                      <span className="portal-course-name">
                        <strong>{c.title}</strong>
                        {c.teacher && <small>{c.teacher}</small>}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="muted">No IC classes are available yet.</p>
                )}
              </div>
            </fieldset>
            <div className="button-row">
              <button
                className="secondary"
                disabled={busy && courses !== undefined}
                onClick={() => setChoosing(false)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || disabled || courses === undefined}
                onClick={() =>
                  void run(async () => {
                    await api("campus/select", { selected });
                    await refresh();
                    setChoosing(false);
                  }, "Saving IC courses…")
                }
              >
                Save IC courses
              </button>
              {!busy && courses === undefined && (
                <button className="primary" onClick={() => void run(choices)}>
                  Retry loading courses
                </button>
              )}
            </div>
          </div>
        ) : status?.connected ? (
          <>
            {!carmen && status.needsReconnect && (
              <p className="portal-notice" role="status">
                Sign in again to refresh {carmen ? "Carmen" : "IC"} grades. Your
                selected classes and saved grades are retained.
              </p>
            )}
            {!carmen && (
              <button
                className="settings-action portal-action"
                disabled={disabled || busy}
                aria-label="Choose IC courses"
                onClick={() => void run(choices)}
              >
                <ListChecks size={19} />
                <span>
                  <strong>Choose IC courses</strong>
                  <small>
                    {count
                      ? `${count} ${count === 1 ? "class" : "classes"} included`
                      : "Choose the classes to add"}
                  </small>
                </span>
                <ChevronRight size={18} />
              </button>
            )}
            <button
              className="settings-action portal-action"
              disabled={disabled || busy}
              onClick={() => void run(start, "Preparing the sign-in browser…")}
            >
              <LogIn size={19} />
              <span>Reconnect {title}</span>
              <ChevronRight size={18} />
            </button>
            <div className="portal-body">
              <label className="gpa-check">
                <input
                  type="checkbox"
                  role="switch"
                  checked={maintenance}
                  disabled={disabled || busy}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setMaintenance(enabled);
                    void run(async () => {
                      try {
                        await api("campus/maintenance", { enabled });
                      } catch (error) {
                        setMaintenance(!!status.maintenance);
                        throw error;
                      }
                      await refreshStatus();
                    }, "Saving preference…");
                  }}
                />
                <span className="gpa-toggle-track" aria-hidden="true" />
                <span>Keep connected</span>
              </label>
              <p className="muted">
                {carmen
                  ? "Checks every 90 minutes and can try to reconnect."
                  : "Checks the session every 20 minutes."}
              </p>
            </div>
            {open && (
              <CarmenDiagnostics
                provider={provider}
                status={status}
                busy={disabled || busy}
                refresh={() => void run(refreshStatus)}
                check={() =>
                  void run(async () => {
                    try {
                      await api("campus/check", {});
                    } finally {
                      await refreshStatus();
                    }
                  }, "Checking session…")
                }
              />
            )}
            <button
              className="portal-disconnect danger"
              disabled={disabled || busy}
              onClick={() =>
                void run(async () => {
                  await api("campus/disconnect", {});
                  setConfirmation("");
                  setCourses(undefined);
                  setChoosing(false);
                  await refresh();
                })
              }
            >
              Disconnect {title}
            </button>
          </>
        ) : (
          <div className="portal-body">
            <p className="portal-description">
              {carmen
                ? "Connect your Ohio State student courses with your regular school sign-in."
                : "Find your district and sign in to add classes that only use Infinite Campus. The temporary sign-in browser closes when you finish."}
            </p>
            <button
              className="primary portal-connect"
              disabled={disabled || busy}
              onClick={() => void run(start, "Preparing the sign-in browser…")}
            >
              <LogIn size={18} />
              Connect {title}
            </button>
          </div>
        )}
        {confirmation && (
          <p className="portal-notice" role="status">
            <CheckCircle2 size={16} aria-hidden="true" /> {confirmation}
          </p>
        )}
        {busy && !(choosing && courses === undefined) && (
          <div className="portal-progress" role="status">
            <RefreshCw size={14} className="spinning" /> {working}
          </div>
        )}
        {message && (
          <p className="portal-notice" role="alert">
            {message}
          </p>
        )}
      </div>
    </ConnectionDisclosure>
  );
}
