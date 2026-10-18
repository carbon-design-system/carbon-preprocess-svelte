// "Fake IntelliSense" for docs code views: a token-level analysis of a
// Svelte (or JS/TS/CSS) snippet that finds what each token means, using the
// same tokenizer as the build-time highlighter plus Carbon's component API.
// No TypeScript compiler: types come from sveld's COMPONENT_API.json and a
// small initializer inference.
import { tokenize } from "carbon-preprocess-svelte/browser";

const IDENTIFIER_TYPES = new Set([
  null,
  "typeName",
  "function",
  "definition",
  "variableName",
]);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const SVELTE_BLOCKS = {
  if: "Renders its content only while the condition is true. Pair with `{:else}` and `{:else if …}`.",
  each: "Renders its content once per item of an array (or array-like). `{#each items as item, index (item.id)}` keys items by id.",
  await: "Renders pending, resolved, and rejected states of a promise.",
  key: "Destroys and recreates its content whenever the expression changes, replaying intro transitions.",
  html: "Renders an HTML string without escaping. Only for trusted or sanitized content.",
  const: "Declares a constant scoped to the enclosing block.",
  debug:
    "Logs the listed values whenever they change, and pauses when devtools are open.",
  snippet: "Declares a reusable chunk of markup (Svelte 5).",
  render: "Renders a snippet (Svelte 5).",
};
const DIRECTIVES = {
  bind: "Two-way binding: the component updates the variable, and the variable updates the component.",
  on: "Listens for an event. Carbon components forward native events and dispatch their own with a `detail`.",
  use: "Runs an action: a function called with the element when it mounts.",
  class: "Toggles a class when the expression is truthy.",
  style: "Sets one style property from an expression.",
  transition: "Plays a transition when the element enters and leaves.",
  in: "Plays a transition when the element enters.",
  out: "Plays a transition when the element leaves.",
  animate: "Animates the element when a keyed each block reorders.",
  let: "Receives a slot prop from the component.",
};
const SVELTE_ELEMENTS = {
  "svelte:fragment": "Fills a named slot without adding a wrapper element.",
  "svelte:head": "Inserts elements into `document.head`.",
  "svelte:window": "Listens to window events and binds window properties.",
  "svelte:element": "Renders an element whose tag is chosen at runtime.",
  "svelte:component": "Renders a component chosen at runtime.",
  "svelte:options": "Sets compiler options for this component.",
};
const ICON_SOURCE = /^["']carbon-icons-svelte(?:\/lib\/[\w]+\.svelte)?["']$/;

/** The most similar name within a small edit distance, for "did you mean". */
function closest(name, candidates) {
  const distance = (a, b) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const current = row[j];
        row[j] = Math.min(
          row[j] + 1,
          row[j - 1] + 1,
          previous +
            (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1),
        );
        previous = current;
      }
    }
    return row[b.length];
  };
  let best;
  for (const candidate of candidates) {
    const d = distance(name, candidate);
    if (d <= Math.max(2, Math.floor(name.length / 3)) && (!best || d < best.d))
      best = { name: candidate, d };
  }
  // A shared suffix ("titleText" ~ "labelText") is a hint even past the threshold.
  return (
    best?.name ??
    candidates.find(
      (c) => c.length > 4 && name.endsWith(c.slice(-4)) && c !== name,
    )
  );
}

/** Tokens with offsets and line numbers. */
function positioned(code, lang) {
  const tokens = tokenize(code, lang) ?? [{ type: null, text: code }];
  let offset = 0;
  let line = 1;
  return tokens.map((token, index) => {
    const start = offset;
    offset += token.text.length;
    const result = { ...token, index, start, end: offset, line };
    line += token.text.split("\n").length - 1;
    return result;
  });
}

const significant = (t) => t.type !== null || t.text.trim() !== "";

/** A literal-ish initializer's TypeScript type, or `undefined`. */
export function inferType(initializer) {
  const text = initializer.trim().replace(/;$/, "");
  if (!text) return undefined;
  if (/^-?\d/.test(text)) return "number";
  if (/^["'`]/.test(text)) return "string";
  if (text === "true" || text === "false") return "boolean";
  if (text === "null") return "null";
  if (text === "undefined") return "undefined";
  if (/^new\s+([A-Z][\w$]*)/.test(text))
    return /^new\s+([A-Z][\w$]*)/.exec(text)[1];
  if (
    /^(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/.test(text) ||
    /^function\b/.test(text)
  ) {
    const params =
      /^(?:async\s*)?\(([^)]*)\)/.exec(text)?.[1] ??
      /^([\w$]+)\s*=>/.exec(text)?.[1] ??
      "";
    return `(${params
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `${p.split("=")[0].trim()}: any`)
      .join(", ")}) => ${/^async/.test(text) ? "Promise<void>" : "void"}`;
  }
  if (text.startsWith("[")) {
    if (/^\[\s*\]$/.test(text)) return "never[]";
    const first = text.slice(1).trim();
    const element = first.startsWith("{")
      ? objectType(first)
      : inferType(first.split(/,(?![^[{]*[\]}])/)[0]);
    return element
      ? `${element.includes(" | ") ? `(${element})` : element}[]`
      : "unknown[]";
  }
  if (text.startsWith("{")) return objectType(text);
  if (/^Array\.from\b/.test(text)) return "unknown[]";
  return undefined;
}

/** `{ id: "a", text: "A" }` -> `{ id: string; text: string }` (top level only). */
function objectType(text) {
  const tokens = positioned(text, "js");
  const fields = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if ("{[(".includes(t.text) && t.type !== "string") depth++;
    else if ("}])".includes(t.text) && t.type !== "string") {
      depth--;
      if (depth === 0) break;
    }
    if (depth !== 1 || !IDENTIFIER.test(t.text)) continue;
    const next = tokens.slice(i + 1).find(significant);
    if (next?.text !== ":") continue;
    // The value runs to the next `,` or `}` at this depth.
    let value = "";
    let d = 0;
    for (const v of tokens.slice(tokens.indexOf(next) + 1)) {
      if ("{[(".includes(v.text) && v.type !== "string") d++;
      if ("}])".includes(v.text) && v.type !== "string") {
        if (d === 0) break;
        d--;
      }
      if (d === 0 && v.text === ",") break;
      value += v.text;
    }
    fields.push(`${t.text}: ${inferType(value) ?? "unknown"}`);
  }
  return fields.length ? `{ ${fields.join("; ")} }` : "{}";
}

const EVENT_TYPES = [
  [/^(click|dblclick|mouse\w*|contextmenu)$/, "MouseEvent"],
  [/^key\w*$/, "KeyboardEvent"],
  [/^(focus|blur|focusin|focusout)$/, "FocusEvent"],
  [/^(pointer\w*)$/, "PointerEvent"],
  [/^(wheel)$/, "WheelEvent"],
  [/^(input|change|submit|reset)$/, "Event"],
];

export const oneLine = (type) =>
  (type ?? "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/;\s*}/g, " }")
    .trim();

/** The handler parameter type for an event on a Carbon component. */
export function eventType(event, component) {
  if (!event) return "Event";
  const clean = (type) =>
    oneLine(resolveGenerics(type, component)).replace(/<any>/g, "");
  if (event.kind === "dispatched")
    return `CustomEvent<${event.detail ? clean(event.detail) : "null"}>`;
  // Forwarded from a child component (`ListBoxSelection`), it's still that
  // component's CustomEvent; only an element's event is a native one.
  const fromComponent = /^[A-Z]/.test(event.element ?? "");
  if (event.detail)
    return /Event\b/.test(event.detail) && !fromComponent
      ? clean(event.detail)
      : `CustomEvent<${clean(event.detail)}>`;
  return (
    EVENT_TYPES.find(([pattern]) => pattern.test(event.name))?.[1] ?? "Event"
  );
}

/** Replace a component's generic parameters with their defaults: `Item` -> `ComboBoxItem<any>`. */
export function resolveGenerics(type, component) {
  if (!type || !component?.generics) return type;
  const [param, constraint] = component.generics;
  const fallback = /=\s*(.+)$/.exec(constraint)?.[1]?.trim() ?? "any";
  return type.replace(new RegExp(`\\b${param}\\b`, "g"), fallback);
}

/**
 * Analyze a snippet. Returns its tokens and, per token index, what a hover
 * card shows; plus groups of related tokens (a symbol's occurrences, a tag's
 * pair) for highlighting together.
 */
export function analyze(code, lang, api) {
  const tokens = positioned(code, lang);
  const info = new Map();
  const related = new Map(); // token index -> token indices to highlight with it
  const symbols = new Map(); // name -> { kind, line, initializer, type, source, imported, refs: [] }
  const usages = []; // { symbol, component, prop, kind: "prop"|"bind"|"event", paramIndex }
  const markup = lang === "svelte" || lang === "html";

  // Regions: script contents, style contents, markup.
  const region = new Array(tokens.length).fill(
    markup ? "markup" : lang === "css" ? "style" : "script",
  );
  if (markup) {
    let mode = "markup";
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (
        t.type === "angleBracket" &&
        t.text === "</" &&
        /^(script|style)$/i.test(tokens[i + 1]?.text ?? "")
      )
        mode = "markup";
      region[i] = mode;
      if (t.type === "angleBracket" && t.text === ">" && mode === "markup") {
        // `<script …>` or `<style …>` opens a region.
        let j = i - 1;
        while (
          j >= 0 &&
          !(
            tokens[j].type === "angleBracket" &&
            (tokens[j].text === "<" || tokens[j].text === "</")
          )
        )
          j--;
        if (
          tokens[j]?.text === "<" &&
          /^(script|style)$/i.test(tokens[j + 1]?.text ?? "")
        ) {
          mode =
            tokens[j + 1].text.toLowerCase() === "script" ? "script" : "style";
        }
      }
    }
  }

  // Script declarations and imports.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (region[i] !== "script") continue;
    if (t.type === "moduleKeyword" && t.text === "import") {
      // import … from "source";
      let j = i + 1;
      const names = [];
      let pendingImported = null;
      while (
        j < tokens.length &&
        !(tokens[j].type === "moduleKeyword" && tokens[j].text === "from") &&
        tokens[j].text !== ";"
      ) {
        const n = tokens[j];
        if (n.type === "keyword" && n.text === "as") {
          pendingImported = names.pop();
        } else if (
          IDENTIFIER_TYPES.has(n.type) &&
          IDENTIFIER.test(n.text) &&
          n.text !== "type"
        ) {
          names.push({
            local: n.text,
            imported: pendingImported?.local ?? n.text,
            token: n.index,
          });
          pendingImported = null;
        }
        j++;
      }
      const source = tokens.slice(j).find((n) => n.type === "string")?.text;
      for (const name of names) {
        symbols.set(name.local, {
          kind: "import",
          line: t.line,
          source,
          imported: name.imported,
          decl: name.token,
          refs: [],
        });
      }
      continue;
    }
    if (t.type === "definition") {
      const keyword = tokens.slice(0, i).reverse().find(significant);
      const kind = keyword?.text ?? "let";
      // Initializer: after `=`, to `;` or a line end at depth 0.
      const rest = tokens.slice(i + 1);
      const eq = rest.find(significant);
      let initializer = "";
      if (eq?.text === "=") {
        let depth = 0;
        for (const n of rest.slice(rest.indexOf(eq) + 1)) {
          if ("{[(".includes(n.text) && n.type !== "string") depth++;
          if ("}])".includes(n.text) && n.type !== "string") depth--;
          if (
            depth <= 0 &&
            (n.text === ";" ||
              (n.type === null &&
                n.text.includes("\n") &&
                depth === 0 &&
                initializer.trim()))
          )
            break;
          initializer += n.text;
        }
      }
      if (kind === "function") {
        const params = [];
        for (const n of rest) {
          if (n.text === ")") break;
          if (IDENTIFIER.test(n.text) && n.type !== "punctuation")
            params.push(n);
        }
        symbols.set(t.text, {
          kind,
          line: t.line,
          type: `(${params.map((p) => `${p.text}: any`).join(", ")}) => void`,
          decl: i,
          refs: [],
          params,
        });
      } else {
        symbols.set(t.text, {
          kind,
          line: t.line,
          initializer: initializer.trim(),
          type: inferType(initializer),
          decl: i,
          refs: [],
        });
      }
    }
  }

  // References to declared names, anywhere outside strings and comments.
  for (const t of tokens) {
    if (!IDENTIFIER_TYPES.has(t.type) || !IDENTIFIER.test(t.text)) continue;
    const symbol = symbols.get(t.text);
    if (!symbol) continue;
    const previous = tokens.slice(0, t.index).reverse().find(significant);
    if (previous?.text === "." || previous?.text === "?.") continue;
    symbol.refs.push(t.index);
  }
  for (const [name, symbol] of symbols) {
    const group = [...new Set([symbol.decl, ...symbol.refs])];
    for (const index of group) {
      related.set(index, group);
      info.set(index, { kind: "symbol", name, symbol });
    }
  }

  // Markup: tags, attributes, directives, blocks.
  if (markup) {
    const stack = [];
    const blockStack = [];
    let tag = null;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (region[i] !== "markup") continue;
      if (t.type === "angleBracket" && (t.text === "<" || t.text === "</")) {
        const nameToken = tokens[i + 1];
        if (nameToken?.type !== "tagName") continue;
        const local = nameToken.text;
        const imported = symbols.get(local)?.imported ?? local;
        const component = /^[A-Z]/.test(local) ? api?.[imported] : undefined;
        tag = {
          name: local,
          imported,
          component,
          nameIndex: nameToken.index,
          closing: t.text === "</",
        };
        if (component)
          info.set(nameToken.index, {
            kind: "component",
            name: imported,
            component,
          });
        else if (SVELTE_ELEMENTS[local])
          info.set(nameToken.index, {
            kind: "svelte",
            title: `<${local}>`,
            text: SVELTE_ELEMENTS[local],
          });
        else if (
          symbols.get(local)?.kind === "import" &&
          ICON_SOURCE.test(symbols.get(local).source ?? "")
        ) {
          info.set(nameToken.index, {
            kind: "icon",
            name: imported,
            symbol: symbols.get(local),
          });
        }
        if (tag.closing) {
          const open = stack.findLastIndex((s) => s.name === local);
          if (open >= 0) {
            const pair = [stack[open].nameIndex, nameToken.index];
            for (const index of pair) related.set(index, pair);
            stack.length = open;
          }
        }
        continue;
      }
      if (t.type === "angleBracket" && (t.text === ">" || t.text === "/>")) {
        if (tag && !tag.closing && t.text === ">") stack.push(tag);
        tag = null;
        continue;
      }
      if (tag && t.type === "attributeName") {
        const [prefix, rawName] = t.text.includes(":")
          ? t.text.split(":")
          : [null, t.text];
        const name = rawName.split("|")[0];
        const next = tokens.slice(i + 1).find(significant);
        const value =
          next?.text === "="
            ? tokens.slice(tokens.indexOf(next) + 1).find(significant)
            : undefined;
        const component = tag.component;
        if (prefix === "on" && component) {
          const event = component.events.find((e) => e.name === name);
          info.set(i, { kind: "event", name, event, component: tag.imported });
          // `on:select={(e) => …}` or `on:select={handler}`: note the parameter for TS.
          if (value?.text === "{") {
            const inner = tokens.slice(value.index + 1).filter(significant);
            if (
              inner[0]?.text === "(" &&
              IDENTIFIER.test(inner[1]?.text ?? "") &&
              inner[2]?.text === ")"
            ) {
              usages.push({
                kind: "event",
                component: tag.imported,
                prop: name,
                paramIndex: inner[1].index,
                event,
              });
            } else if (
              IDENTIFIER.test(inner[0]?.text ?? "") &&
              inner[1]?.text === "}"
            ) {
              usages.push({
                kind: "event",
                component: tag.imported,
                prop: name,
                symbol: inner[0].text,
                event,
              });
            }
          }
        } else if (prefix && DIRECTIVES[prefix]) {
          const prop =
            prefix === "bind" && component
              ? component.props.find((p) => p.name === name)
              : undefined;
          info.set(
            i,
            prop
              ? {
                  kind: "prop",
                  prop,
                  component: tag.imported,
                  directive: prefix,
                }
              : { kind: "directive", prefix, name, text: DIRECTIVES[prefix] },
          );
          if (prefix === "bind" && component) {
            const target =
              value?.text === "{"
                ? tokens.slice(value.index + 1).filter(significant)[0]?.text
                : name;
            usages.push({
              kind: "bind",
              component: tag.imported,
              prop: name,
              symbol: target,
              propInfo: prop,
            });
          }
        } else if (component) {
          const prop = component.props.find((p) => p.name === name);
          if (prop) {
            const literal =
              value?.type === "attributeValue"
                ? value.text.replace(/^["']|["']$/g, "")
                : undefined;
            info.set(i, {
              kind: "prop",
              prop,
              component: tag.imported,
              literal,
            });
            if (value?.text === "{") {
              const inner = tokens.slice(value.index + 1).filter(significant);
              if (
                IDENTIFIER.test(inner[0]?.text ?? "") &&
                inner[1]?.text === "}"
              ) {
                usages.push({
                  kind: "prop",
                  component: tag.imported,
                  prop: name,
                  symbol: inner[0].text,
                  propInfo: prop,
                });
              }
            }
          } else if (name === "slot") {
            info.set(i, {
              kind: "svelte",
              title: "slot",
              text: "Puts this element in the parent component's named slot.",
            });
          } else if (!prefix) {
            // Not in the API: it's passed to the rendered element ($$restProps),
            // which may be a typo for a real prop.
            info.set(i, {
              kind: "unknownProp",
              name,
              component: tag.imported,
              rest: component.rest,
              suggestion: closest(
                name,
                component.props.map((p) => p.name),
              ),
            });
          }
        }
        continue;
      }
      // `{x}` shorthand attribute on a component: prop `x`.
      if (tag?.component && t.type === "brace" && t.text === "{") {
        // Not an attribute's value (`bind:this={ref}`): only a lone `{x}`.
        let before = i - 1;
        while (before >= 0 && !significant(tokens[before])) before--;
        const isValue = tokens[before]?.text === "=";
        const inner = isValue ? [] : tokens.slice(i + 1).filter(significant);
        if (IDENTIFIER.test(inner[0]?.text ?? "") && inner[1]?.text === "}") {
          const prop = tag.component.props.find(
            (p) => p.name === inner[0].text,
          );
          if (prop)
            usages.push({
              kind: "prop",
              component: tag.imported,
              prop: prop.name,
              symbol: inner[0].text,
              propInfo: prop,
            });
        }
      }
      if (t.type === "controlKeyword" && /^[#:/@]/.test(t.text)) {
        const keyword = t.text.slice(1);
        if (SVELTE_BLOCKS[keyword])
          info.set(i, {
            kind: "svelte",
            title: `{${t.text} …}`,
            text: SVELTE_BLOCKS[keyword],
          });
        if (t.text[0] === "#") blockStack.push({ keyword, indices: [i] });
        else if (t.text[0] === ":") blockStack.at(-1)?.indices.push(i);
        else if (t.text[0] === "/") {
          const open = blockStack.findLastIndex((b) => b.keyword === keyword);
          if (open >= 0) {
            const group = [...blockStack[open].indices, i];
            for (const index of group) related.set(index, group);
            blockStack.length = open;
          }
        }
      }
    }
  }

  // CSS: Carbon custom properties and color literals.
  for (const t of tokens) {
    if (region[t.index] !== "style" && lang !== "css") continue;
    if (t.type === "variableName" && t.text.startsWith("--"))
      info.set(t.index, { kind: "cssVar", name: t.text });
    if (t.type === "color") info.set(t.index, { kind: "color", value: t.text });
  }

  // Attach where each symbol is used on a component (for hover cards and TS).
  for (const usage of usages) {
    const symbol = usage.symbol && symbols.get(usage.symbol);
    if (!symbol) continue;
    if (!symbol.usedBy) symbol.usedBy = [];
    symbol.usedBy.push(usage);
  }

  // Event handler parameters get the event's type: `function handle(event)`
  // used as `on:select={handle}`, or an inline `(e) => …`.
  const paramSymbol = (paramToken, usage, scopeEnd) => {
    const type = eventType(usage.event, api?.[usage.component]);
    const refs = [];
    for (const t of tokens.slice(paramToken.index + 1, scopeEnd)) {
      const previous = tokens.slice(0, t.index).reverse().find(significant);
      if (
        t.text === paramToken.text &&
        IDENTIFIER_TYPES.has(t.type) &&
        previous?.text !== "." &&
        previous?.text !== "?."
      )
        refs.push(t.index);
    }
    const symbol = {
      kind: "param",
      line: paramToken.line,
      type,
      decl: paramToken.index,
      refs,
      usedBy: [{ ...usage, kind: "event" }],
    };
    const group = [paramToken.index, ...refs];
    for (const index of group) {
      info.set(index, { kind: "symbol", name: paramToken.text, symbol });
      related.set(index, group);
    }
  };
  for (const usage of usages) {
    if (usage.kind !== "event") continue;
    if (usage.paramIndex !== undefined) {
      // Inline arrow: the parameter's scope is the rest of the expression.
      const close = tokens
        .slice(usage.paramIndex)
        .find((t) => t.type === "brace" && t.text === "}");
      paramSymbol(
        tokens[usage.paramIndex],
        usage,
        close?.index ?? tokens.length,
      );
    } else {
      const handler = symbols.get(usage.symbol);
      const param = handler?.params?.[0];
      if (param) {
        // The function body: from the parameter to the matching `}`.
        let depth = 0;
        let end = tokens.length;
        for (const t of tokens.slice(param.index)) {
          if (t.type === "brace" && t.text === "{") depth++;
          if (t.type === "brace" && t.text === "}" && --depth === 0) {
            end = t.index;
            break;
          }
        }
        paramSymbol(param, usage, end);
      }
    }
  }

  return { tokens, info, related, symbols, usages, region };
}
