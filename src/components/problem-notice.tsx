import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ProblemNotice({ title, message, persistent = false, busy, action, onRecover, onDismiss }: {
  title: string; message: string; persistent?: boolean; busy: boolean; action: string; onRecover: () => void; onDismiss?: () => void;
}) {
  const [collapsedMessage, setCollapsedMessage] = useState("");
  const collapsed = persistent && collapsedMessage === message;
  return <div className="banner error-banner" role={collapsed ? "status" : "alert"}>
    <ShieldCheck size={19} aria-hidden="true" /><div><strong>{title}{persistent && " · pendente"}</strong>{!collapsed && <p>{message}</p>}
      <div className="notice-actions"><Button variant="outline" size="sm" disabled={busy} onClick={onRecover}>{action}</Button>{collapsed && <Button variant="ghost" size="sm" onClick={() => setCollapsedMessage("")}>Mostrar detalhes</Button>}</div>
    </div>{!collapsed && <Button variant="ghost" size="icon" aria-label={persistent ? "Recolher detalhes do problema" : "Fechar aviso"} onClick={() => persistent ? setCollapsedMessage(message) : onDismiss?.()}><X aria-hidden="true" /></Button>}
  </div>;
}
