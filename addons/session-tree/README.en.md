# Session Tree

Interactive renderer for QiushuiAI's `/tree` command. Requires QiushuiAI `>=2.15.0`.

## Install

Open **Settings → Add-Ons** and install **session-tree** from the catalog, then reload QiushuiAI.

## Behaviour

The add-on registers the `session_tree` widget kind through `globalThis.__qiushuiai_registerWidgetKind`. When `/tree` runs, QiushuiAI supplies the renderer with an invocation-scoped flat snapshot in `artifact.tree` and the current `chatJid`. The renderer reconstructs the hierarchy locally and returns an ordinary HTML widget artifact.

The widget:

- highlights and scrolls to the active leaf
- expands and collapses branches
- filters by ID, label, type, role, tool, or content
- lets the user inspect an entry before acting
- submits exact `/tree <id>` and `/tree <id> --summarize` commands through `window.qiushuiaiWidget.submit`
- reruns exact `/tree` through the widget bridge to capture a fresh snapshot
- renders untrusted snapshot text with DOM text nodes and safely embeds initial JSON
- adapts to narrow layouts and dark or light colour schemes

The renderer never fetches tree data. If the host does not expose the widget registry, the add-on logs a warning and QiushuiAI keeps its normal plain-text response.

## Ownership boundary

QiushuiAI core owns `/tree` command parsing, snapshot construction, navigation, summarization, and plain-text fallback. It passes `{ tree, chatJid }` through the generic renderer registry and generic HTML artifact path.

This add-on exclusively owns the interactive renderer. It does not depend on a session-tree HTTP endpoint, static core viewer, core frontend component, or session-tree-specific artifact routing.
