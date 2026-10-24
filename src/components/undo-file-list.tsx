import { Fragment, useCallback, useId, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Undo2 } from "lucide-react";
import { displayPath, basename, type Movement } from "@/lib/api";

export function UndoFileList({ movements }: { movements: Movement[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const helpId = useId();
  const virtual = movements.length > 50;
  const getItemKey = useCallback((index: number) => movements[index].id, [movements]);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: movements.length, getScrollElement: () => scrollRef.current, getItemKey,
    estimateSize: () => 120, overscan: 5, enabled: virtual, useAnimationFrameWithResizeObserver: true,
  });
  const items = virtual ? virtualizer.getVirtualItems() : movements.map((movement, index) => ({ index, key: movement.id, start: 0, end: 0 }));
  let previousEnd = 0;
  return <div ref={scrollRef} className={"undo-files" + (virtual ? " virtual" : "")} role="region" aria-label="Arquivos para restaurar" aria-describedby={helpId} tabIndex={0} onKeyDown={event => {
    if (event.target !== event.currentTarget || !movements.length || !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (virtual) virtualizer.scrollToIndex(event.key === "Home" ? 0 : movements.length - 1, { align: event.key === "Home" ? "start" : "end", behavior: "auto" });
    else event.currentTarget.scrollTop = event.key === "Home" ? 0 : event.currentTarget.scrollHeight;
  }}>
    <p id={helpId} className="sr-only">Use as teclas de rolagem para consultar os caminhos. Home e End levam ao primeiro e último arquivo.</p>
    {movements.length ? <ol className="undo-file-list" aria-label="Movimentos reversíveis">{items.map(item => {
      const movement = movements[item.index];
      const gap = virtual ? item.start - previousEnd : 0;
      previousEnd = item.end;
      return <Fragment key={item.key}>{gap > 0 && <li aria-hidden="true" role="presentation" style={{ height: gap }} />}
        <li className="undo-file-row" data-undo-movement-id={movement.id} data-index={item.index} ref={virtual ? virtualizer.measureElement : undefined} aria-posinset={item.index + 1} aria-setsize={movements.length}>
          <Undo2 size={16} aria-hidden="true" /><div><strong>{basename(movement.source)}</strong><small>Local atual: {displayPath(movement.destination)}</small><small>Restaurar para: {displayPath(movement.source)}</small></div>
        </li></Fragment>;
    })}{virtual && virtualizer.getTotalSize() > previousEnd && <li aria-hidden="true" role="presentation" style={{ height: virtualizer.getTotalSize() - previousEnd }} />}</ol>
      : <p className="undo-summary" role="status">Nenhum arquivo disponível para restaurar.</p>}
  </div>;
}
