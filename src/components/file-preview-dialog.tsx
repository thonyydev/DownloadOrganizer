import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { displayPath, api, bytes, date, type Category, type FileEntry, type FilePreview } from "@/lib/api";
import { MediaPreviewPlayer, mediaExtensions, mediaTime, type MediaMetadata, type MediaPlayerHandle } from "@/components/media-preview-player";
import { errorMessage } from "@/lib/experience";

export function FilePreviewDialog({ file, categories, onClose, onRestoreFocus }: {
  file: FileEntry | null; categories: Category[]; onClose: () => void; onRestoreFocus: () => void;
}) {
  const player = useRef<MediaPlayerHandle>(null);
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null);
  const media = !!file && mediaExtensions.has(file.extension.toLowerCase());
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; result?: FilePreview; error?: string } | null>(null);
  const key = file ? JSON.stringify([file.path, file.size, file.modified, attempt]) : "";
  useLayoutEffect(() => { const instance = player.current; setMetadata(null); return () => instance?.stop(); }, [key]);
  useLayoutEffect(() => { if (!file) setState(null); }, [file]);
  useEffect(() => {
    if (!file || media) return;
    let active = true;
    api.filePreview(file).then(result => {
      if (!active) return;
      if (result.data_url && !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.data_url)) {
        setState({ key, error: "Não foi possível exibir a miniatura com segurança." });
      } else setState({ key, result });
    }).catch(error => { if (active) setState({ key, error: errorMessage(error) }); });
    return () => { active = false; };
  }, [file, key, media]);
  const current = state?.key === key ? state : null;
  const result = current?.result;
  return <Dialog open={file !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="file-preview-dialog" onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}>
      <DialogHeader><DialogTitle>Visualizar arquivo</DialogTitle><DialogDescription>Consulta somente leitura. A visualização não organiza nem modifica o arquivo.</DialogDescription></DialogHeader>
      <div className="file-preview-image">
        {media && file ? <MediaPreviewPlayer key={key} file={file} ref={player} onMetadata={setMetadata} /> : current?.error ? <div className="file-preview-message" role="alert"><ImageOff aria-hidden="true" size={24} /><p>{current.error}</p><Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Tentar novamente</Button></div>
          : result?.data_url ? <img src={result.data_url} alt={`Prévia de ${file?.name}`} onError={() => setState(current => current?.key === key ? { key, error: "Não foi possível exibir a miniatura. Tente novamente." } : current)} />
            : result ? <div className="file-preview-message" role="status"><ImageOff aria-hidden="true" size={24} /><p>Visualização não disponível para este formato.</p><p>Imagens: JPEG, PNG, WebP, BMP e GIF. Áudio e vídeo dependem dos codecs disponíveis no player.</p></div>
              : <div className="file-preview-message" role="status"><Loader2 className="spin" aria-hidden="true" size={24} /><p>Preparando visualização…</p></div>}
      </div>
      {file && <dl className="file-preview-metadata"><dt>Nome</dt><dd>{file.name}</dd><dt>Extensão</dt><dd>{file.extension ? `.${file.extension}` : "Sem extensão"}</dd><dt>Categoria</dt><dd>{categories.find(category => category.id === file.category)?.name ?? file.category}</dd><dt>Tamanho</dt><dd>{bytes(file.size)}</dd><dt>Modificado</dt><dd>{file.modified > 0 ? date(file.modified) : "Indisponível"}</dd><dt>Resolução</dt><dd>{metadata?.width && metadata.height ? `${metadata.width} × ${metadata.height} px` : result?.width && result.height ? `${result.width} × ${result.height} px` : "Indisponível"}</dd>{media && <><dt>Duração</dt><dd>{metadata?.duration ? mediaTime(metadata.duration) : "Indisponível"}</dd></>}<dt>Origem</dt><dd>{displayPath(file.path)}</dd><dt>Destino previsto</dt><dd>{displayPath(file.destination)}</dd></dl>}
    </DialogContent>
  </Dialog>;
}
