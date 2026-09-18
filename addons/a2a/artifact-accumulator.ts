import { validateParts } from "./parts.js";

/** Bounded reference accumulator for incremental peer artifacts; no URI dereference. */
export class A2aArtifactAccumulator {
  private readonly artifacts = new Map<
    string,
    { parts: unknown[]; complete: boolean }
  >();
  apply(event: unknown): void {
    if (!event || typeof event !== "object")
      throw new Error("Invalid artifact event");
    const e = event as any,
      artifact = e.artifact;
    if (
      !artifact ||
      typeof artifact.artifactId !== "string" ||
      !artifact.artifactId ||
      artifact.artifactId.length > 128
    )
      throw new Error("Invalid artifact ID");
    validateParts(artifact.parts);
    const previous = this.artifacts.get(artifact.artifactId);
    if (previous?.complete) throw new Error("Artifact is already complete");
    if (e.append && !previous)
      throw new Error("Cannot append before artifact exists");
    const parts = e.append
      ? [...previous!.parts, ...artifact.parts]
      : structuredClone(artifact.parts);
    if (
      Buffer.byteLength(JSON.stringify(parts)) > 256 * 1024 ||
      (this.artifacts.size >= 16 && !previous)
    )
      throw new Error("Artifact limit exceeded");
    this.artifacts.set(artifact.artifactId, {
      parts,
      complete: e.lastChunk === true,
    });
  }
  values() {
    return [...this.artifacts].map(([artifactId, value]) => ({
      artifactId,
      ...structuredClone(value),
    }));
  }
}
