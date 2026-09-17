---
name: a2a
description: Inspect the staged A2A v1 interoperability profile. This milestone is disabled and cannot call or publish agents.
distribution: public
---

# A2A profile

Use `a2a({action:"status"})` or `a2a({action:"profile"})` to inspect the pinned profile and implementation blockers. These actions perform no network I/O and expose no credentials.

Do not infer agent interoperability from the presence of this tool. Send, discover, subscribe, cancel, publication and enablement are unavailable in this milestone. Do not bypass missing admitted-operation capabilities through chat/enqueue, change Remote Peer/Iroh pairing, or enable production networking.

Read [the profile matrix](../../docs/profile.md) before implementing dependent slices. Core receives only generic admitted-operation APIs; A2A protocol and identity remain in this package. Operator credentials belong in keychain references, never cards/messages/history.
