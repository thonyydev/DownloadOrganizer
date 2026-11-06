import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { language, t } from "@/lib/i18n";
import { version } from "../../package.json";

// Screenshots of the real app in each language, made with synthetic files.
const images = import.meta.glob<string>("/src/assets/guide/*/*.webp", { eager: true, import: "default", query: "?url" });
const image = (name: string) => images[`/src/assets/guide/${language()}/${name}.webp`] ?? images[`/src/assets/guide/en/${name}.webp`];

type Step = { title: string; text: string; image: string };

const onboarding = (): Step[] => [
  { title: t("Welcome to Download Organizer"), text: t("It sorts the files in your Downloads folder into folders by type. You always see a preview first, and nothing is ever overwritten."), image: "overview" },
  { title: t("Choose your folders"), text: t("Pick the folder to organize and where the files go. You can add more folders, such as your Desktop, and they all go to the same place."), image: "folders" },
  { title: t("Check before anything moves"), text: t("The preview shows where each file goes. Conflicts come first, and files that stay where they are say so. Nothing moves until you confirm."), image: "preview" },
  { title: t("Make your own rules"), text: t("Send files to your own folders by name, such as invoice*.pdf to Finance, or keep some of them where they are."), image: "rules" },
  { title: t("Let it work on its own"), text: t("Turn on automatic organization and each new download goes to its folder once it finishes, even with the window closed."), image: "automation" },
  { title: t("Undo whenever you want"), text: t("History keeps every move. If a file hasn't changed since, you can put it back where it was."), image: "history" },
];

// The version these notes describe. A release without notes shows nothing after updating.
export const NEWS_VERSION = "0.1.3";
const news = (): Step[] => [
  { title: t("Organize several folders at once"), text: t("Add more source folders in Settings, such as your Desktop or a temporary folder. Files from all of them go to the same destination."), image: "folders" },
  { title: t("Keep some files in place"), text: t("A rule can now keep the files it fits where they are, such as *.torrent. The preview shows that they stay."), image: "rules" },
  { title: t("See where each file came from"), text: t("With several folders, each file in the preview shows its source folder. Files that are only in the cloud, such as OneDrive online-only files, are left alone and never downloaded."), image: "preview" },
];

const versionKey = "download-organizer-version";

/** What to show once per version: the guide for someone new, the news after an update. */
export function welcomeFor(used: boolean, current = version): "onboarding" | "news" | null {
  try {
    const seen = localStorage.getItem(versionKey);
    localStorage.setItem(versionKey, current);
    if (seen === current) return null;
    // Versions before this one didn't record themselves, so a history tells an update from a new install.
    if (seen === null && !used) return "onboarding";
    return NEWS_VERSION === current ? "news" : null;
  } catch { return null; }
}

export function Guide({ kind, onClose, onFinish }: { kind: "onboarding" | "news"; onClose: () => void; onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const steps = kind === "onboarding" ? onboarding() : news();
  const step = steps[index];
  const last = index === steps.length - 1;
  const position = `${t("Step")} ${index + 1} ${t("of")} ${steps.length}`;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="guide">
      <img className="guide-image" src={image(step.image)} alt="" />
      <DialogHeader><DialogTitle>{step.title}</DialogTitle><DialogDescription>{kind === "news" ? `${t("What's new in version")} ${version} · ${position}` : position}</DialogDescription></DialogHeader>
      <p className="guide-text" aria-live="polite">{step.text}</p>
      <DialogFooter>
        {index > 0 && <Button key="back" variant="outline" onClick={() => setIndex(index - 1)}>{t("Back")}</Button>}
        <Button key="next" onClick={() => { if (!last) setIndex(index + 1); else if (kind === "onboarding") onFinish(); else onClose(); }}>{!last ? t("Next") : kind === "onboarding" ? t("Choose my folders") : t("Got it")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
