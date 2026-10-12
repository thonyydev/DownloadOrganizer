import { File, ArrowRight, SearchX } from "lucide-react";
import { bytes, date, labels, type Category, type FileEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function FileTable({ files, categories, preview = false, filtered = false, onClearFilters }: { files: FileEntry[]; categories: Category[]; preview?: boolean; filtered?: boolean; onClearFilters?: () => void }) {
  if (!files.length) return <div className="empty" role="status"><SearchX size={24} aria-hidden="true" /><h2>{filtered ? "Nenhum resultado para estes filtros" : "Nenhum arquivo por aqui"}</h2><p>{filtered ? "A pasta pode conter arquivos. Tente outro nome ou categoria." : "Os arquivos da pasta selecionada aparecerão aqui."}</p>{filtered && onClearFilters && <Button variant="outline" onClick={onClearFilters}>Limpar filtros</Button>}</div>;
  return <div className="table-scroll"><table className={preview ? "preview-table" : "file-table"}><caption className="sr-only">{preview ? "Arquivos e destinos da prévia" : "Arquivos da pasta de origem"}</caption><colgroup><col className="name-column" />{!preview && <col className="category-column" />}<col className="size-column" /><col className="detail-column" /><col className="status-column" /></colgroup><thead><tr><th scope="col">Arquivo</th>{!preview && <th scope="col">Categoria</th>}<th scope="col" className="number-cell">Tamanho</th><th scope="col">{preview ? "Destino previsto" : "Modificado"}</th><th scope="col">Status</th></tr></thead><tbody>{files.map(file => <tr key={file.path}>
    <td><div className="file-name"><span className={`file-icon tone-${file.category}`}><File size={16} aria-hidden="true" /></span><div className="file-copy"><strong>{file.name}</strong><small className="file-extension">{file.extension ? `.${file.extension}` : "Sem extensão"}</small>{!preview && <details className="file-details"><summary>Ver caminho e destino</summary><p>Origem: {file.path}</p><p>Destino previsto: {file.destination}</p></details>}</div></div></td>
    {!preview && <td><span className={`category-label tone-${file.category}`}>{categories.find(c => c.id === file.category)?.name}</span></td>}
    <td className="tabular number-cell">{bytes(file.size)}</td><td>{preview ? <span className="destination"><ArrowRight size={14} aria-hidden="true" />{file.destination}</span> : <span className="tabular">{date(file.modified)}</span>}</td>
    <td><span className={`status status-${file.status}`}>{labels[file.status]}</span>{file.reason && <small className="reason">{file.reason}</small>}</td>
  </tr>)}</tbody></table></div>;
}
