import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { profileStatus } from "./profile.js";

export default function a2aAddon(pi: ExtensionAPI): void {
  pi.on("resources_discover", () => ({
    skillPaths: [new URL("./skills/a2a/SKILL.md", import.meta.url).pathname],
  }));
  pi.registerTool({
    name: "a2a",
    label: "a2a",
    description:
      "Inspect the A2A interoperability profile. This milestone is read-only and disabled; it cannot discover, send to, or publish agents.",
    parameters: Type.Object({
      action: Type.String({ enum: ["status", "profile"] }),
    }),
    async execute(_id, params) {
      if (params.action !== "status" && params.action !== "profile")
        throw new Error(
          "Unsupported A2A action. Only status and profile are available.",
        );
      const result = profileStatus();
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
