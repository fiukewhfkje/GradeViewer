import { useEffect, type RefObject } from "react";
import { COMPACT_MOTION_QUERY } from "./Appearance";

const phoneSlide = {
  duration: 180,
  easing: "cubic-bezier(0.25, 0.6, 0.35, 1)",
  fill: "both",
} as const;

function* followingSettingsRows(details: HTMLDetailsElement, layout: Element) {
  // Only following siblings move. Animating a parent would also shift the
  // summary the user tapped, or animate descendants a second time.
  for (let node: Element | null = details; node; node = node.parentElement) {
    for (
      let next = node.nextElementSibling;
      next;
      next = next.nextElementSibling
    )
      yield next;
    if (node === layout) break;
  }
}

/** Keep native details/summary behavior and let compact Settings slide without animating height. */
export function useDisclosureMotion(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const compact = matchMedia(COMPACT_MOTION_QUERY);
    let settingsSlide:
      | {
          details: HTMLDetailsElement;
          open: boolean;
          animations: Animation[];
          finish: () => void;
        }
      | undefined;
    function slideSettings(details: HTMLDetailsElement, summary: HTMLElement) {
      const card = details.parentElement;
      const body = details.querySelector<HTMLElement>(
        ":scope > .connection-content",
      );
      const layout = details.closest(".settings-layout");
      if (!card?.matches(".settings-card") || !body || !layout) return false;

      const previous = settingsSlide;
      const open = !(previous?.details === details
        ? previous.open
        : details.open);
      if (!open && details.contains(document.activeElement))
        summary.focus({ preventScroll: true });
      if (previous?.details === details) {
        previous.open = open;
        details.dataset.disclosureOpen = String(open);
        body.inert = !open;
        for (const animation of previous.animations) animation.reverse();
        return true;
      }
      previous?.finish();
      details.dataset.disclosureOpen = String(open);
      details.open = true;
      const height = body.getBoundingClientRect().height;
      if (!height) {
        details.open = open;
        delete details.dataset.disclosureOpen;
        return true;
      }
      // Use the expanded layout throughout the slide. The card's edge and
      // content reveal track the rows below it while the DOM stays in place.
      body.inert = !open;
      const animate = (target: Element, frames: Keyframe[]) => {
        const animation = target.animate(frames, phoneSlide);
        if (!open) animation.reverse();
        return animation;
      };
      const animations = [
        animate(card, [
          { clipPath: `inset(0 0 ${height}px 0 round 18px)` },
          { clipPath: "inset(0 0 0 0 round 18px)" },
        ]),
        animate(body, [
          { clipPath: "inset(0 0 100% 0)", opacity: 0.6 },
          { clipPath: "inset(0 0 0% 0)", opacity: 1 },
        ]),
        ...Array.from(followingSettingsRows(details, layout), (row) =>
          animate(row, [
            { transform: `translateY(-${height}px)` },
            { transform: "translateY(0)" },
          ]),
        ),
      ];
      const slide = {
        details,
        open,
        animations,
        finish: () => {
          if (settingsSlide !== slide) return;
          settingsSlide = undefined;
          details.open = slide.open;
          body.inert = false;
          delete details.dataset.disclosureOpen;
          for (const animation of animations) animation.cancel();
        },
      };
      settingsSlide = slide;
      void animations[0].finished.then(slide.finish, slide.finish);
      return true;
    }
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
      if (compact.matches) {
        if (slideSettings(details, summary!)) event.preventDefault();
        else if (details.open && details.contains(document.activeElement))
          summary!.focus({ preventScroll: true });
        return;
      }
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
    const finishActive = () => {
      settingsSlide?.finish();
      for (const entry of [...active.values()]) {
        entry.finish();
        entry.animation.cancel();
      }
    };
    compact.addEventListener("change", finishActive);
    container.addEventListener("click", click);
    return () => {
      container.removeEventListener("click", click);
      compact.removeEventListener("change", finishActive);
      finishActive();
    };
  }, [root]);
}
