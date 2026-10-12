import { File, ArrowRight, SearchX } from "lucide-react";
import { bytes, date, labels, type Category, type FileEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function FileTable({ files, categories, preview = false, filtered = false, onClearFilters }: { files: FileEntry[]; categories: Category[]; preview?: boolean; filtered?: boolean; onClearFilters?: () => void }) {
  if (!files.length) return <div className="empty" role="status"><SearchX size={30} aria-hidden="true" /><h3>{filtered ? "Nenhum resultado para estes filtros" : "Nenhum arquivo por aqui"}</h3><p>{filtered ? "A pasta pode conter arquivos. Tente outro nome ou categoria." : "Os arquivos da pasta selecionada aparecerão aqui."}</p>{filtered && onClearFilters && <Button variant="outline" onClick={onClearFilters}>Limpar filtros</Button>}</div>;
  return <div className="table-scroll"><table><thead><tr><th>Arquivo</th>{!preview && <th>Categoria</th>}<th>Tamanho</th><th>{preview ? "Destino previsto" : "Modificado"}</th><th>Status</th></tr></thead><tbody>{files.map(file => <tr key={file.path}>
    <td><div className="file-name"><span className={`file-icon tone-${file.category}`}><File size={17} aria-hidden="true" /></span><span><strong>{file.name}</strong><small>{file.extension ? `.${file.extension}` : "Sem extensão"}</small>{!preview && <details className="file-details"><summary>Ver caminho e destino</summary><p>Origem: {file.path}</p><p>Destino previsto: {file.destination}</p></details>}</span></div></td>
    {!preview && <td><span className={`category-label tone-${file.category}`}>{categories.find(c => c.id === file.category)?.name}</span></td>}
    <td className="tabular">{bytes(file.size)}</td><td>{preview ? <span className="destination" title={file.destination}><ArrowRight size={13} />{file.destination}</span> : <span className="tabular">{date(file.modified)}</span>}</td>
    <td><span className={`status status-${file.status}`}>{labels[file.status]}</span>{file.reason && <small className="reason">{file.reason}</small>}</td>
  </tr>)}</tbody></table></div>;
}
