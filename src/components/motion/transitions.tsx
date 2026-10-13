import { useCallback, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { animate } from "motion/react";
import { useMotionAllowed } from "./feedback";

export const timing = { page: 0.2, context: 0.16, disclosure: 0.22, exit: 0.14, stagger: 0.025 };
const entrances = {
  page: { opacity: 0.8, y: 6, scale: 1, duration: timing.page },
  context: { opacity: 0.75, y: 4, scale: 1, duration: timing.context },
  dialog: { opacity: 0.65, y: 8, scale: 0.99, duration: timing.page },
  theme: { opacity: 0.9, y: 0, scale: 1, duration: timing.page },
};

export function useContentMotion(identity: string, enabled: boolean, enter = false, pattern: keyof typeof entrances = "context") {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<string | null>(enter ? null : identity);
  useLayoutEffect(() => {
    const changed = previous.current !== identity;
    previous.current = identity;
    const root = ref.current;
    if (!root) return;
    const groups = pattern === "page" ? [...root.querySelectorAll<HTMLElement>("[data-motion-group]")].slice(0, 4) : [];
    const elements = [root, ...groups];
    const reset = () => elements.forEach(element => { element.style.opacity = "1"; element.style.transform = "none"; });
    if (!enabled || !changed) { reset(); return; }
    let stopped = false;
    const animations = elements.map((element, index) => {
      const preset = index ? entrances.context : entrances[pattern];
      return animate(element, { opacity: [preset.opacity, 1], y: [preset.y, 0], scale: [preset.scale, 1] }, {
        duration: preset.duration, delay: index ? (index - 1) * timing.stagger : 0, ease: "easeOut",
        onComplete: () => { if (!stopped) element.style.transform = "none"; },
      });
    });
    return () => {
      stopped = true; animations.forEach(animation => animation.stop()); reset();
      // StrictMode replays mount effects; an interrupted entrance must be able to restart.
      previous.current = null;
    };
  }, [identity, enabled, pattern]);
  return ref;
}

export function PageTransition({ children }: { children: ReactNode }) {
  const ref = useContentMotion("page", useMotionAllowed(), true, "page");
  return <div ref={ref} className="page-content">{children}</div>;
}

export function NavigationIndicator({ page }: { page: string }) {
  const allowed = useMotionAllowed();
  const ref = useRef<HTMLSpanElement>(null);
  const displayed = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const nav = element?.parentElement;
    if (!element || !nav) return;
    let animation: ReturnType<typeof animate> | undefined;
    let destination: number | undefined;
    let generation = 0;
    let disposed = false;
    const write = (value: number) => {
      displayed.current = value;
      element.style.transform = `translateY(${value}px)`;
    };
    const update = () => {
      if (disposed) return;
      const selected = nav.querySelector<HTMLElement>(".nav-item[aria-current=page]");
      if (!selected) return;
      const bounds = selected.getBoundingClientRect();
      const inset = 6;
      // Both boxes use viewport coordinates: page/sidebar scrolling cancels out.
      const target = bounds.top - nav.getBoundingClientRect().top + inset;
      element.style.height = `${Math.max(0, bounds.height - inset * 2)}px`;
      if (destination === target) return;
      destination = target;
      const version = ++generation;
      animation?.stop();
      const from = displayed.current;
      if (!allowed || from === null || from === target) { write(target); return; }
      animation = animate(from, target, {
        type: "spring", duration: timing.disclosure, bounce: 0,
        onUpdate: value => { if (version === generation) write(value); },
        onComplete: () => { if (version === generation) write(target); },
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    nav.querySelectorAll(".nav-item").forEach(item => observer.observe(item));
    return () => { disposed = true; ++generation; animation?.stop(); observer.disconnect(); };
  }, [page, allowed]);
  return <span ref={ref} className="nav-indicator" aria-hidden="true" />;
}

export function usePagePosition<T extends string>(page: T, heading: RefObject<HTMLHeadingElement | null>, navigate: (page: T) => void) {
  const positions = useRef(new Map<T, { top: number; table: number }>());
  const current = useRef(page);
  useLayoutEffect(() => {
    current.current = page;
    heading.current?.focus({ preventScroll: true });
    const { top, table } = positions.current.get(page) ?? { top: 0, table: 0 };
    if (window.scrollY !== top) window.scrollTo({ top, behavior: "instant" });
    const scroller = document.querySelector(".page-content .table-scroll");
    if (scroller) scroller.scrollTop = table;
  }, [page, heading]);
  return useCallback((next: T) => {
    positions.current.set(current.current, { top: window.scrollY, table: document.querySelector(".page-content .table-scroll")?.scrollTop ?? 0 });
    navigate(next);
  }, [navigate]);
}
