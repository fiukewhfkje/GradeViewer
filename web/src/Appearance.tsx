import { useEffect, useLayoutEffect, useState } from "react";
import { Accessibility, SunMoon } from "lucide-react";

type Theme = "system" | "light" | "dark";
type Motion = "system" | "reduce" | "full";

function savedPreference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function useMediaPreference(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function useAppearance() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = savedPreference("theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [motion, setMotion] = useState<Motion>(() => {
    const saved = savedPreference("motion");
    return saved === "reduce" || saved === "full" ? saved : "system";
  });
  const deviceDark = useMediaPreference("(prefers-color-scheme: dark)");
  const deviceReduced = useMediaPreference("(prefers-reduced-motion: reduce)");
  const dark = theme === "dark" || (theme === "system" && deviceDark);
  const reducedMotion =
    motion === "reduce" || (motion === "system" && deviceReduced);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.motion = reducedMotion ? "reduce" : "full";
    if (reducedMotion) {
      // Stop in-flight motion too, including transitions suspended inside a
      // closed disclosure. CSS prevents new decorative motion in this mode.
      for (const animation of document.getAnimations()) animation.cancel();
    }
    try {
      localStorage.setItem("theme", theme);
      localStorage.setItem("motion", motion);
    } catch {
      // The controls still work for this visit when storage is unavailable.
    }
  }, [theme, motion, reducedMotion]);
  return { theme, setTheme, dark, motion, setMotion, reducedMotion };
}

export function AppearanceSettings({
  appearance,
}: {
  appearance: ReturnType<typeof useAppearance>;
}) {
  const { theme, setTheme, dark, motion, setMotion, reducedMotion } =
    appearance;
  return (
    <div className="settings-card appearance-card">
      <div className="settings-row">
        <span className="settings-icon">
          <SunMoon size={20} />
        </span>
        <span className="settings-label">
          Theme
          <small>
            {dark ? "Dark" : "Light"}
            {theme === "system" ? " · Device" : ""}
          </small>
        </span>
        <button
          type="button"
          className="theme-scene"
          role="switch"
          aria-label="Dark mode"
          aria-checked={dark}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          data-dark={dark}
          onClick={() => setTheme(dark ? "light" : "dark")}
        >
          <span className="theme-scenery" aria-hidden="true">
            <svg
              className="theme-landscape"
              viewBox="0 0 94 46"
              width="94"
              height="46"
              aria-hidden="true"
            >
              <g className="theme-stars" fill="#e3e9fb">
                <path d="M18 8l1.2 3.8L23 13l-3.8 1.2L18 18l-1.2-3.8L13 13l3.8-1.2zM37 21l.8 2.2L40 24l-2.2.8L37 27l-.8-2.2L34 24l2.2-.8zM13 29l.6 1.8L16 32l-2.4.6L13 35l-.6-2.4L10 32l2.4-1.2z" />
                <circle cx="30" cy="9" r="1" />
                <circle cx="26" cy="33" r="1" />
                <circle cx="44" cy="12" r=".8" />
              </g>
              <g className="theme-clouds">
                <path
                  d="M32 46v-8a9 9 0 0 1 10-9 10 10 0 0 1 18-7 10 10 0 0 1 16 2 10 10 0 0 1 18 6v16z"
                  fill="#fff"
                  opacity=".5"
                />
                <path
                  d="M40 46a9 9 0 0 1 9-10 9 9 0 0 1 15-5 10 10 0 0 1 17 1 9 9 0 0 1 13-1v15z"
                  fill="#fff"
                  opacity=".9"
                />
              </g>
            </svg>
            <span className="theme-orb" aria-hidden="true">
              <svg
                className="theme-craters"
                viewBox="0 0 34 34"
                width="34"
                height="34"
              >
                <circle cx="11" cy="12" r="4" />
                <circle cx="23" cy="22" r="5" />
                <circle cx="12" cy="25" r="2" />
              </svg>
            </span>
          </span>
        </button>
      </div>
      <div
        className="preference-reset"
        data-visible={theme !== "system"}
        inert={theme === "system"}
        aria-hidden={theme === "system"}
      >
        <div>
          <button
            type="button"
            className="device-preference"
            onClick={() => setTheme("system")}
          >
            Use device theme
          </button>
        </div>
      </div>
      <label className="settings-row gpa-check motion-setting">
        <span className="settings-icon">
          <Accessibility size={20} />
        </span>
        <span className="settings-label">
          Reduce motion
          <small id="motion-help">
            {motion === "system"
              ? "Follows your device"
              : reducedMotion
                ? "Less animation and movement"
                : "Full animations"}
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Reduce motion"
          aria-describedby="motion-help"
          checked={reducedMotion}
          onChange={(event) =>
            setMotion(event.target.checked ? "reduce" : "full")
          }
        />
        <span className="gpa-toggle-track" aria-hidden="true" />
      </label>
      <div
        className="preference-reset"
        data-visible={motion !== "system"}
        inert={motion === "system"}
        aria-hidden={motion === "system"}
      >
        <div>
          <button
            type="button"
            className="device-preference"
            onClick={() => setMotion("system")}
          >
            Use device motion setting
          </button>
        </div>
      </div>
    </div>
  );
}
