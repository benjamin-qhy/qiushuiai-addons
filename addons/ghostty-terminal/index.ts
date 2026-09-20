/**
 * ghostty-terminal/index.ts — Optional Ghostty-web terminal renderer for QiushuiAI.
 *
 * Runtime behavior is browser-side: web/index.js registers replacement terminal
 * panes that use the existing QiushuiAI terminal backend. This extension entry is
 * intentionally small so the package imports cleanly as a normal QiushuiAI add-on.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function ghosttyTerminal(_pi: ExtensionAPI): void {
  // Browser-side pane registration is declared in package.json pi.web.entries.
}
