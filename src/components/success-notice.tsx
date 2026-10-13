import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFeedbackMotion, useMotionAllowed } from "@/components/motion/feedback";
import { useContentMotion } from "@/components/motion/transitions";

export function SuccessNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const allowed = useMotionAllowed();
  const mark = useFeedbackMotion<SVGSVGElement>(message, allowed, true);
  const panel = useContentMotion(message, allowed, true);
  return <div ref={panel} className="banner success-banner" role="status"><Check ref={mark} size={16} aria-hidden="true" /><p>{message}</p><Button variant="ghost" size="icon" aria-label="Fechar aviso" onClick={onDismiss}><X aria-hidden="true" /></Button></div>;
}
