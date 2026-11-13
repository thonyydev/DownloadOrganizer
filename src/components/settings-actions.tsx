import { useEffect, useLayoutEffect, useRef } from "react";
import { animate, usePresence } from "motion/react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { timing } from "@/components/motion/transitions";
import { useMotionAllowed } from "@/components/motion/feedback";

export function SettingsActions({ busy, dirty, external, error, onSave, onDiscard }: {
  busy: boolean; dirty: boolean; external: boolean; error?: string;
  onSave: () => void; onDiscard: () => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  // Rises in when it appears, and sinks out before it is removed (inside AnimatePresence).
  const [present, remove] = usePresence();
  const allowed = useMotionAllowed();
  // Set only once an entrance finishes: StrictMode replays the mount effect, and the replay must animate too.
  const shown = useRef(false);
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    // Leaving goes inert: focus inside would drop to the page, so it returns to the open tab.
    if (!present && surface.contains(document.activeElement)) document.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus();
    if (!allowed || (present && shown.current)) {
      surface.style.opacity = present ? "1" : "0"; surface.style.transform = "none";
      shown.current = present;
      return;
    }
    let stopped = false;
    // The entrance starts hidden; an exit leaves from wherever the bar is.
    const animation = animate(surface, { opacity: [present ? 0 : null, present ? 1 : 0], y: [present ? 12 : null, present ? 0 : 12] }, {
      duration: present ? timing.context : timing.exit, ease: "easeOut",
      onComplete: () => {
        if (stopped) return;
        if (present) { surface.style.transform = "none"; shown.current = true; }
        else remove?.();
      },
    });
    return () => { stopped = true; animation.stop(); };
  }, [present, allowed, remove]);
  // Presence registers the exit in its own layout effect; without motion, removal comes after it.
  useEffect(() => { if (!present && !allowed) remove?.(); }, [present, allowed, remove]);
  useLayoutEffect(() => {
    const rail = railRef.current;
    const surface = surfaceRef.current;
    const main = rail?.closest("main");
    if (!rail || !surface || !main) return;
    const root = document.documentElement;
    const previousPadding = root.style.scrollPaddingBottom;
    let disposed = false;
    let frame: number | undefined;
    const measure = () => {
      if (disposed) return;
      const bounds = main.getBoundingClientRect();
      const style = getComputedStyle(main);
      const bottom = parseFloat(getComputedStyle(rail).bottom) || 0;
      const space = `${surface.offsetHeight + bottom * 2}px`;
      // Use the actual content box, independent of sidebar width and page transforms.
      rail.style.left = `${bounds.left + parseFloat(style.paddingLeft || "0")}px`;
      rail.style.width = `${Math.max(0, bounds.width - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0"))}px`;
      main.style.setProperty("--settings-actions-space", space);
      root.style.scrollPaddingBottom = space;
    };
    measure();
    // Padding changes main's height; defer observer writes to avoid a resize delivery loop.
    const observer = new ResizeObserver(() => {
      if (disposed || frame !== undefined) return;
      frame = requestAnimationFrame(() => { frame = undefined; measure(); });
    });
    observer.observe(main); observer.observe(surface);
    window.addEventListener("resize", measure);
    return () => {
      disposed = true; observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      main.style.removeProperty("--settings-actions-space");
      root.style.scrollPaddingBottom = previousPadding;
    };
  }, []);
  return <div className="settings-actions-rail" ref={railRef} inert={!present}>
    <div className="settings-actions" ref={surfaceRef} role="region" aria-label={t("Settings actions")}>
      {/* The page banner announces it; this copy stays in view when the page is scrolled. */}
      {error && <p className="inline-error">{error}</p>}
      <Button variant="outline" onClick={onDiscard} disabled={busy || !dirty}>{t("Discard changes")}</Button>
      <Button onClick={onSave} disabled={busy || !dirty || external}><Save aria-hidden="true" /><span className="settings-save-label"><span aria-hidden="true" className="settings-save-size">{t("Save preferences")}</span><span>{busy ? t("Saving…") : t("Save preferences")}</span></span></Button>
    </div>
  </div>;
}
