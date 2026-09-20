/**
 * lite-term/index.ts — Lightweight xterm.js terminal add-on for QiushuiAI.
 *
 * Runtime behavior is browser-side: web/index.ts registers replacement terminal
 * panes that use the existing QiushuiAI terminal backend. This extension entry is
 * intentionally small so the package imports cleanly as a normal QiushuiAI add-on.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function liteTerm(_pi: ExtensionAPI): void {
  // Browser-side pane registration is declared in package.json pi.web.entries.
}
