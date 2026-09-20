# @qiushuiai/qiushuiai-addon-whatsapp

WhatsApp channel add-on for QiushuiAI. The package declares Baileys and `qrcode-terminal` as runtime dependencies and keeps its channel contracts, logging and storage-path handling inside the package.

Requires QiushuiAI `>=2.0.0`.

## Configuration

Use **Settings → WhatsApp** to store the phone number and enable the channel through the direct add-on config API, then reload QiushuiAI. Environment overrides are also supported:

| Env var | Description |
|---|---|
| `QIUSHUIAI_WHATSAPP_PHONE` | Phone number to connect (with country code) |
| `QIUSHUIAI_WHATSAPP_ENABLED` | Set to `1` to enable the channel |

## How it works

1. On `session_start`, lazy-loads the Baileys client and connects to WhatsApp Web
2. Registers a channel detector for WhatsApp JIDs (`@s.whatsapp.net`, `@g.us`) via `registerChannelDetector`
3. Inbound messages are posted to the agent via `__qiushuiaiRuntimeInterop.postMessage`
4. On `session_shutdown`, disconnects cleanly

## Files

- `index.ts` — Addon entry point: env gate, channel detector, lifecycle hooks
- `whatsapp.ts` — Baileys WhatsApp client (connection, messaging, presence)
- `whatsapp-presence.ts` — Typing indicator helpers
- `channel-types.ts` — Package-local inbound message contracts
- `logger.ts` — Package-local lifecycle logging

## Settings field appearance (0.1.4)

Text-like fields use the host's shared `settings-addon-*` controls and associated
labels, matching core Settings in Classic and Visual without changing save
payloads, defaults or secret handling. A package-local layered stylesheet keeps
older supported hosts readable; host rules take precedence when available.
Native checkboxes and action buttons retain their own control roles.
