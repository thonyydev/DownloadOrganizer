import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { displayPath, api, bytes, date, type Category, type FileEntry, type FilePreview } from "@/lib/api";
import { MediaPreviewPlayer, mediaExtensions, mediaTime, type MediaMetadata, type MediaPlayerHandle } from "@/components/media-preview-player";
import { errorMessage } from "@/lib/experience";
import { t } from "@/lib/i18n";

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
        setState({ key, error: t("Could not display the thumbnail safely.") });
      } else setState({ key, result });
    }).catch(error => { if (active) setState({ key, error: errorMessage(error) }); });
    return () => { active = false; };
  }, [file, key, media]);
  const current = state?.key === key ? state : null;
  const result = current?.result;
  return <Dialog open={file !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="file-preview-dialog" onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}>
      <DialogHeader><DialogTitle>{t("View file")}</DialogTitle><DialogDescription>{t("Read-only. Viewing doesn't organize or change the file.")}</DialogDescription></DialogHeader>
      <div className="file-preview-image">
        {media && file ? <MediaPreviewPlayer key={key} file={file} ref={player} onMetadata={setMetadata} /> : current?.error ? <div className="file-preview-message" role="alert"><ImageOff aria-hidden="true" size={24} /><p>{current.error}</p><Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>{t("Try again")}</Button></div>
          : result?.data_url ? <img src={result.data_url} alt={`${t("Preview of")} ${file?.name}`} onError={() => setState(current => current?.key === key ? { key, error: t("Could not display the thumbnail. Try again.") } : current)} />
            : result ? <div className="file-preview-message" role="status"><ImageOff aria-hidden="true" size={24} /><p>{t("Preview isn't available for this format.")}</p><p>{t("Images: JPEG, PNG, WebP, BMP and GIF. Audio and video depend on the codecs available to the player.")}</p></div>
              : <div className="file-preview-message" role="status"><Loader2 className="spin" aria-hidden="true" size={24} /><p>{t("Preparing file preview…")}</p></div>}
      </div>
      {file && <dl className="file-preview-metadata"><dt>{t("Name")}</dt><dd>{file.name}</dd><dt>{t("Extension")}</dt><dd>{file.extension ? `.${file.extension}` : t("No extension")}</dd><dt>{t("Category")}</dt><dd>{categories.find(category => category.id === file.category)?.name ?? file.category}</dd><dt>{t("Size")}</dt><dd>{bytes(file.size)}</dd><dt>{t("Modified")}</dt><dd>{file.modified > 0 ? date(file.modified) : t("Unavailable")}</dd><dt>{t("Resolution")}</dt><dd>{metadata?.width && metadata.height ? `${metadata.width} × ${metadata.height} px` : result?.width && result.height ? `${result.width} × ${result.height} px` : t("Unavailable")}</dd>{media && <><dt>{t("Duration")}</dt><dd>{metadata?.duration ? mediaTime(metadata.duration) : t("Unavailable")}</dd></>}<dt>{t("Source")}</dt><dd>{displayPath(file.path)}</dd><dt>{t("Planned destination")}</dt><dd>{displayPath(file.destination)}</dd></dl>}
    </DialogContent>
  </Dialog>;
}
