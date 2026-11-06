import { beforeEach } from "vitest";
import { setLanguage } from "@/lib/i18n";
import { version } from "../package.json";

// jsdom reports en-US; suites assert the Portuguese text unless they switch explicitly.
beforeEach(() => {
  setLanguage("pt-BR");
  // The app has been opened before, so the welcome guide stays out of tests that don't ask for it.
  localStorage.setItem("download-organizer-version", version);
});
