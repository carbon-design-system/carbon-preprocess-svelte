const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const KEY_VALUE = /^([A-Za-z_$][\w$-]*)[ \t]*:(?:[ \t]+(.*))?$/;
const LIST_ITEM = /^[ \t]+-[ \t]+(.*)$/;
const INDENTED = /^[ \t]+\S/;
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const COMMENT = /[ \t]+#.*$/;
const NEWLINE = /\r?\n/;

/** The frontmatter block at the top of `source`, if any. */
export function splitFrontmatter(source: string): {
  yaml: string | undefined;
  body: string;
} {
  const match = FRONTMATTER.exec(source);
  return match
    ? { yaml: match[1], body: source.slice(match[0].length) }
    : { yaml: undefined, body: source };
}

function scalar(value: string): unknown {
  const text = value.trim();
  if (text === "") return null;
  if (text.startsWith('"')) return JSON.parse(text);
  if (text.startsWith("'")) return text.slice(1, -1).replaceAll("''", "'");
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      // A flow sequence of plain scalars: [a, b, "c"].
      if (text.startsWith("[")) {
        return text
          .slice(1, -1)
          .split(",")
          .filter((item) => item.trim() !== "")
          .map(scalar);
      }
      return text;
    }
  }
  const plain = text.replace(COMMENT, "");
  if (plain === "true") return true;
  if (plain === "false") return false;
  if (plain === "null" || plain === "~") return null;
  if (NUMBER.test(plain)) return Number(plain);
  return plain;
}

/**
 * Parse the YAML subset frontmatter uses: top-level `key: value` pairs with
 * plain, quoted, or JSON-style flow values, `- item` lists, and `|`/`>`
 * block scalars. Pass `frontmatter` to the preprocessor for full YAML.
 */
export function parseFrontmatter(yaml: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const lines = yaml.split(NEWLINE);
  for (let i = 0; i < lines.length; i++) {
    const match = KEY_VALUE.exec(lines[i]);
    if (!match) continue;
    const [, key, value = ""] = match;
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "|" || trimmed === ">") {
      const block: string[] = [];
      while (i + 1 < lines.length && INDENTED.test(lines[i + 1])) {
        block.push(lines[++i]);
      }
      const items = block.map((line) => LIST_ITEM.exec(line));
      if (trimmed === "" && block.length > 0 && items.every(Boolean)) {
        data[key] = items.map((item) => scalar(item?.[1] ?? ""));
      } else if (block.length > 0) {
        const text = block.map((line) => line.trim());
        data[key] = trimmed === ">" ? text.join(" ") : text.join("\n");
      } else {
        data[key] = null;
      }
    } else {
      data[key] = scalar(value);
    }
  }
  return data;
}
