import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { LoadingIndicator } from "./LoadingIndicator";

const phoneTouchQuery = "(max-width: 760px) and (pointer: coarse)";
const threshold = 56;
type Phase = "idle" | "pulling" | "refreshing" | "settling";

/** Keep frame-by-frame gesture state out of the grade screen's render tree. */
export function PullRefresh({
  container,
  content,
  enabled,
  refresh,
}: {
  container: RefObject<HTMLElement | null>;
  content: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  refresh: () => Promise<void>;
}) {
  const [state, setState] = useState({ distance: 0, phase: "idle" as Phase });
  const latest = useRef({ enabled, refresh });
  const cancelPull = useRef<() => void>(() => {});
  latest.current = { enabled, refresh };
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    element.dataset.pulling = String(state.phase === "pulling");
    element.style.transform = state.distance
      ? `translateY(${state.distance}px)`
      : "";
  }, [content, state]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const phone = matchMedia(phoneTouchQuery);
    let gesture:
      | {
          id: number;
          x: number;
          y: number;
          distance: number;
          captured: boolean;
        }
      | undefined;
    let phase: Phase = "idle",
      disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    const cancelFrame = () => {
      if (frame === undefined) return;
      cancelAnimationFrame(frame);
      frame = undefined;
    };
    const update = (distance: number, next: Phase) => {
      phase = next;
      setState((current) =>
        current.distance === distance && current.phase === next
          ? current
          : { distance, phase: next },
      );
    };
    const settle = () => {
      gesture = undefined;
      cancelFrame();
      clearTimeout(timer);
      update(0, "settling");
      timer = setTimeout(() => update(0, "idle"), 240);
    };
    const cancel = () => {
      if (phase === "refreshing") return;
      if (phase === "pulling") settle();
      else {
        gesture = undefined;
        cancelFrame();
      }
    };
    cancelPull.current = cancel;
    const start = (event: TouchEvent) => {
      if (phase === "refreshing") return;
      if (gesture || phase === "pulling") settle();
      gesture = undefined;
      if (
        !phone.matches ||
        !latest.current.enabled ||
        event.touches.length !== 1 ||
        element.scrollTop > 1
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          "a,input,select,textarea,summary,dialog,[role=slider],[data-no-pull]",
        )
      )
        return;
      // A nested scroll view keeps its own gesture, even when the app is at top.
      for (
        let node = target;
        node && node !== element;
        node = node.parentElement
      ) {
        if (
          node.scrollHeight > node.clientHeight + 1 &&
          /auto|scroll/.test(getComputedStyle(node).overflowY)
        )
          return;
      }
      clearTimeout(timer);
      update(0, "idle");
      const touch = event.touches[0];
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        distance: 0,
        captured: false,
      };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (
        !latest.current.enabled ||
        event.touches.length !== 1 ||
        element.scrollTop > 1
      )
        return cancel();
      const touch = event.touches[0];
      if (touch.identifier !== gesture.id) return cancel();
      const dy = touch.clientY - gesture.y,
        dx = Math.abs(touch.clientX - gesture.x);
      if (!gesture.captured) {
        if (dy < -6 || dx > Math.max(8, dy)) return cancel();
        if (dy < 6) return;
        // Never animate a pull after the browser has claimed the gesture.
        if (!event.cancelable) return cancel();
        gesture.captured = true;
      }
      if (event.cancelable) event.preventDefault();
      gesture.distance = 96 * (1 - Math.exp(-Math.max(0, dy - 6) / 160));
      if (frame === undefined)
        frame = requestAnimationFrame(() => {
          frame = undefined;
          if (gesture) update(gesture.distance, "pulling");
        });
    };
    const end = () => {
      if (!gesture) return;
      const ready =
        gesture.captured &&
        gesture.distance >= threshold &&
        latest.current.enabled;
      gesture = undefined;
      cancelFrame();
      if (!ready && phase !== "pulling") return;
      if (!ready) return settle();
      update(54, "refreshing");
      // Retain the spinner and inset until the actual refresh completes.
      void Promise.resolve()
        .then(() => latest.current.refresh())
        .catch(() => {})
        .finally(() => {
          if (!disposed) settle();
        });
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end, { passive: true });
    element.addEventListener("touchcancel", cancel, { passive: true });
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      cancelFrame();
      clearTimeout(timer);
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [container]);
  useEffect(() => {
    if (!enabled) cancelPull.current();
  }, [enabled]);
  const { distance, phase } = state;
  const refreshing = phase === "refreshing";
  return (
    <div
      className="pull-refresh"
      role="status"
      aria-live="polite"
      data-visible={distance > 0}
      data-phase={phase}
      style={{ transform: `translateY(${distance - 50}px)` }}
    >
      <LoadingIndicator
        size={22}
        active={refreshing}
        progress={Math.min(1, distance / threshold)}
        style={
          refreshing ? undefined : { transform: `rotate(${distance * 4}deg)` }
        }
      />
      <span className="sr-only">{refreshing ? "Refreshing grades" : ""}</span>
    </div>
  );
}
