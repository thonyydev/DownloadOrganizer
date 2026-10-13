import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { animate } from "motion/react";

const query = "(prefers-reduced-motion: reduce)";
function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}
function allowed() { return typeof window.matchMedia === "function" && !document.hidden && !window.matchMedia(query).matches; }

// Motion 14's useReducedMotion snapshots the preference; subscribe to live changes too.
export function useMotionAllowed() { return useSyncExternalStore(subscribe, allowed, () => false); }

export function useFeedbackMotion<T extends HTMLElement | SVGElement>(identity: string, enabled: boolean, enter = false) {
  const ref = useRef<T>(null);
  const previous = useRef<string | null>(enter ? null : identity);
  useLayoutEffect(() => {
    const changed = previous.current !== identity;
    previous.current = identity;
    const element = ref.current;
    if (!element) return;
    if (!enabled || !changed) { element.style.opacity = "1"; return; }
    const animation = animate(element, { opacity: [0.45, 1] }, { duration: 0.18, ease: "easeOut" });
    return () => { animation.stop(); element.style.opacity = "1"; };
  }, [identity, enabled]);
  return ref;
}
