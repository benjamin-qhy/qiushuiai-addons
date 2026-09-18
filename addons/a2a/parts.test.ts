import { expect, test } from "bun:test";
import { Message } from "@a2a-js/sdk";
import { validateParts, partsText } from "./parts.js";

test("text, structured JSON and bounded UTF8 inline files preserve untrusted-data labels", () => {
  const parts = [
    { text: "plain" },
    { data: { amount: 3 }, mediaType: "application/json" },
    {
      raw: Buffer.from("file content").toString("base64"),
      filename: "report.txt",
      mediaType: "text/plain",
    },
  ];
  expect(() => validateParts(parts)).not.toThrow();
  const text = partsText(
    Message.fromJSON({ messageId: "parts", role: "ROLE_USER", parts }),
  );
  expect(text).toContain("plain");
  expect(text).toContain("Untrusted structured data");
  expect(text).toContain("file content");
  expect(text).not.toContain("ZmlsZSBjb250ZW50");
});

test("URI, mixed/legacy/binary parts, traversal names and oversized decoded content fail without I/O", () => {
  for (const parts of [
    [{ url: "http://169.254.169.254/" }],
    [{ text: "text", data: {} }],
    [{ kind: "text", text: "legacy" }],
    [{ raw: "AA==", filename: "a.bin", mediaType: "application/octet-stream" }],
    [{ raw: "aGVsbG8=", filename: "../private", mediaType: "text/plain" }],
    [{ raw: "////", filename: "binary.txt", mediaType: "text/plain" }],
    [{ text: "a".repeat(24577) }],
    [],
  ])
    expect(() => validateParts(parts)).toThrow();
});

test("incremental artifacts require an initial chunk and stop after lastChunk without guessing duplicates", async () => {
  const { A2aArtifactAccumulator } = await import("./artifact-accumulator.js");
  const accumulator = new A2aArtifactAccumulator();
  expect(() =>
    accumulator.apply({
      artifact: { artifactId: "a", parts: [{ text: "second" }] },
      append: true,
    }),
  ).toThrow("before");
  accumulator.apply({
    artifact: { artifactId: "a", parts: [{ text: "first" }] },
    append: false,
  });
  accumulator.apply({
    artifact: { artifactId: "a", parts: [{ text: "second" }] },
    append: true,
    lastChunk: true,
  });
  expect(accumulator.values()).toEqual([
    {
      artifactId: "a",
      parts: [{ text: "first" }, { text: "second" }],
      complete: true,
    },
  ]);
  expect(() =>
    accumulator.apply({
      artifact: { artifactId: "a", parts: [{ text: "duplicate" }] },
      append: true,
    }),
  ).toThrow("complete");
});
