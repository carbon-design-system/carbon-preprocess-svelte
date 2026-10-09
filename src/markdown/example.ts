/**
 * The standalone source of a live example: its markup, plus exactly the
 * imports and declarations from the page's `<script>` that it uses,
 * followed to whatever those declarations use in turn.
 *
 * A live example compiles inside its page, so every name it uses is
 * declared in the page's script (or is a global). Reading the page's real
 * imports, rather than guessing which capitalized names are icons, gives
 * the code view what a reader needs to copy and run it.
 */
import { type Token, tokenize } from "./highlight";
import { skipExpression } from "./scan";

interface Statement {
  text: string;
  declares: string[];
  references: Set<string>;
  /** For an import: its specifiers, so unused ones can be dropped. */
  imports?: {
    source: string;
    typeOnly: boolean;
    specifiers: {
      kind: "default" | "named" | "namespace";
      imported: string;
      local: string;
    }[];
  };
}

const SCRIPT_CONTENT = /^<script\b[^>]*>([\s\S]*?)<\/script>\s*$/;
const IMPORT = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+(["'][^"']+["'])\s*;?$/;
const NAMED = /\{([\s\S]*)\}/;
const NAMESPACE = /\*\s+as\s+([\w$]+)/;
const DEFAULT_IMPORT = /^([\w$]+)/;
const SPECIFIER = /^(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?$/;
const BLOCK_KEYWORD = /^[#:/@][a-z]+/;
const COMPONENT = /<([A-Z][\w$]*)/g;
const DIRECTIVE = /\b(use|transition|in|out|animate):([\w$]+)/g;
const SHORTHAND = /\b(bind|class):([\w$]+)(?!\s*=)/g;
const COMMENT = /<!--[\s\S]*?-->/g;
const LEADING_INDENT = /^[ \t]*/;
const LINE_START = /^/gm;
const IDENTIFIER_TYPES = new Set<Token["type"]>([
  null,
  "typeName",
  "function",
  "definition",
  "variableName",
]);
const CONTINUES_AFTER = new Set([",", ".", "?.", "(", "[", "{", "=>"]);
const CONTINUES_BEFORE = new Set([
  ".",
  "?.",
  "=>",
  ")",
  "]",
  "}",
  "from",
  "else",
  "catch",
  "finally",
  "as",
]);
const IDENTIFIER_TEXT = /^[A-Za-z_$][\w$]*$/;

const significant = (token: Token) =>
  token.type !== null || token.text.trim() !== "";

/** Split a script into top-level statements, by `;` or a line break that ends one. */
function splitStatements(code: string): Token[][] {
  const tokens = tokenize(code, "js") ?? [];
  const statements: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  const end = () => {
    if (current.some(significant)) statements.push(current);
    current = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (
      token.type === "brace" ||
      token.type === "paren" ||
      token.type === "bracket"
    ) {
      depth += "{([".includes(token.text) ? 1 : -1;
    }
    if (depth === 0 && token.text === ";") {
      current.push(token);
      end();
      continue;
    }
    if (depth === 0 && token.type === null && token.text.includes("\n")) {
      const previous = current.filter(significant).at(-1);
      const next = tokens.slice(i + 1).find(significant);
      const continues =
        !previous ||
        !next ||
        CONTINUES_AFTER.has(previous.text) ||
        CONTINUES_BEFORE.has(next.text) ||
        (previous.type === "operator" &&
          previous.text !== "++" &&
          previous.text !== "--") ||
        (next.type === "operator" &&
          next.text !== "!" &&
          next.text !== "++" &&
          next.text !== "--");
      if (!continues) {
        end();
        continue;
      }
    }
    current.push(token);
  }
  end();
  return statements;
}

/** Names bound by a `let`/`const`/`var` declaration list, including destructuring. */
function boundNames(tokens: Token[]): string[] {
  const names: string[] = [];
  let depth = 0;
  let inInitializer = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!significant(token)) continue;
    if ("{([".includes(token.text) && token.type !== "string") depth++;
    else if ("})]".includes(token.text) && token.type !== "string") depth--;
    if (depth === 0 && token.text === "=") inInitializer = true;
    else if (depth === 0 && token.text === ",") inInitializer = false;
    if (
      inInitializer ||
      !IDENTIFIER_TYPES.has(token.type) ||
      !IDENTIFIER_TEXT.test(token.text)
    ) {
      continue;
    }
    const next = tokens.slice(i + 1).find(significant);
    // `{ key: binding }` binds `binding`, not `key`; `= default` isn't a binding.
    if (next?.text === ":" && depth > 0) continue;
    names.push(token.text);
  }
  return names;
}

/** Identifiers a run of script tokens refers to (not properties or object keys). */
function referencesOf(tokens: Token[]): Set<string> {
  const references = new Set<string>();
  const meaningful = tokens.filter(significant);
  for (let i = 0; i < meaningful.length; i++) {
    const token = meaningful[i];
    if (!IDENTIFIER_TYPES.has(token.type) || !IDENTIFIER_TEXT.test(token.text))
      continue;
    const previous = meaningful[i - 1];
    const next = meaningful[i + 1];
    if (previous?.text === "." || previous?.text === "?.") continue;
    if (
      next?.text === ":" &&
      (previous?.text === "{" || previous?.text === ",")
    )
      continue;
    references.add(token.text);
  }
  return references;
}

function parseStatement(tokens: Token[]): Statement {
  const text = tokens
    .map((token) => token.text)
    .join("")
    .trim();
  const meaningful = tokens.filter(significant);
  const statement: Statement = {
    text,
    declares: [],
    references: referencesOf(tokens),
  };

  const imported = IMPORT.exec(text);
  if (imported) {
    const [, typeOnly, clause, source] = imported;
    const specifiers: NonNullable<Statement["imports"]>["specifiers"] = [];
    const named = NAMED.exec(clause);
    for (const part of named?.[1].split(",") ?? []) {
      const match = SPECIFIER.exec(part.trim());
      if (match)
        specifiers.push({
          kind: "named",
          imported: match[1],
          local: match[2] ?? match[1],
        });
    }
    const rest = clause.replace(NAMED, "").trim();
    const namespace = NAMESPACE.exec(rest);
    if (namespace)
      specifiers.push({
        kind: "namespace",
        imported: "*",
        local: namespace[1],
      });
    const defaultName = DEFAULT_IMPORT.exec(rest);
    if (defaultName && !rest.startsWith("*")) {
      specifiers.push({
        kind: "default",
        imported: "default",
        local: defaultName[1],
      });
    }
    statement.imports = { source, typeOnly: Boolean(typeOnly), specifiers };
    statement.declares = specifiers.map((s) => s.local);
    statement.references = new Set();
    return statement;
  }

  let start = 0;
  if (meaningful[0]?.text === "export") start = 1;
  const keyword = meaningful[start];
  if (
    keyword?.text === "let" ||
    keyword?.text === "const" ||
    keyword?.text === "var"
  ) {
    const at = tokens.indexOf(keyword);
    statement.declares = boundNames(tokens.slice(at + 1));
  } else if (
    keyword?.text === "function" ||
    keyword?.text === "class" ||
    keyword?.text === "async"
  ) {
    const name = meaningful
      .slice(start + 1)
      .find((t) => t.type === "definition" || t.type === "function");
    if (name) statement.declares = [name.text];
  } else if (meaningful[0]?.text === "$" && meaningful[1]?.text === ":") {
    // `$: total = a + b` declares `total` (Svelte 4 reactive declaration).
    if (
      meaningful[3]?.text === "=" &&
      IDENTIFIER_TEXT.test(meaningful[2]?.text ?? "")
    ) {
      statement.declares = [meaningful[2].text];
    }
  }
  for (const name of statement.declares) statement.references.delete(name);
  statement.references.delete("$");
  return statement;
}

/** Names an example's markup uses: components, directives, and expressions. */
function markupReferences(markup: string): Set<string> {
  const source = markup.replace(COMMENT, "");
  const references = new Set<string>();
  for (const [, name] of source.matchAll(COMPONENT)) references.add(name);
  for (const [, , name] of source.matchAll(DIRECTIVE)) references.add(name);
  for (const [, , name] of source.matchAll(SHORTHAND)) references.add(name);
  for (let i = source.indexOf("{"); i >= 0; i = source.indexOf("{", i)) {
    const end = skipExpression(source, i);
    if (end < 0) break;
    const inner = source.slice(i + 1, end - 1).replace(BLOCK_KEYWORD, "");
    for (const name of referencesOf(tokenize(inner, "js") ?? []))
      references.add(name);
    i = end;
  }
  return references;
}

function dedent(text: string): string {
  const lines = text.split("\n");
  const indents = lines
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => LEADING_INDENT.exec(l)?.[0].length ?? 0);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines
    .map((line, i) =>
      i === 0
        ? line
        : line.slice(Math.min(min, LEADING_INDENT.exec(line)?.[0].length ?? 0)),
    )
    .join("\n");
}

/**
 * The example's standalone source: a `<script>` with the page-script
 * imports and declarations it needs (unused import specifiers dropped),
 * then the markup. Without a page script, or when the example needs none
 * of it, the markup alone.
 */
export function exampleSource(
  markup: string,
  pageScript: string | undefined,
): string {
  const body = pageScript
    ? SCRIPT_CONTENT.exec(pageScript.trim())?.[1]
    : undefined;
  if (!body) return markup;
  const statements = splitStatements(body).map(parseStatement);
  const byName = new Map<string, Statement>();
  for (const statement of statements) {
    for (const name of statement.declares) byName.set(name, statement);
  }

  // Everything the markup uses, then what those declarations use, to a fixpoint.
  const needed = new Set<string>();
  const queue = [...markupReferences(markup)];
  while (queue.length > 0) {
    const name = queue.pop() as string;
    const statement = byName.get(name);
    if (!statement || needed.has(name)) continue;
    needed.add(name);
    for (const declared of statement.declares) {
      if (!statement.imports) needed.add(declared);
    }
    queue.push(...statement.references);
  }
  if (needed.size === 0) return markup;

  const lines: string[] = [];
  let afterImports = false;
  for (const statement of statements) {
    if (!statement.declares.some((name) => needed.has(name))) continue;
    const imports = statement.imports;
    if (!imports) {
      // A blank line between the imports and the declarations.
      if (!afterImports && lines.length > 0) lines.push("");
      afterImports = true;
      lines.push(dedent(statement.text));
      continue;
    }
    const used = imports.specifiers.filter((s) => needed.has(s.local));
    const named = used.filter((s) => s.kind === "named");
    const parts = [
      ...used.filter((s) => s.kind === "default").map((s) => s.local),
      ...used
        .filter((s) => s.kind === "namespace")
        .map((s) => `* as ${s.local}`),
      ...(named.length > 0
        ? [
            `{ ${named.map((s) => (s.imported === s.local ? s.local : `${s.imported} as ${s.local}`)).join(", ")} }`,
          ]
        : []),
    ];
    lines.push(
      `import ${imports.typeOnly ? "type " : ""}${parts.join(", ")} from ${imports.source};`,
    );
  }
  const indented = lines
    .map((line) => (line ? line.replace(LINE_START, "  ") : line))
    .join("\n");
  return `<script>\n${indented}\n</script>\n\n${markup}`;
}
