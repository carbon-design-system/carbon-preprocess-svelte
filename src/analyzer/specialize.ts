import { type AST, isReference, SKIP, walk } from "sveast/walk";
import { parse } from "../indexer/parser";
import { childEntries, type Node } from "./ast";
import { bindEach, evaluate, isPropsObject, type Scope } from "./evaluate";
import {
  concat,
  type MappedText,
  removeMatches,
  type Splice,
  sliceOf,
  splice,
} from "./mapped-text";
import {
  isEmptyArray,
  isNeverNullish,
  isNullish,
  isObject,
  isStructured,
  type Truth,
  truthOf,
  UNKNOWN,
  type Value,
} from "./values";

/**
 * Rewrites a Carbon component's source for the values its call sites pass
 * (see `.context/source-rewriting-reference.md`): expressions with one
 * known value become literals, operands and branches that can't run are
 * removed, and `{#if}` chains keep only their live branches. Child
 * components only dead branches render lose their last use, so the bundler
 * drops them.
 *
 * Every decision comes from the same evaluator as the CSS analysis, so the
 * two agree. Edits replace exact node ranges of the original text; nothing
 * is re-printed from the AST.
 */
export type Specialization = {
  code: string;
  /** `code`, with where each part of it came from (for a source map). */
  mapped: MappedText;
  /** Edits applied (nested edits inside a removed range aren't counted). */
  edits: number;
  /** Declarations removed because nothing read them after the edits. */
  dropped: number;
  /**
   * `.svelte` imports nothing renders anymore, so the bundler drops them.
   * Computed on the first call: it parses the rewritten code again, and
   * only `report` needs it.
   */
  unrendered: () => string[];
};

type Rewrite = (start: number, end: number) => MappedText;

type Edit = {
  start: number;
  end: number;
  print: (rewrite: Rewrite) => MappedText | string;
};

/** TypeScript nodes that hold a value; every other `TS*` node is a type. */
const TS_VALUE_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

/** Expression nodes worth trying to fold (literals already are). */
const FOLDABLE = new Set([
  "Identifier",
  "MemberExpression",
  "ChainExpression",
  "LogicalExpression",
  "ConditionalExpression",
  "UnaryExpression",
  "BinaryExpression",
  "TemplateLiteral",
  "CallExpression",
  ...TS_VALUE_WRAPPERS,
]);

/** Parents whose `field` child is written to or declared, not read. */
function isWritePosition(parent: Node | null, field: string): boolean {
  if (!parent) return false;
  switch (parent.type) {
    case "AssignmentExpression":
    case "ForInStatement":
    case "ForOfStatement":
      return field === "left";
    case "UpdateExpression":
      return field === "argument";
    case "VariableDeclarator":
      return field === "id";
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return field === "params" || field === "id";
    case "CatchClause":
      return field === "param";
    case "ObjectPattern":
    case "ArrayPattern":
    case "RestElement":
    case "AssignmentPattern":
      return true;
    case "UnaryExpression":
      return parent.operator === "delete";
    // Calls need their callee, member reads their object (`this`), and a
    // tagged template its tag.
    case "CallExpression":
    case "NewExpression":
      return field === "callee";
    case "MemberExpression":
      return field === "object";
    case "TaggedTemplateExpression":
      return field === "tag" || field === "quasi";
    case "SnippetBlock":
    case "EachBlock":
    case "AwaitBlock":
      return field !== "expression";
    case "LabeledStatement":
      return field === "label";
    case "ImportSpecifier":
    case "ExportSpecifier":
      return true;
    default:
      return false;
  }
}

const MAX_SAFE_LITERAL = Number.MAX_SAFE_INTEGER;

/** Source text for a single known value, or `null` if it has none. */
function literalText(value: Value): string | null {
  if (value === UNKNOWN || value.size !== 1) return null;
  const [p] = value;
  if (isObject(p)) return null;
  if (p === undefined) return "void 0";
  if (typeof p === "number") {
    if (
      !Number.isFinite(p) ||
      Object.is(p, -0) ||
      Math.abs(p) > MAX_SAFE_LITERAL
    ) {
      return null;
    }
    return p < 0 ? `(${p})` : String(p);
  }
  return JSON.stringify(p);
}

/**
 * Whether evaluating `node` can't have side effects, so removing it is
 * safe. Calls and member reads are impure (getters), except the few the
 * evaluator models: `Boolean`, `String`, `getContext`, `$$slots.x`, and
 * `undefined?.x`.
 */
function isPure(node: Node, scope: Scope): boolean {
  switch (node.type) {
    case "Literal":
    case "Identifier":
    case "ThisExpression":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return true;
    case "TemplateLiteral":
      return node.expressions.every((e) => isPure(e as Node, scope));
    case "UnaryExpression":
      return node.operator !== "delete" && isPure(node.argument, scope);
    case "BinaryExpression":
    case "LogicalExpression":
      return isPure(node.left as Node, scope) && isPure(node.right, scope);
    case "ConditionalExpression":
      return (
        isPure(node.test, scope) &&
        isPure(node.consequent, scope) &&
        isPure(node.alternate, scope)
      );
    case "ChainExpression":
      return isPure(node.expression, scope);
    case "MemberExpression": {
      if (node.object.type === "Identifier" && node.object.name === "$$slots") {
        return !node.computed;
      }
      // Svelte's prop objects are plain: reading one runs no getter.
      if (
        node.object.type === "Identifier" &&
        isPropsObject(node.object.name, scope) &&
        (!node.computed || node.property.type === "Literal")
      ) {
        return true;
      }
      const target = evaluate(node.object, scope);
      // A known object's own properties and a string's `length` run no
      // getter.
      if (
        target !== UNKNOWN &&
        target.size > 0 &&
        (!node.computed || node.property.type === "Literal") &&
        [...target].every(
          (p) =>
            isStructured(p) ||
            (typeof p === "string" &&
              !node.computed &&
              node.property.type === "Identifier" &&
              node.property.name === "length"),
        )
      ) {
        return isPure(node.object, scope);
      }
      return (
        target !== UNKNOWN &&
        target.size > 0 &&
        [...target].every(isNullish) &&
        node.optional === true &&
        isPure(node.object, scope)
      );
    }
    case "CallExpression":
      return (
        node.callee.type === "Identifier" &&
        ["Boolean", "String", "getContext"].includes(node.callee.name) &&
        !scope.model.unknownNames.has(node.callee.name) &&
        node.arguments.every(
          (a) => a.type !== "SpreadElement" && isPure(a as Node, scope),
        )
      );
    case "ArrayExpression":
      return node.elements.every(
        (e) => !e || (e.type !== "SpreadElement" && isPure(e as Node, scope)),
      );
    case "ObjectExpression":
      return node.properties.every(
        (p) =>
          p.type === "Property" &&
          !p.computed &&
          p.kind === "init" &&
          isPure(p.value as Node, scope),
      );
    default:
      return TS_VALUE_WRAPPERS.has(node.type)
        ? isPure((node as { expression: Node }).expression, scope)
        : false;
  }
}

type Span = { start: number; end: number };

/** Every node the walk edits has offsets; `Fragment` is the one that doesn't. */
function span(node: Node): Span {
  return node as unknown as Span;
}

/** HTML whitespace Svelte trims at a fragment's edges (not NBSP). */
const EDGE_WHITESPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g;
const LEADING_COMMENTS = /^(?:<!--[\s\S]*?-->[ \t\r\n]*)+/;
const TRAILING_COMMENTS = /(?:[ \t\r\n]*<!--[\s\S]*?-->)+$/;
const COMMENT_GAPS = /(?<=-->)[ \t\r\n]+/g;
const GAPS_BEFORE_COMMENT = /[ \t\r\n]+(?=<!--)/g;
const ENDS_WITH_WHITESPACE = /[ \t\r\n]$/;
const STARTS_WITH_WHITESPACE = /^[ \t\r\n]/;
const ONLY_WHITESPACE = /^[ \t\r\n]*$/;
/** Elements whose text whitespace is significant. */
const PRESERVE_WHITESPACE = new Set(["pre", "textarea"]);

export type SpecializeOptions = {
  /**
   * What replaces an `{#if}` block that renders nothing when whitespace
   * sits on both sides of it: removing it would merge the two, and Svelte
   * collapses them to one space instead of two (or trims them at a
   * fragment's start). Elsewhere the block is removed outright.
   * @default "{#if false}<!---->{/if}"
   * (not empty: Svelte 3/4 warn about an empty block; not text: Svelte 5
   * rejects text in elements like `<colgroup>`)
   */
  emptyBlock?: string;
  /**
   * Remove top-level declarations nothing reads after the edits.
   * @default true
   */
  dropUnused?: boolean;
  /**
   * Replace an `{#if}` whose only live branch is known with that branch's
   * content. Off, the branch keeps an `{#if true}` around it: a little more
   * code, but block boundaries (and so rendered whitespace) stay as they
   * were. Only Svelte 5 renders unwrapped branches identically; Svelte 3/4
   * trim whitespace inside elements differently once the block is gone. It
   * saves under a point of minified JS.
   * @default false
   */
  unwrap?: boolean;
  /** Debugging: apply only the top-level edits this accepts (by index). */
  editFilter?: (index: number, edit: { start: number; end: number }) => boolean;
};

export function specializeComponent(
  scope: Scope,
  options?: SpecializeOptions,
): Specialization {
  const { code, ast } = scope.model;
  const emptyBlock = options?.emptyBlock ?? "{#if false}<!---->{/if}";
  const unwrap = options?.unwrap ?? false;
  const edits: Edit[] = [];
  let preserveDepth = 0;

  const replace = (node: Node, text: string) => {
    const { start, end } = span(node);
    edits.push({ start, end, print: () => text });
  };

  const valueAt = (node: Node) => evaluate(node as never, scope);

  /** Fold `node` to a literal if it's in a read position with one known, pure value. */
  function tryFold(node: Node, parent: Node | null, field: string): boolean {
    if (!FOLDABLE.has(node.type) || isWritePosition(parent, field)) {
      return false;
    }
    if (
      node.type === "Identifier" &&
      (node.name === "undefined" || !isReference(node, parent))
    ) {
      return false;
    }
    const text = literalText(valueAt(node));
    if (text === null || !isPure(node, scope)) return false;
    replace(node, text);
    return true;
  }

  function truthIfPure(test: Node): Truth {
    return isPure(test, scope) ? truthOf(valueAt(test)) : "either";
  }

  function visitChildren(node: Node): void {
    for (const [field, child] of childEntries(node)) visit(child, node, field);
  }

  function visit(node: Node, parent: Node | null, field: string): void {
    if (node.type.startsWith("TS") && !TS_VALUE_WRAPPERS.has(node.type)) return;

    switch (node.type) {
      // Bindings and patterns: nothing in them is a plain read.
      case "ImportDeclaration":
      case "BindDirective":
      case "LetDirective":
      case "ObjectPattern":
      case "ArrayPattern":
      case "RestElement":
      case "AssignmentPattern":
        return;

      // Folding the expression of `e;` could turn it into a directive
      // prologue (`"use strict";`); only fold inside it.
      case "ExpressionStatement":
        visitChildren(node.expression as Node);
        return;

      case "LogicalExpression": {
        if (tryFold(node, parent, field)) return;
        const left = valueAt(node.left);
        const truth = truthOf(left);
        const rightIsDead =
          (node.operator === "&&" && truth === "falsy") ||
          (node.operator === "||" && truth === "truthy") ||
          (node.operator === "??" && isNeverNullish(left));
        const leftIsSkipped =
          isPure(node.left, scope) &&
          ((node.operator === "&&" && truth === "truthy") ||
            (node.operator === "||" && truth === "falsy") ||
            (node.operator === "??" &&
              left !== UNKNOWN &&
              left.size > 0 &&
              [...left].every(isNullish)));
        if (rightIsDead) {
          // Never evaluated: its value can't matter.
          replace(node.right, "void 0");
          visit(node.left, node, "left");
        } else if (leftIsSkipped) {
          const { right } = node;
          edits.push({
            start: node.start,
            end: node.end,
            print: (rewrite) =>
              concat("(", rewrite(right.start, right.end), ")"),
          });
          visit(right, node, "right");
        } else {
          visitChildren(node);
        }
        return;
      }

      case "ConditionalExpression": {
        if (tryFold(node, parent, field)) return;
        const truth = truthOf(valueAt(node.test));
        if (truth === "either") break;
        const live = truth === "truthy" ? node.consequent : node.alternate;
        if (isPure(node.test, scope)) {
          edits.push({
            start: node.start,
            end: node.end,
            print: (rewrite) => concat("(", rewrite(live.start, live.end), ")"),
          });
        } else {
          replace(
            truth === "truthy" ? node.alternate : node.consequent,
            "void 0",
          );
          visit(node.test, node, "test");
        }
        visit(live, node, truth === "truthy" ? "consequent" : "alternate");
        return;
      }

      case "IfStatement": {
        const truth = truthIfPure(node.test);
        if (truth === "either") break;
        const live = truth === "truthy" ? node.consequent : node.alternate;
        edits.push({
          start: node.start,
          end: node.end,
          print: (rewrite) => (live ? rewrite(live.start, live.end) : ";"),
        });
        if (live)
          visit(live, node, truth === "truthy" ? "consequent" : "alternate");
        return;
      }

      case "IfBlock":
        visitIfChain(node, parent);
        return;

      case "EachBlock": {
        // Over an array known to stay empty: only `{:else}` renders.
        if (
          !isPure(node.expression, scope) ||
          !isEmptyArray(valueAt(node.expression))
        ) {
          // The body sees the item's value: an element of a known array.
          visit(node.expression as Node, node, "expression");
          const unbind = bindEach(node, scope);
          try {
            if (node.key) visit(node.key as Node, node, "key");
            visit(node.body as Node, node, "body");
          } finally {
            unbind();
          }
          if (node.fallback) visit(node.fallback as Node, node, "fallback");
          return;
        }
        const placeholder = placeholderFor(node, parent);
        const trim = preserveDepth === 0;
        const fallback = node.fallback ?? null;
        if (fallback) visit(fallback, node, "fallback");
        edits.push({
          start: node.start,
          end: node.end,
          print: (rewrite) => printOnly(rewrite, fallback, placeholder, trim),
        });
        return;
      }

      case "ClassDirective": {
        const truth = truthIfPure(node.expression);
        if (truth === "falsy") {
          replace(node, "");
          return;
        }
        if (truth === "truthy" && node.expression.type !== "Literal") {
          replace(node, `class:${node.name}={true}`);
          return;
        }
        break;
      }

      case "Attribute": {
        // `{kind}` shorthand: the attribute is written as just the
        // expression. Expand it while folding, or leave it alone.
        const { value } = node;
        if (
          value !== true &&
          !Array.isArray(value) &&
          code[node.start] === "{" &&
          value.expression.type === "Identifier"
        ) {
          const text = literalText(valueAt(value.expression));
          if (text !== null) replace(node, `${node.name}={${text}}`);
          return;
        }
        break;
      }

      case "Property": {
        // `{ kind }` shorthand in an object literal: expand while folding.
        if (
          parent?.type === "ObjectExpression" &&
          node.shorthand &&
          node.value.type === "Identifier"
        ) {
          const text = literalText(valueAt(node.value));
          if (text !== null) {
            replace(node, `${node.value.name}: ${text}`);
            return;
          }
        }
        break;
      }

      case "RegularElement":
        if (PRESERVE_WHITESPACE.has(node.name)) {
          preserveDepth++;
          visitChildren(node);
          preserveDepth--;
          return;
        }
        break;

      default:
        if (tryFold(node, parent, field)) return;
    }

    visitChildren(node);
  }

  type Fragment = Extract<Node, { type: "Fragment" }>;

  /**
   * What replaces a block that renders nothing: removing it would merge
   * the whitespace on both sides, so between whitespace (or inside
   * `<pre>`) it leaves `emptyBlock`.
   */
  function placeholderFor(block: Node, parent: Node | null): string {
    const siblings = parent?.type === "Fragment" ? parent.nodes : [];
    const index = siblings.indexOf(block as never);
    const before = siblings[index - 1];
    const after = siblings[index + 1];
    // At a fragment's start, Svelte trims leading whitespace; a block there
    // keeps the whitespace after it from being trimmed.
    const whitespaceBefore =
      index === 0 ||
      (before?.type === "Text" && ENDS_WITH_WHITESPACE.test(before.data)) ||
      (index === 1 &&
        before?.type === "Text" &&
        ONLY_WHITESPACE.test(before.data));
    const whitespaceAfter =
      index === siblings.length - 1 ||
      (after?.type === "Text" && STARTS_WITH_WHITESPACE.test(after.data));
    return preserveDepth > 0 || (whitespaceBefore && whitespaceAfter)
      ? emptyBlock
      : "";
  }

  function fragmentText(rewrite: Rewrite, fragment: Fragment | null) {
    return fragment && fragment.nodes.length > 0
      ? rewrite(fragment.nodes[0].start, fragment.nodes.at(-1)?.end ?? 0)
      : concat();
  }

  /**
   * A block that only ever renders `fragment`: its content, kept in a
   * block unless `unwrap`, or `placeholder` if it renders nothing.
   * `trim` is whether whitespace at the block's edges is insignificant.
   */
  function printOnly(
    rewrite: Rewrite,
    fragment: Fragment | null,
    placeholder: string,
    trim: boolean,
  ): MappedText | string {
    const content = fragmentText(rewrite, fragment);
    if (content.text.replace(EDGE_WHITESPACE, "") === "") {
      return placeholder;
    }
    // Keep a block around the live branch unless `unwrap` (Svelte 5
    // only): block boundaries decide how Svelte 3/4 trim whitespace
    // inside the elements a branch holds. `{@const}` and `{#snippet}`
    // are scoped to their branch, so they always keep one.
    if (
      !unwrap ||
      fragment?.nodes.some(
        (child) => child.type === "ConstTag" || child.type === "SnippetBlock",
      )
    ) {
      return concat("{#if true}", content, "{/if}");
    }
    // Unwrap: the block's own edges were trimmed; the whitespace
    // around it stays where it was. Svelte 5 trims through comments at
    // the edges (like `svelte-ignore`) inside the block, so the
    // whitespace between them goes too.
    if (!trim) return content;
    let trimmed = removeMatches(content, EDGE_WHITESPACE);
    const leading = LEADING_COMMENTS.exec(trimmed.text);
    if (leading) {
      trimmed = removeMatches(trimmed, COMMENT_GAPS, 0, leading[0].length);
    }
    const trailing = TRAILING_COMMENTS.exec(trimmed.text);
    if (trailing) {
      trimmed = removeMatches(trimmed, GAPS_BEFORE_COMMENT, trailing.index);
    }
    return trimmed;
  }

  /** Rebuilds an `{#if}…{:else if}…{:else}…{/if}` chain from its live branches. */
  function visitIfChain(
    block: Extract<Node, { type: "IfBlock" }>,
    parent: Node | null,
  ): void {
    const placeholder = placeholderFor(block, parent);

    type Branch = { test: Node; body: Extract<Node, { type: "Fragment" }> };
    const branches: Branch[] = [];
    let elseBody: Extract<Node, { type: "Fragment" }> | null = null;
    for (let current = block; ; ) {
      branches.push({ test: current.test, body: current.consequent });
      const alternate = current.alternate;
      const next =
        alternate?.nodes.length === 1 ? alternate.nodes[0] : undefined;
      if (next?.type === "IfBlock" && next.elseif) {
        current = next;
        continue;
      }
      elseBody = alternate;
      break;
    }

    const kept: Branch[] = [];
    let changed = false;
    for (const branch of branches) {
      const truth = truthIfPure(branch.test);
      if (truth === "falsy") {
        changed = true;
        continue;
      }
      if (truth === "truthy") {
        changed = changed || branch !== branches.at(-1) || elseBody !== null;
        elseBody = branch.body;
        break;
      }
      kept.push(branch);
    }

    for (const branch of kept) {
      visit(branch.test, block, "test");
      visit(branch.body, block, "consequent");
    }
    if (elseBody) visit(elseBody, block, "alternate");
    if (!(changed || kept.length === 0)) return;

    const trim = preserveDepth === 0;
    const finalElse = elseBody;

    edits.push({
      start: block.start,
      end: block.end,
      print: (rewrite) => {
        if (kept.length === 0) {
          return printOnly(rewrite, finalElse, placeholder, trim);
        }
        const parts: Array<MappedText | string> = [];
        for (const [i, branch] of kept.entries()) {
          const test = span(branch.test);
          parts.push(
            `{${i === 0 ? "#if" : ":else if"} `,
            rewrite(test.start, test.end),
            "}",
            fragmentText(rewrite, branch.body),
          );
        }
        if (finalElse && finalElse.nodes.length > 0) {
          parts.push("{:else}", fragmentText(rewrite, finalElse));
        }
        return concat(...parts, "{/if}");
      },
    });
  }

  for (const [field, node] of [
    ["module", ast.module],
    ["instance", ast.instance],
    ["fragment", ast.fragment],
  ] as const) {
    if (node) visit(node as Node, null, field);
  }

  // Outermost edit wins; an edit's printer rewrites what's inside it.
  const sorted = [...edits]
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((edit, i) => options?.editFilter?.(i, edit) ?? true);
  let applied = 0;
  const rewrite: Rewrite = (start, end) => {
    const parts: Array<MappedText | string> = [];
    let cursor = start;
    for (const edit of sorted) {
      if (edit.start < cursor || edit.end > end || edit.start >= end) continue;
      parts.push(sliceOf(code, cursor, edit.start), edit.print(rewrite));
      cursor = edit.end;
      applied++;
    }
    parts.push(sliceOf(code, cursor, end));
    return concat(...parts);
  };

  const folded = rewrite(0, code.length);
  const { mapped: cleaned, dropped } =
    options?.dropUnused === false
      ? { mapped: folded, dropped: 0 }
      : dropUnused(folded);
  const mapped = applied > 0 ? silenceUnusedProps(cleaned) : cleaned;
  let unrendered: string[] | undefined;
  return {
    code: mapped.text,
    mapped,
    edits: applied,
    dropped,
    unrendered: () => {
      unrendered ??= applied > 0 ? unrenderedImports(mapped.text) : [];
      return unrendered;
    },
  };
}

/** Sources of `.svelte` imports whose bindings `code` no longer uses. */
function unrenderedImports(code: string): string[] {
  const ast = parse(code, { comments: false });
  const imports = new Map<string, string[]>();
  for (const script of [ast.module, ast.instance]) {
    for (const statement of (script?.content.body ?? []) as Node[]) {
      if (
        statement.type === "ImportDeclaration" &&
        typeof statement.source.value === "string" &&
        statement.source.value.endsWith(".svelte")
      ) {
        imports.set(
          statement.source.value,
          statement.specifiers.map((specifier) => specifier.local.name),
        );
      }
    }
  }
  if (imports.size === 0) return [];

  const used = new Set<string>();
  walk(ast, {
    enter(node, parent) {
      if (node.type === "ImportDeclaration") return SKIP;
      if (node.type === "Component") used.add(node.name.split(".")[0]);
      if (node.type === "Identifier" && isReference(node, parent)) {
        used.add(node.name);
      }
    },
  });
  return [...imports]
    .filter(([, locals]) => !locals.some((local) => used.has(local)))
    .map(([source]) => source);
}

/** Whether `node` can be removed without losing a side effect (no scope facts). */
function hasNoSideEffects(node: Node | null | undefined): boolean {
  if (!node) return true;
  switch (node.type) {
    case "Literal":
    case "Identifier":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return true;
    case "TemplateLiteral":
      return node.expressions.every((e) => hasNoSideEffects(e as Node));
    case "UnaryExpression":
      return node.operator !== "delete" && hasNoSideEffects(node.argument);
    case "BinaryExpression":
    case "LogicalExpression":
      return (
        hasNoSideEffects(node.left as Node) && hasNoSideEffects(node.right)
      );
    case "ConditionalExpression":
      return (
        hasNoSideEffects(node.test) &&
        hasNoSideEffects(node.consequent) &&
        hasNoSideEffects(node.alternate)
      );
    case "ArrayExpression":
      return node.elements.every(
        (e) =>
          !e || (e.type !== "SpreadElement" && hasNoSideEffects(e as Node)),
      );
    case "ObjectExpression":
      return node.properties.every(
        (p) =>
          p.type === "Property" &&
          !p.computed &&
          p.kind === "init" &&
          hasNoSideEffects(p.value as Node),
      );
    default:
      return TS_VALUE_WRAPPERS.has(node.type)
        ? hasNoSideEffects((node as { expression: Node }).expression)
        : false;
  }
}

const MAX_CLEANUP_PASSES = 8;

/**
 * Removes top-level `$: x = …`, `const x = …` and `let x = …` (not props)
 * that nothing reads once branches are gone, when their right-hand side has
 * no side effects. Svelte compiles `$:` into effects a minifier must keep,
 * so this is the only way they go. Repeats until nothing more is removed.
 */
/**
 * How often each name is read anywhere in the component, not counting the
 * `owned` identifier nodes (the names being declared).
 */
function countReads(
  ast: AST.Root,
  owned: ReadonlySet<Node>,
  /** Count `export { a }` as a read of `a` (it keeps `a` declared). */
  exportsRead = true,
): Map<string, number> {
  const reads = new Map<string, number>();
  const count = (name: string) => reads.set(name, (reads.get(name) ?? 0) + 1);
  walk(ast, {
    enter(node, parent, key) {
      if (
        node.type === "Identifier" &&
        !owned.has(node) &&
        !isDeclaredName(parent, key) &&
        (exportsRead || parent?.type !== "ExportSpecifier") &&
        isReference(node, parent)
      ) {
        count(node.name);
        // `$store` reads `store`.
        if (node.name.startsWith("$") && !node.name.startsWith("$$")) {
          count(node.name.slice(1));
        }
      }
      // `class:x` and `{x}` shorthands, `bind:x`, `let:x`: names without
      // an Identifier of their own in some shapes.
      if (
        node.type === "ClassDirective" ||
        node.type === "BindDirective" ||
        node.type === "LetDirective" ||
        node.type === "StyleDirective"
      ) {
        count(node.name);
      }
    },
  });
  return reads;
}

/** Whether the child at `key` of `parent` declares a name rather than reading it. */
function isDeclaredName(parent: Node | null, key: string | null): boolean {
  switch (parent?.type) {
    case "VariableDeclarator":
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      return key === "id";
    default:
      return false;
  }
}

const IGNORE_UNUSED_PROP =
  "// svelte-ignore unused-export-let export_let_unused\n  ";

/**
 * Marks props nothing reads anymore with `svelte-ignore`, so Svelte (3–5)
 * doesn't warn that they're unused. They stay declared: a prop the
 * component stops declaring would land in `$$restProps`.
 */
function silenceUnusedProps(input: MappedText): MappedText {
  const ast = parse(input.text, { comments: false });
  const statements = (ast.instance?.content.body ?? []) as Node[];
  // `export let a`, and `let a; export { a as b }`.
  const exported = statements.flatMap((statement) => {
    if (statement.type !== "ExportNamedDeclaration" || statement.source) {
      return [];
    }
    const { declaration, specifiers } = statement;
    if (
      declaration?.type === "VariableDeclaration" &&
      declaration.kind === "let"
    ) {
      return [
        { statement, names: declaration.declarations.map((d) => d.id as Node) },
      ];
    }
    return declaration
      ? []
      : [
          {
            statement,
            names: specifiers.map((specifier) => specifier.local as Node),
          },
        ];
  });
  const reads = countReads(ast, new Set(), false);
  // Svelte 5 reports `let a; export { a as b }` at the `let`, Svelte 3/4
  // at the export: mark both.
  const declaredAt = new Map<string, number>();
  for (const statement of statements) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declarator of statement.declarations) {
      if (declarator.id.type === "Identifier") {
        declaredAt.set(declarator.id.name, statement.start);
      }
    }
  }
  const marks = new Set<number>();
  for (const { statement, names } of exported) {
    for (const name of names) {
      if (name.type !== "Identifier" || reads.has(name.name)) continue;
      marks.add((statement as unknown as Span).start);
      const declaration = declaredAt.get(name.name);
      if (declaration !== undefined) marks.add(declaration);
    }
  }
  return splice(
    input,
    [...marks]
      .sort((a, b) => a - b)
      .map((start) => ({ start, end: start, text: IGNORE_UNUSED_PROP })),
  );
}

export function dropUnusedDeclarations(source: string): {
  code: string;
  dropped: number;
} {
  const { mapped, dropped } = dropUnused(sliceOf(source, 0, source.length));
  return { code: mapped.text, dropped };
}

function dropUnused(input: MappedText): {
  mapped: MappedText;
  dropped: number;
} {
  let mapped = input;
  let dropped = 0;
  for (let pass = 0; pass < MAX_CLEANUP_PASSES; pass++) {
    const ast = parse(mapped.text, { comments: false });
    const script = ast.instance?.content;
    if (!script) break;

    type Candidate = {
      name: string;
      start: number;
      end: number;
      own: Set<Node>;
    };
    // Assigning a prop can update a parent's `bind:`, and assigning
    // `$store` sets the store: never "unused".
    const props = new Set<string>();
    for (const statement of script.body as Node[]) {
      if (statement.type !== "ExportNamedDeclaration") continue;
      if (statement.declaration?.type === "VariableDeclaration") {
        for (const declarator of statement.declaration.declarations) {
          if (declarator.id.type === "Identifier")
            props.add(declarator.id.name);
        }
      }
      for (const specifier of statement.specifiers) {
        if (specifier.local.type === "Identifier") {
          props.add(specifier.local.name);
        }
      }
    }
    const removable = (name: string) =>
      !props.has(name) && !(name.startsWith("$") && !name.startsWith("$$"));

    const candidates: Candidate[] = [];
    for (const statement of script.body as Node[]) {
      if (
        statement.type === "LabeledStatement" &&
        statement.label.name === "$" &&
        statement.body.type === "ExpressionStatement" &&
        statement.body.expression.type === "AssignmentExpression" &&
        statement.body.expression.operator === "=" &&
        statement.body.expression.left.type === "Identifier" &&
        removable(statement.body.expression.left.name) &&
        hasNoSideEffects(statement.body.expression.right)
      ) {
        const { left } = statement.body.expression;
        candidates.push({
          name: left.name,
          start: statement.start,
          end: statement.end,
          own: new Set([left as Node, statement.label as Node]),
        });
      }
      if (
        statement.type === "VariableDeclaration" &&
        statement.declarations.length === 1 &&
        statement.declarations[0].id.type === "Identifier" &&
        removable(statement.declarations[0].id.name) &&
        hasNoSideEffects(statement.declarations[0].init as Node | null)
      ) {
        const { id } = statement.declarations[0];
        if (id.type === "Identifier") {
          candidates.push({
            name: id.name,
            start: statement.start,
            end: statement.end,
            own: new Set([id as Node]),
          });
        }
      }
    }
    if (candidates.length === 0) break;

    const reads = countReads(
      ast,
      new Set(candidates.flatMap((c) => [...c.own])),
    );

    // Count a declaration's own reads (`$: x = x + 1`) as reads too: only
    // `owned` nodes (the declared names) are excluded above.
    const unused = candidates.filter((c) => !reads.has(c.name));
    if (unused.length === 0) break;
    const removals: Splice[] = unused
      .map(({ start, end }) => ({ start, end }))
      .sort((a, b) => a.start - b.start);
    mapped = splice(mapped, removals);
    dropped += removals.length;
  }
  return { mapped, dropped };
}
