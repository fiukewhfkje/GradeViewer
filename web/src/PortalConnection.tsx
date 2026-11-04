import { useEffect, useEffectEvent, useState, useRef } from "react";
import {
  CheckCircle2,
  School,
  ChevronRight,
  LogIn,
  ListChecks,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { api, errorMessage, RequestError, type PortalStatus } from "./api";
import type { CampusChoice } from "./core/campus";
type Login = { url: string; expires: number; attempt?: string };
type SignInProgress =
  { state: "waiting" } | { state: "connected"; firstConnection: boolean };

export function PortalConnection({
  status,
  disabled,
  refresh,
}: {
  status?: PortalStatus;
  disabled: boolean;
  refresh: () => Promise<void>;
}) {
  const [working, setWorking] = useState(""),
    [message, setMessage] = useState(""),
    [login, setLogin] = useState<Login>(),
    [signInOpened, setSignInOpened] = useState(false),
    [confirmation, setConfirmation] = useState(""),
    [courses, setCourses] = useState<CampusChoice[]>(),
    [selected, setSelected] = useState(status?.selected ?? []);
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
    setConfirmation("Infinite Campus connected.");
    await run(async () => {
      try {
        if (firstConnection) await choices();
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
    setLogin(pending);
  }
  const count = status?.selected.length ?? 0;
  return (
    <section className="settings-group">
      <h2>Additional classes</h2>
      <div className="settings-card portal-connection" aria-busy={busy}>
        <div className="connection-heading portal-heading">
          <span className="settings-icon">
            <School size={20} />
          </span>
          <strong>Infinite Campus</strong>
          <span
            className="connection"
            data-connected={!!status?.connected && !status.needsReconnect}
          >
            <span className="status-dot" />
            {login
              ? signInOpened
                ? "Signing in"
                : "Ready to sign in"
              : status?.needsReconnect
                ? "Sign-in needed"
                : status?.connected
                  ? "Connected"
                  : "Not connected"}
          </span>
        </div>
        {login ? (
          <div className="portal-body">
            <div className="portal-login-note">
              <LogIn size={22} />
              <div>
                <strong>Sign in to Campus Student</strong>
                <p>
                  Find your district and complete your school’s sign-in.
                  {login.attempt
                    ? " GradeViewer will verify the connection and close the temporary browser automatically."
                    : " Then return here to finish connecting."}
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
                Open Campus Student <ExternalLink size={14} />
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
        ) : courses ? (
          <div className="portal-body portal-selection">
            <div className="portal-selection-heading">
              <div>
                <h3>Choose your classes</h3>
                <p>Include the classes you use IC for.</p>
              </div>
              <span className="portal-count">{selected.length} selected</span>
            </div>
            <fieldset disabled={busy || disabled}>
              <legend className="sr-only">Include these IC classes</legend>
              <div className="portal-course-list">
                {courses.length ? (
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
                disabled={busy}
                onClick={() => setCourses(undefined)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || disabled}
                onClick={() =>
                  void run(async () => {
                    await api("campus/select", { selected });
                    await refresh();
                    setCourses(undefined);
                  })
                }
              >
                Save IC courses
              </button>
            </div>
          </div>
        ) : status?.connected ? (
          <>
            {status.needsReconnect && (
              <p className="portal-notice" role="status">
                Sign in again to refresh IC grades. Your selected classes and
                saved grades are retained.
              </p>
            )}
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
            <button
              className="settings-action portal-action"
              disabled={disabled || busy}
              onClick={() => void run(start, "Preparing the sign-in browser…")}
            >
              <LogIn size={19} />
              <span>Reconnect Infinite Campus</span>
              <ChevronRight size={18} />
            </button>
            <button
              className="portal-disconnect danger"
              disabled={disabled || busy}
              onClick={() =>
                void run(async () => {
                  await api("campus/disconnect", {});
                  setConfirmation("");
                  setCourses(undefined);
                  await refresh();
                })
              }
            >
              Disconnect Infinite Campus
            </button>
          </>
        ) : (
          <div className="portal-body">
            <p className="portal-description">
              Find your district and sign in to add classes that only use
              Infinite Campus. The temporary sign-in browser closes when you
              finish.
            </p>
            <button
              className="primary portal-connect"
              disabled={disabled || busy}
              onClick={() => void run(start, "Preparing the sign-in browser…")}
            >
              <LogIn size={18} />
              Connect Infinite Campus
            </button>
          </div>
        )}
        {confirmation && (
          <p className="portal-notice" role="status">
            <CheckCircle2 size={16} aria-hidden="true" /> {confirmation}
          </p>
        )}
        {busy && (
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
    </section>
  );
}
