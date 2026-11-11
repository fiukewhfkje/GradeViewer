import { useEffect, type RefObject } from "react";

/** Keep native details/summary behavior, with a brief slide in either direction. */
export function useDisclosureMotion(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const active = new Map<
      HTMLDetailsElement,
      {
        animation: Animation;
        open: boolean;
        finish: () => void;
      }
    >();
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        !(event.target instanceof Element)
      )
        return;
      const summary = event.target.closest("summary");
      const details = summary?.parentElement;
      if (
        !(details instanceof HTMLDetailsElement) ||
        !details.matches(
          ".settings-provider, .assignment-group, .gpa-card, .password-help",
        ) ||
        document.documentElement.dataset.motion === "reduce" ||
        !details.animate
      )
        return;
      if (event.target.closest("a, button, input, select, textarea")) return;
      event.preventDefault();
      const previous = active.get(details);
      const open = !(previous?.open ?? details.open);
      const start = details.getBoundingClientRect().height;
      if (previous) {
        active.delete(details);
        previous.animation.cancel();
      }
      // Open immediately; retain contents during a closing slide. Native toggle
      // events continue to synchronize controlled connection disclosures.
      details.open = true;
      const style = getComputedStyle(details);
      const collapsed =
        summary!.getBoundingClientRect().height +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth) +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom);
      const end = open ? details.getBoundingClientRect().height : collapsed;
      if (!open && details.contains(document.activeElement))
        summary!.focus({ preventScroll: true });
      details.dataset.disclosureOpen = String(open);
      details.style.overflow = "clip";
      const animation = details.animate(
        [{ height: `${start}px` }, { height: `${end}px` }],
        { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
      const finish = () => {
        if (active.get(details)?.animation !== animation) return;
        active.delete(details);
        details.open = open;
        details.style.removeProperty("overflow");
        delete details.dataset.disclosureOpen;
      };
      active.set(details, { animation, open, finish });
      void animation.finished.then(finish, finish);
    };
    container.addEventListener("click", click);
    return () => {
      container.removeEventListener("click", click);
      for (const entry of [...active.values()]) {
        entry.finish();
        entry.animation.cancel();
      }
    };
  }, [root]);
}
