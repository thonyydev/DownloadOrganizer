import { useId, useState } from "react";
import { ChevronDown, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ProblemNotice({ title, message, persistent = false, busy, action, onRecover, onDismiss }: {
  title: string; message: string; persistent?: boolean; busy: boolean; action: string; onRecover: () => void; onDismiss?: () => void;
}) {
  const [collapsedMessage, setCollapsedMessage] = useState("");
  const messageId = useId();
  const collapsed = persistent && collapsedMessage === message;
  return <div className="banner error-banner" role={collapsed ? "status" : "alert"}>
    <ShieldCheck size={16} aria-hidden="true" /><div><strong>{title}{persistent && " · pendente"}</strong><p id={messageId} hidden={collapsed}>{message}</p>
      <div className="notice-actions"><Button variant="outline" size="sm" disabled={busy} onClick={onRecover}>{action}</Button></div>
    </div><Button variant="ghost" size="icon" aria-label={persistent ? collapsed ? "Mostrar detalhes" : "Recolher detalhes do problema" : "Fechar aviso"} aria-expanded={persistent ? !collapsed : undefined} aria-controls={persistent ? messageId : undefined} onClick={() => persistent ? setCollapsedMessage(collapsed ? "" : message) : onDismiss?.()}>{collapsed ? <ChevronDown aria-hidden="true" /> : <X aria-hidden="true" />}</Button>
  </div>;
}
