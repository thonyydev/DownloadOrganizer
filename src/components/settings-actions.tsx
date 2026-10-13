import { useLayoutEffect, useRef } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useContentMotion } from "@/components/motion/transitions";
import { useMotionAllowed } from "@/components/motion/feedback";

export function SettingsActions({ busy, dirty, external, onSave, onDiscard }: {
  busy: boolean; dirty: boolean; external: boolean;
  onSave: () => void; onDiscard: () => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useContentMotion("settings-actions", useMotionAllowed(), true);
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
  }, [surfaceRef]);
  return <div className="settings-actions-rail" ref={railRef}>
    <div className="settings-actions" ref={surfaceRef} role="region" aria-label="Ações das configurações">
      <Button variant="outline" onClick={onDiscard} disabled={busy || !dirty}>Descartar alterações</Button>
      <Button onClick={onSave} disabled={busy || !dirty || external}><Save aria-hidden="true" /><span className="settings-save-label"><span aria-hidden="true" className="settings-save-size">Salvar preferências</span><span>{busy ? "Salvando…" : "Salvar preferências"}</span></span></Button>
    </div>
  </div>;
}
