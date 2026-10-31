import { beforeEach } from "vitest";
import { setLanguage } from "@/lib/i18n";

// jsdom reports en-US; suites assert the Portuguese text unless they switch explicitly.
beforeEach(() => setLanguage("pt-BR"));
