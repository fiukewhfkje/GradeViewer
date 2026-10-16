import { useEffect, useRef, useState, type RefObject } from "react";

export const PHONE_TOUCH_QUERY = "(max-width: 760px) and (pointer: coarse)";
const threshold = 64;

export function usePullRefresh(
  container: RefObject<HTMLElement | null>,
  enabled: boolean,
  refresh: () => void,
) {
  const [distance, setDistance] = useState(0);
  const latest = useRef({ enabled, refresh });
  latest.current = { enabled, refresh };
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const phone = matchMedia(PHONE_TOUCH_QUERY);
    let gesture:
      { id: number; x: number; y: number; distance: number } | undefined;
    const cancel = () => {
      gesture = undefined;
      setDistance(0);
    };
    const start = (event: TouchEvent) => {
      cancel();
      if (
        !phone.matches ||
        !latest.current.enabled ||
        event.touches.length !== 1 ||
        window.scrollY > 0
      )
        return;
      if (
        (event.target as Element).closest(
          "a,input,select,textarea,summary,dialog,[role=slider]",
        )
      )
        return;
      const touch = event.touches[0];
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        distance: 0,
      };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (
        !latest.current.enabled ||
        event.touches.length !== 1 ||
        window.scrollY > 0
      )
        return cancel();
      const touch = Array.from(event.touches).find(
        (t) => t.identifier === gesture!.id,
      );
      if (!touch) return cancel();
      const dy = touch.clientY - gesture.y,
        dx = Math.abs(touch.clientX - gesture.x);
      if (dy < -5 || dx > Math.max(12, dy)) return cancel();
      if (dy > 10 && event.cancelable) event.preventDefault();
      gesture.distance = Math.min(90, Math.max(0, dy * 0.5));
      setDistance(gesture.distance);
    };
    const end = () => {
      const ready =
        gesture && gesture.distance >= threshold && latest.current.enabled;
      cancel();
      if (ready) latest.current.refresh();
    };
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end, { passive: true });
    element.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", cancel);
    };
  }, [container]);
  return { distance, ready: distance >= threshold };
}
