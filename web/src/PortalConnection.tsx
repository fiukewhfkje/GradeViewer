import {
  useEffect,
  useEffectEvent,
  useState,
  useRef,
  type ReactNode,
} from "react";
import {
  School,
  ChevronDown,
  ChevronRight,
  LogIn,
  ListChecks,
  ExternalLink,
} from "lucide-react";
import {
  api as request,
  errorMessage,
  RequestError,
  type PortalStatus,
} from "./api";
import type { CampusChoice } from "./core/campus";
import { usePortalHealth, type ConnectionTone } from "./portal-health";
import { CarmenReport } from "./CarmenReport";
import { ReloadIcon } from "./ReloadIcon";
type Login = { url: string; expires: number; attempt?: string };
type SignInProgress =
  { state: "waiting" } | { state: "connected"; firstConnection: boolean };

export function ConnectionDisclosure({
  title,
  icon,
  label,
  tone = "neutral",
  open,
  onToggle,
  className = "",
  experimental = false,
  children,
}: {
  title: string;
  icon: ReactNode;
  label: string;
  tone?: ConnectionTone;
  open: boolean;
  onToggle: (open: boolean) => void;
  className?: string;
  experimental?: boolean;
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
        <strong>
          {title}
          {experimental && <small className="carmen-label">Experimental</small>}
        </strong>
        <span className="connection" data-health={tone}>
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
    [courses, setCourses] = useState<CampusChoice[]>(),
    [choosing, setChoosing] = useState(false),
    [selected, setSelected] = useState(status?.selected ?? []);
  const signInWindow = useRef<Window | null>(null);
  const busy = !!working;
  const health = usePortalHealth(status, disabled || busy, refreshStatus);
  const needsReconnect = health.tone === "error";
  async function run(task: () => Promise<void>, label = "Working…") {
    setWorking(label);
    setMessage("");
    try {
      await task();
    } catch (e) {
      setMessage(errorMessage(e));
      if (
        e instanceof RequestError &&
        (e.code === "portalSignInRequired" ||
          e.code === "portalPasswordChanged" ||
          e.code === "portalAccountChanged")
      ) {
        setChoosing(false);
        await refreshStatus().catch(() => {});
      }
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
        if (carmen) await refreshStatus().catch(() => {});
      }
    }
    void check();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [login, message, busy]);

  async function start() {
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
      experimental={carmen}
      tone={login ? "neutral" : health.tone}
      label={
        login
          ? signInOpened
            ? "Signing in"
            : "Ready to sign in"
          : health.label
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
            {!carmen && !needsReconnect && (
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
            <div className="portal-actions">
              <button
                className={needsReconnect ? "primary" : undefined}
                aria-label={`Reconnect ${title}`}
                disabled={disabled || busy}
                onClick={() =>
                  void run(start, "Preparing the sign-in browser…")
                }
              >
                {needsReconnect ? `Reconnect ${title}` : "Reconnect"}
              </button>
              <button
                className="danger"
                aria-label={`Disconnect ${title}`}
                disabled={disabled || busy}
                onClick={() =>
                  void run(async () => {
                    await api("campus/disconnect", {});
                    setCourses(undefined);
                    setChoosing(false);
                    await refresh();
                  })
                }
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <div className="portal-body">
            <p className="portal-description">
              {carmen
                ? "Connect your Ohio State student courses with your regular school sign-in."
                : disabled
                  ? "Connect Schoology first to add Infinite Campus classes."
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
        {carmen && (
          <CarmenReport
            available={!!status?.compatibilityReportAvailable}
            busy={busy || disabled}
          />
        )}
        {busy && !(choosing && courses === undefined) && (
          <div className="portal-progress" role="status">
            <ReloadIcon size={14} className="spinning" /> {working}
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
