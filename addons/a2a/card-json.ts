/** JCS requires unique property names. JSON.parse alone silently loses duplicates. */
export function parseCardJson(text: string): unknown {
  let at = 0;
  const whitespace = () => {
    while ([" ", "\t", "\n", "\r"].includes(text[at] ?? "!")) at++;
  };
  function string(): string {
    const start = at;
    if (text[at++] !== '"') throw new Error("Invalid card JSON string");
    while (at < text.length) {
      const char = text[at++];
      if (char === "\\") {
        at++;
        continue;
      }
      if (char === '"') return JSON.parse(text.slice(start, at));
    }
    throw new Error("Unterminated card JSON string");
  }
  function value(depth: number): void {
    if (depth > 40) throw new Error("Agent Card nesting limit");
    whitespace();
    const start = text[at];
    if (start === '"') {
      string();
      return;
    }
    if (start === "{") {
      at++;
      whitespace();
      if (text[at] === "}") {
        at++;
        return;
      }
      const names = new Set<string>();
      for (;;) {
        whitespace();
        const name = string();
        if (names.has(name)) throw new Error("Duplicate Agent Card JSON key");
        names.add(name);
        whitespace();
        if (text[at++] !== ":") throw new Error("Invalid card JSON");
        value(depth + 1);
        whitespace();
        const end = text[at++];
        if (end === "}") return;
        if (end !== ",") throw new Error("Invalid card JSON");
      }
    }
    if (start === "[") {
      at++;
      whitespace();
      if (text[at] === "]") {
        at++;
        return;
      }
      for (;;) {
        value(depth + 1);
        whitespace();
        const end = text[at++];
        if (end === "]") return;
        if (end !== ",") throw new Error("Invalid card JSON");
      }
    }
    const token =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(at),
      );
    if (!token) throw new Error("Invalid card JSON");
    at += token[0].length;
  }
  value(0);
  whitespace();
  if (at !== text.length) throw new Error("Trailing card JSON");
  return JSON.parse(text);
}
