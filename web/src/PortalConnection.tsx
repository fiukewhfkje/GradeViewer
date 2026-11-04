import { useState, useRef, useEffect } from "react";
import {
  School,
  ChevronRight,
  LogIn,
  ListChecks,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { api as request, errorMessage, type PortalStatus } from "./api";
import type { CampusChoice } from "./core/campus";
export function PortalConnection({
  status,
  disabled,
  refresh,
  provider = "campus",
}: {
  provider?: "campus" | "carmen";
  status?: PortalStatus;
  disabled: boolean;
  refresh: () => Promise<void>;
}) {
  const carmen = provider === "carmen",
    title = carmen ? "CarmenCanvas" : "Infinite Campus";
  const api = <T,>(path: string, data?: unknown) =>
    request<T>(path.replace("campus/", provider + "/"), data);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [login, setLogin] = useState<{ url: string; expires: number }>(),
    [courses, setCourses] = useState<CampusChoice[]>(),
    [selected, setSelected] = useState(status?.selected ?? []);
  const [maintenance, setMaintenance] = useState(!!status?.maintenance);
  useEffect(() => setMaintenance(!!status?.maintenance), [status?.maintenance]);
  const signInWindow = useRef<Window | null>(null);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
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
  async function start() {
    const popup = window.open("about:blank", "_blank");
    signInWindow.current = popup;
    if (popup) {
      popup.document.title = `${title} sign-in`;
      popup.document.body.textContent = `Starting the temporary ${title} sign-in browser…`;
    }
    let pending;
    try {
      pending = await api<{ url: string; expires: number }>("campus/start", {});
    } catch (e) {
      popup?.close();
      throw e;
    }
    if (popup) popup.location.href = pending.url;
    setCourses(undefined);
    setLogin(pending);
  }
  const count = status?.selected.length ?? 0;
  return (
    <section className="settings-group">
      <h2>{carmen ? "University courses" : "Additional classes"}</h2>
      <div className="settings-card portal-connection" aria-busy={busy}>
        <div className="connection-heading portal-heading">
          <span className="settings-icon">
            <School size={20} />
          </span>
          <strong>{title}</strong>
          <span
            className="connection"
            data-connected={!!status?.connected && !status.needsReconnect}
          >
            <span className="status-dot" />
            {login
              ? "Signing in"
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
                <strong>Finish signing in</strong>
                <p>
                  {carmen
                    ? "Complete Ohio State sign-in in the other window, then return here."
                    : "Find your district, choose Campus Student, and complete your school’s sign-in. Then return here."}
                </p>
              </div>
            </div>
            <a
              className="portal-reopen"
              href={login.url}
              target="_blank"
              rel="noreferrer"
            >
              Open sign-in again <ExternalLink size={14} />
            </a>
            <div className="button-row">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api("campus/cancel", {});
                    signInWindow.current?.close();
                    setLogin(undefined);
                  })
                }
              >
                Cancel sign-in
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api("campus/finish", {});
                    signInWindow.current?.close();
                    setLogin(undefined);
                    if (!carmen && !status?.connected) await choices();
                    await refresh();
                  })
                }
              >
                Finish connecting
              </button>
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
              onClick={() => void run(start)}
            >
              <LogIn size={19} />
              <span>Reconnect {title}</span>
              <ChevronRight size={18} />
            </button>
            {carmen && (
              <div className="portal-body">
                <p className="portal-description">
                  Your student courses sync automatically.
                </p>
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
                          await refresh();
                        } catch (error) {
                          setMaintenance(!!status.maintenance);
                          throw error;
                        }
                      });
                    }}
                  />
                  <span className="gpa-toggle-track" aria-hidden="true" />
                  <span>Keep my session active</span>
                </label>
                <p className="muted">
                  Checks your session every 90 minutes. OSU may still require
                  sign-in again. Failed access pauses background checks.
                </p>
              </div>
            )}
            <button
              className="portal-disconnect danger"
              disabled={disabled || busy}
              onClick={() =>
                void run(async () => {
                  await api("campus/disconnect", {});
                  setCourses(undefined);
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
            {carmen ? (
              <p className="muted">
                Experimental · OSU does not support this integration. Your
                Worker stores encrypted session cookies, never your university
                password. Background checks start after connecting and can be
                turned off here.
              </p>
            ) : null}
            <button
              className="primary portal-connect"
              disabled={disabled || busy}
              onClick={() => void run(start)}
            >
              <LogIn size={18} />
              Connect {title}
            </button>
          </div>
        )}
        {busy && (
          <div className="portal-progress" role="status">
            <RefreshCw size={14} className="spinning" /> Working…
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
