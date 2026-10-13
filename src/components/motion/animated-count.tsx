import { useLayoutEffect, useRef } from "react";
import { animate } from "motion/react";
import { useMotionAllowed } from "./feedback";

export function AnimatedCount({ value }: { value: number }) {
  const allowed = useMotionAllowed();
  const visual = useRef<HTMLSpanElement>(null);
  const displayed = useRef(value);
  useLayoutEffect(() => {
    const element = visual.current;
    if (!element) return;
    const from = displayed.current;
    if (!allowed || from === value) {
      displayed.current = value;
      element.textContent = String(value);
      return;
    }
    element.textContent = String(Math.round(from));
    let stopped = false;
    const animation = animate(from, value, {
      duration: 0.18, ease: "easeOut",
      onUpdate: latest => {
        if (stopped) return;
        displayed.current = latest;
        element.textContent = String(Math.round(latest));
      },
      onComplete: () => {
        if (stopped) return;
        displayed.current = value;
        element.textContent = String(value);
      },
    });
    return () => { stopped = true; animation.stop(); };
  }, [value, allowed]);
  return <span className="animated-count"><span className="sr-only">{value}</span><span className="count-width" aria-hidden="true">{value}</span><span className="count-visual" aria-hidden="true" ref={visual}>{value}</span></span>;
}
