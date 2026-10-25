// Typed views of a Svelte example, in two idioms:
//
// - "ts": `<script lang="ts">`, `import type`, annotations on declarations
//   and parameters, `ComponentEvents<…>["select"]` for named handlers.
// - "jsdoc": plain JS with JSDoc: `@typedef` imports, `@type` above
//   declarations, `@param`/`@returns` above functions. Checked by
//   TypeScript with `checkJs`, no build step.
//
// Both annotate only where inference can't help: variables bound to or
// passed into Carbon props, functions passed as callback props, and event
// handlers. Types come from the component API (sveld), with generic
// parameters replaced by their defaults.
import { analyze, eventType, oneLine, resolveGenerics } from "./analyze.js";

/**
 * A type with the component's generics resolved, `<any>` dropped, and type
 * arguments that equal a typedef's default dropped too:
 * `DataTableHeader<DataTableRow>` is `DataTableHeader`. (A JSDoc `@typedef`
 * alias isn't generic, so it can't take them.)
 */
function clean(type, component) {
  let out = oneLine(resolveGenerics(type, component)).replace(/<any>/g, "");
  for (const typedef of component?.typedefs ?? []) {
    const match = /^(\w+)<\w+\s*=\s*(.+)>$/.exec(typedef.name);
    if (!match) continue;
    out = out.replaceAll(`${match[1]}<${match[2].trim()}>`, match[1]);
  }
  return out;
}

/** `ReadonlyArray<ComboBoxItem>` -> `ComboBoxItem[]`, for a variable. */
function variableType(propType, component) {
  const type = clean(propType, component);
  const readonlyArray = /^ReadonlyArray<(.+)>$/.exec(type);
  return readonlyArray ? `${readonlyArray[1]}[]` : type;
}

/** Split at top-level commas: `a: X<B, C>, d: E` -> two parts. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const c of text) {
    if ("<({[".includes(c)) depth++;
    if (">)}]".includes(c)) depth--;
    if (c === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** `(item: Item, value: string) => boolean` -> params and return type. */
function functionType(type) {
  const match = /^\((.*)\)\s*=>\s*(.+)$/s.exec(type.trim());
  if (!match) return undefined;
  const params = splitTopLevel(match[1]).map((p) => {
    const [, name, optional, paramType] =
      /^([\w$]+)(\??)\s*:\s*(.+)$/s.exec(p) ?? [];
    return {
      name,
      type: paramType ? `${paramType}${optional ? " | undefined" : ""}` : "any",
    };
  });
  return { params, returns: match[2].trim() };
}

/** Is `type` a long `CustomEvent<{ … }>` that reads better by name? */
const isDispatchedDetail = (event) => event?.kind === "dispatched";

/**
 * Typed view of a JS Svelte example. `style` is "ts" or "jsdoc". Returns
 * the code unchanged when it has no `<script>`.
 */
export function toTyped(code, api, style = "ts") {
  if (!/<script(\s[^>]*)?>/.test(code)) return code;
  const ts = style === "ts";
  const { tokens, symbols, usages } = analyze(code, "svelte", api);
  const inserts = []; // [offset, text], applied from the end
  const typedefs = new Map(); // name -> module
  let usesComponentEvents = false;

  const noteTypedefs = (type, componentName) => {
    const component = api[componentName];
    for (const typedef of component?.typedefs ?? []) {
      const name = typedef.name.replace(/<.*$/, "");
      if (new RegExp(`\\b${name}\\b`).test(type)) {
        typedefs.set(name, `carbon-components-svelte/${component.path}`);
      }
    }
  };

  /** The keyword token that starts the declaration of `symbol` (let/const/function). */
  const declarationStart = (symbol) => {
    let i = symbol.decl - 1;
    while (
      i > 0 &&
      !["definitionKeyword", "moduleKeyword"].includes(tokens[i].type)
    )
      i--;
    if (tokens[i - 2]?.text === "export") i -= 2;
    return tokens[i];
  };
  /** Insert a JSDoc comment on its own line above a declaration. */
  const jsdocAbove = (symbol, lines) => {
    const start = declarationStart(symbol);
    const lineStart = code.lastIndexOf("\n", start.start) + 1;
    const indent = code.slice(lineStart, start.start);
    const block =
      lines.length === 1
        ? `${indent}/** ${lines[0]} */\n`
        : `${indent}/**\n${lines.map((l) => `${indent} * ${l}\n`).join("")}${indent} */\n`;
    inserts.push([lineStart, block]);
  };
  const handlerType = (usage, componentLocal) => {
    if (isDispatchedDetail(usage.event)) {
      usesComponentEvents = true;
      return ts
        ? `ComponentEvents<${componentLocal}>["${usage.prop}"]`
        : `import("svelte").ComponentEvents<${componentLocal}>["${usage.prop}"]`;
    }
    return eventType(usage.event, api[usage.component]);
  };
  /** The local name a component was imported as (for `ComponentEvents<…>`). */
  const localName = (imported) =>
    [...symbols].find(
      ([, s]) => s.kind === "import" && s.imported === imported,
    )?.[0] ?? imported;

  // `<script>` -> `<script lang="ts">`
  const scriptTag = tokens.find(
    (t, i) =>
      t.type === "tagName" &&
      t.text === "script" &&
      tokens[i - 1]?.text === "<",
  );
  if (
    ts &&
    scriptTag &&
    !/lang=/.test(code.slice(scriptTag.end, code.indexOf(">", scriptTag.end)))
  ) {
    inserts.push([scriptTag.end, ' lang="ts"']);
  }

  for (const [name, symbol] of symbols) {
    if (symbol.kind === "import" || symbol.kind === "param") continue;

    if (symbol.kind === "function") {
      const params = symbol.params ?? [];
      // A callback prop: `shouldFilterItem={filterRegions}`.
      const callback = symbol.usedBy?.find(
        (u) =>
          u.propInfo && functionType(clean(u.propInfo.type, api[u.component])),
      );
      // An event handler: `on:select={handleSelect}`.
      const handler = symbol.usedBy?.find((u) => u.kind === "event");
      let paramTypes = [];
      let returns;
      if (callback) {
        const fn = functionType(
          clean(callback.propInfo.type, api[callback.component]),
        );
        paramTypes = params.map((_, i) => fn.params[i]?.type ?? "any");
        returns = fn.returns;
        noteTypedefs(
          `${fn.params.map((p) => p.type).join(" ")} ${fn.returns}`,
          callback.component,
        );
      } else if (handler && params[0]) {
        const type = handlerType(handler, localName(handler.component));
        paramTypes = [type, ...params.slice(1).map(() => "any")];
        noteTypedefs(type, handler.component);
      } else {
        continue;
      }
      if (ts) {
        for (const [i, p] of params.entries())
          inserts.push([p.end, `: ${paramTypes[i]}`]);
        if (returns && returns !== "void") {
          const close = tokens
            .slice(params.at(-1)?.index ?? symbol.decl)
            .find((t) => t.text === ")");
          if (close) inserts.push([close.end, `: ${returns}`]);
        }
      } else {
        jsdocAbove(symbol, [
          ...params.map((p, i) => `@param {${paramTypes[i]}} ${p.text}`),
          ...(returns && returns !== "void" ? [`@returns {${returns}}`] : []),
        ]);
      }
      continue;
    }

    const usage = symbol.usedBy?.find((u) => u.propInfo);
    if (!usage) continue;
    const type = variableType(usage.propInfo.type, api[usage.component]);
    const inferred = symbol.type;
    // Inference falls short with no initializer, `undefined`/`null`, an
    // empty array, or object/array literals passed to typed props.
    const needs =
      !symbol.initializer ||
      inferred === "undefined" ||
      inferred === "null" ||
      inferred === "never[]" ||
      /^[[{]/.test(symbol.initializer);
    if (!needs || type === "any" || functionType(type)) continue;
    const optional =
      !symbol.initializer && !/undefined/.test(type) ? " | undefined" : "";
    noteTypedefs(type, usage.component);
    if (ts) inserts.push([tokens[symbol.decl].end, `: ${type}${optional}`]);
    else jsdocAbove(symbol, [`@type {${type}${optional}}`]);
    void name;
  }

  // Inline handlers: `on:clear={(e) => …}` gets a type in TS. (JSDoc can't
  // annotate an inline arrow's parameter without a cast, so JS leaves it.)
  if (ts) {
    for (const usage of usages) {
      if (usage.kind !== "event" || usage.paramIndex === undefined) continue;
      const type = handlerType(usage, localName(usage.component));
      inserts.push([tokens[usage.paramIndex].end, `: ${type}`]);
      noteTypedefs(type, usage.component);
    }
  }

  // Type imports (TS) or typedefs (JSDoc) after the script's last import,
  // or right after the opening tag when it has none.
  if (scriptTag && (typedefs.size > 0 || usesComponentEvents)) {
    const lastImport = [...symbols.values()]
      .filter((s) => s.kind === "import")
      .reduce((max, s) => Math.max(max, s.decl), -1);
    // The end of the last import statement, past a multi-line `{ … }` list.
    const statementEnd =
      lastImport >= 0 ? /from\s*["'][^"']*["'];?/g : undefined;
    if (statementEnd) statementEnd.lastIndex = tokens[lastImport].end;
    const fromAt = statementEnd ? statementEnd.exec(code) : null;
    const importEnd = fromAt
      ? code.indexOf("\n", fromAt.index + fromAt[0].length)
      : -1;
    const close =
      importEnd >= 0 ? importEnd : code.indexOf(">", scriptTag.end) + 1;
    const byModule = new Map();
    for (const [name, from] of typedefs) {
      if (!byModule.has(from)) byModule.set(from, []);
      byModule.get(from).push(name);
    }
    const lines = ts
      ? [
          ...(usesComponentEvents
            ? ['import type { ComponentEvents } from "svelte";']
            : []),
          ...[...byModule].map(
            ([from, names]) =>
              `import type { ${names.join(", ")} } from "${from}";`,
          ),
        ]
      : [...typedefs].map(
          ([name, from]) =>
            `/** @typedef {import("${from}").${name}} ${name} */`,
        );
    if (lines.length)
      inserts.push([close, lines.map((l) => `\n  ${l}`).join("")]);
  }

  let out = code;
  for (const [offset, text] of inserts.sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, offset) + text + out.slice(offset);
  }
  return out;
}

/** The TypeScript view. */
export const toTypeScript = (code, api) => toTyped(code, api, "ts");
/** The JavaScript view, typed with JSDoc. */
export const toJSDoc = (code, api) => toTyped(code, api, "jsdoc");
