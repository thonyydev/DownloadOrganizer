import { useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";

const storageKey = "download-organizer-rules-tutorial";

/** True only the first time. Without storage it stays quiet instead of opening on every new rule. */
export function firstRuleTutorial() {
  try {
    if (localStorage.getItem(storageKey)) return false;
    localStorage.setItem(storageKey, "seen");
    return true;
  } catch { return false; }
}

function Route({ from, to }: { from: string; to: string }) {
  return <li className="rules-route"><code>{from}</code><ArrowRight size={14} aria-label={t("goes to")} /><code>{to}</code></li>;
}

const steps = (): { title: string; body: ReactNode }[] => [
  {
    title: t("Your own folders for your files"),
    body: <>
      <p>{t("A rule sends files to the folder you choose, based on their name. You write a pattern and a folder name, and the app does the rest.")}</p>
      <ul className="rules-examples"><Route from="invoice*.pdf" to="Finance" /><Route from="*.stl" to={t("3D models")} /></ul>
    </>,
  },
  {
    title: t("Write the pattern"),
    body: <>
      <p>{t("The pattern describes the whole file name, including the extension. Capital letters don't matter.")}</p>
      <p>{t("Use * for any text and ? for exactly one character.")}</p>
      <dl className="rules-patterns">
        <dt><code>*.stl</code></dt><dd>{t("Any file that ends in .stl")}</dd>
        <dt><code>invoice*.pdf</code></dt><dd>{t("PDFs with a name that starts with invoice")}</dd>
        <dt><code>photo-?.jpg</code></dt><dd>{t("photo-1.jpg, but not photo-10.jpg")}</dd>
        <dt><code>report.pdf</code></dt><dd>{t("Only the file with exactly this name")}</dd>
      </dl>
    </>,
  },
  {
    title: t("Name the folder"),
    body: <>
      <p>{t("Type only the name of the folder, such as Finance. It goes inside your destination folder, and the app creates it when the first file needs it.")}</p>
      <p>{t("If a folder with that name is already there, the files go into it.")}</p>
      <p>{t("Slashes and other characters that Windows doesn't allow in names aren't accepted. If something is wrong, the app tells you when you save.")}</p>
    </>,
  },
  {
    title: t("When more than one rule fits"),
    body: <>
      <p>{t("Rules are checked from top to bottom, and the first one that fits decides. Put the most specific rules first.")}</p>
      <ul className="rules-examples"><Route from="invoice*.pdf" to="Finance" /><Route from="*.pdf" to="PDFs" /></ul>
      <p>{t("With these rules, invoice-1.pdf goes to Finance and manual.pdf goes to PDFs. To change the order, remove a rule and add it again.")}</p>
      <p>{t("Rules come before categories and work even if the file's category is turned off. Files that fit no rule follow the categories as usual. A pattern of * alone catches every file.")}</p>
    </>,
  },
  {
    title: t("Your files stay safe"),
    body: <ul className="rules-safety">
      <li>{t("Rules start working after you save your preferences.")}</li>
      <li>{t("The preview shows where each file will go, before anything moves.")}</li>
      <li>{t("With automatic organization on, new files follow your rules too.")}</li>
      <li>{t("Temporary and empty files are left where they are, even if a pattern fits them.")}</li>
      <li>{t("Existing files are never overwritten, and you can undo a move from History.")}</li>
      <li>{t("Changing a rule doesn't move files that were already organized.")}</li>
    </ul>,
  },
];

export function RulesTutorial({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  // This dialog has no Radix trigger, so focus would otherwise fall back to the page.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const all = steps();
  const step = all[index];
  const last = index === all.length - 1;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="rules-tutorial" onCloseAutoFocus={() => opener?.focus()}>
      <DialogHeader><DialogTitle>{step.title}</DialogTitle><DialogDescription>{t("Step")} {index + 1} {t("of")} {all.length}</DialogDescription></DialogHeader>
      <div className="rules-tutorial-body" aria-live="polite">{step.body}</div>
      <DialogFooter>
        {index > 0 && <Button key="back" variant="outline" onClick={() => setIndex(index - 1)}>{t("Back")}</Button>}
        <Button key="next" onClick={() => { if (last) onClose(); else setIndex(index + 1); }}>{last ? t("Create my rules") : t("Next")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
