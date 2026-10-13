import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, animate, usePresence } from "motion/react";
import { useMotionAllowed } from "./feedback";
import { timing } from "./transitions";

function CollapseBody({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const [present, remove] = usePresence();
  const allowed = useMotionAllowed();
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const previous = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    const changed = previous.current !== present;
    previous.current = present;
    const element = ref.current;
    if (!element) return;
    if (!present && element.contains(document.activeElement)) {
      [...document.querySelectorAll<HTMLElement>("[aria-controls]")].find(trigger => trigger.getAttribute("aria-controls") === id)?.focus();
    }
    if (!allowed || (!changed && present)) {
      element.style.height = present ? "auto" : "0px"; element.style.opacity = present ? "1" : "0";
      first.current = false;
      return;
    }
    // Measure once per toggle; never read layout inside animation frames.
    const from = first.current ? 0 : element.getBoundingClientRect().height;
    const to = present ? element.scrollHeight : 0;
    first.current = false;
    let stopped = false;
    const animation = animate(element, { height: [from, to], opacity: present ? [0.65, 1] : [1, 0.65] }, {
      duration: present ? timing.disclosure : timing.exit, ease: "easeOut",
      onComplete: () => {
        if (stopped) return;
        if (present) { element.style.height = "auto"; element.style.opacity = "1"; }
        else remove?.();
      },
    });
    return () => { stopped = true; animation.stop(); previous.current = null; };
  }, [present, allowed, remove, id]);
  // Presence registers exiting keys in its parent layout effect. Immediate removal
  // must happen afterwards; the layout effect above already hides closed content.
  useEffect(() => { if (!present && !allowed) remove?.(); }, [present, allowed, remove]);
  return <div id={id} ref={ref} className="motion-collapse" aria-hidden={!present || undefined} inert={!present}><div className={className}>{children}</div></div>;
}

export function Collapse({ open, id, className, children }: { open: boolean; id: string; className?: string; children: ReactNode }) {
  return <AnimatePresence initial={false}>{open && <CollapseBody key={id} id={id} className={className}>{children}</CollapseBody>}</AnimatePresence>;
}
