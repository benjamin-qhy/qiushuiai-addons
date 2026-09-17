import { Part, type Message } from "@a2a-js/sdk";
import {
  ContentTypeNotSupportedError,
  RequestMalformedError,
} from "@a2a-js/sdk/errors";

export const SUPPORTED_MODES = ["text/plain", "application/json"];
const MAX_BYTES = 24 * 1024;
/** Supported textual data only. URLs and opaque/binary executable formats are never fetched. */
export function validateParts(parts: unknown): void {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 8)
    throw new RequestMalformedError("One to eight parts required.");
  let size = 0;
  for (const item of parts) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new RequestMalformedError("Invalid part.");
    const p = item as Record<string, unknown>;
    if ("url" in p || "file" in p || "kind" in p)
      throw new ContentTypeNotSupportedError(
        "URI and legacy parts unsupported.",
      );
    const content = ["text", "data", "raw"].filter((key) => key in p);
    if (content.length !== 1)
      throw new RequestMalformedError("Exactly one part content required.");
    if (
      p.filename !== undefined &&
      (typeof p.filename !== "string" ||
        p.filename.length > 128 ||
        [...p.filename].some((c) => c.charCodeAt(0) < 32) ||
        p.filename.includes("/") ||
        p.filename.includes("\\"))
    )
      throw new RequestMalformedError("Invalid filename.");
    if (
      p.mediaType !== undefined &&
      !SUPPORTED_MODES.includes(String(p.mediaType))
    )
      throw new ContentTypeNotSupportedError("Only textual modes supported.");
    if ("text" in p) {
      if (typeof p.text !== "string")
        throw new RequestMalformedError("Text must be a string.");
      size += Buffer.byteLength(p.text);
    } else if ("data" in p) {
      if (!p.data || typeof p.data !== "object" || Array.isArray(p.data))
        throw new RequestMalformedError("Data must be a JSON object.");
      size += Buffer.byteLength(JSON.stringify(p.data));
    } else {
      if (
        typeof p.raw !== "string" ||
        !p.filename ||
        !SUPPORTED_MODES.includes(String(p.mediaType)) ||
        !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          p.raw,
        )
      )
        throw new ContentTypeNotSupportedError(
          "Inline files require base64 text/plain or application/json and a filename.",
        );
      const bytes = Buffer.from(p.raw, "base64");
      size += bytes.byteLength;
      try {
        const text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
        if (p.mediaType === "application/json") JSON.parse(text);
        if (text.includes("\0")) throw new Error("binary");
      } catch {
        throw new ContentTypeNotSupportedError(
          "Inline file is not valid textual data.",
        );
      }
    }
    if (size > MAX_BYTES)
      throw new ContentTypeNotSupportedError("Decoded parts exceed 24 KiB.");
  }
}
export function partsText(message: Message): string {
  const wire = message.parts.map((p) => Part.toJSON(p));
  validateParts(wire);
  return message.parts
    .map((part) => {
      const value = part.content;
      if (value?.$case === "text") return value.value;
      if (value?.$case === "data")
        return "Untrusted structured data:\n" + JSON.stringify(value.value);
      if (value?.$case === "raw")
        return (
          "Untrusted inline file " +
          JSON.stringify(part.filename) +
          ":\n" +
          new TextDecoder("utf8", { fatal: true }).decode(value.value)
        );
      throw new ContentTypeNotSupportedError();
    })
    .join("\n");
}
