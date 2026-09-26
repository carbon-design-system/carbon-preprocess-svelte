import {
  extractCarbonClassTokens,
  extractRuntimeClassesFromSource,
  resolveRelativeImport,
} from "./extract-runtime-classes";
import type { SvelteParser } from "./svelte-parser";
import { type ANode, walk } from "./walk";

const WHITESPACE_REGEX = /\s+/;
const GLOBAL_SELECTOR_REGEX = /^:global\((.*)\)$/;
/** The whole quasi before `${prop}` is one class prefix: `bx--btn--`. */
const CLASS_PREFIX_QUASI = /^bx--[\w-]*-$/;

type ExtractSelectorsProps = {
  code: string;
  filename: string;
  parse: SvelteParser;
};

export type ExtractFromSvelteResult = {
  classes: string[];
  components: string[];
  slotWrappers: string[];
  imports: string[];
  runtimeClasses: string[];
  /**
   * Classes named by literals in the module script (`context="module"` or
   * Svelte 5's `module`), minus lookup selectors: what another module can
   * import from this one.
   */
  moduleClasses: string[];
  /**
   * Class prefixes this file only ever completes with one prop's value, as
   * in `` `bx--btn--${kind}` `` with `export let kind = "primary"`. See
   * `ClassVariant`.
   */
  variants: ClassVariant[];
  /**
   * Exact classes this file only renders while a condition on its own props
   * holds, as in `class:bx--tag--filter={filter}`. See `ClassGate`.
   */
  gates: ClassGate[];
};

/** A prop's literal default: a string, a boolean, or `null` for none. */
export type PropDefault = string | boolean | null;

/**
 * `prop === equals`, or just `prop` (truthy) without `equals`. `default`
 * travels with the condition so the optimizer can check it without the
 * component's source.
 */
export type GateCondition = {
  prop: string;
  default: PropDefault;
  equals?: string | boolean;
};

/**
 * A class rendered only when, for at least one entry of `when`, every
 * condition in it holds (`when` is an OR of ANDs: one entry per place the
 * class is rendered). A condition the component can't satisfy without a
 * prop value no caller passes lets the optimizer drop the class.
 */
export type ClassGate = {
  /** Class with its dot: `.bx--tag--filter`. */
  class: string;
  when: GateCondition[][];
};

/**
 * A class prefix that renders as `prefix + value of prop`, where `prop` is
 * exported with a string literal default and never reassigned by the
 * component. Knowing every value callers pass, the optimizer can keep just
 * those variants instead of every class starting with `prefix`.
 */
export type ClassVariant = {
  /** Class prefix with its dot: `.bx--btn--`. */
  prefix: string;
  prop: string;
  default: string;
};

/** Classes a string or template literal node names; `[]` for any other node. */
function literalClasses(
  node: ANode,
  options?: { skipLookups?: boolean },
): string[] {
  if (node.type === "Literal" && typeof node.value === "string") {
    return extractCarbonClassTokens(node.value, options);
  }
  if (node.type === "TemplateElement") {
    return extractCarbonClassTokens(node.value.raw, options);
  }
  return [];
}

function nodeContainsDefaultSlot(node: {
  type?: string;
  name?: string;
  fragment?: { nodes?: unknown[] };
  children?: unknown[];
}): boolean {
  if (
    node.type === "Slot" ||
    node.type === "SlotElement" ||
    (node.type === "Element" && node.name === "slot")
  ) {
    return true;
  }

  const children = node.fragment?.nodes ?? node.children ?? [];

  for (const child of children) {
    if (
      child &&
      typeof child === "object" &&
      nodeContainsDefaultSlot(child as typeof node)
    ) {
      return true;
    }
  }

  return false;
}

export function extractFromSvelte(
  props: ExtractSelectorsProps,
): ExtractFromSvelteResult {
  const { code, filename, parse } = props;
  const moduleKey = filename.replace(/\\/g, "/");
  const ast = parse(code, { filename });
  const selectors = new Set<string>();
  const components = new Set<string>();
  const slotWrappers: string[] = [];
  const imports: string[] = [];
  // Quasis of `` `bx--x--${prop}` `` templates, and the prop each completes.
  const variantQuasis = new Map<ANode, string>();
  // Prefix -> props completing it; `null` once any other literal names it.
  const prefixProps = new Map<string, Set<string> | null>();
  // Class -> the conditions of each place it's rendered; `null` once any
  // place renders it unconditionally (or under a condition not on props).
  const classGates = new Map<string, GateCondition[][] | null>();
  const markUngated = (text: string) => {
    for (const cls of extractCarbonClassTokens(text)) {
      prefixProps.set(cls, null);
      classGates.set(cls, null);
    }
  };
  const markGated = (text: string, conditions: GateCondition[] | null) => {
    if (conditions === null) {
      markUngated(text);
      return;
    }
    for (const cls of extractCarbonClassTokens(text)) {
      prefixProps.set(cls, null);
      const when = classGates.get(cls);
      if (when !== null) classGates.set(cls, [...(when ?? []), conditions]);
    }
  };

  const defaults: Map<string, PropDefault> = ast.instance
    ? exportedDefaults(ast.instance)
    : new Map();
  const rebound = reboundIdentifiers(ast);
  // String literals rendered only when a condition holds, found on the
  // `&&` / `?:` above them before the walk reaches the literal itself.
  const gatedLiterals = new Map<ANode, GateCondition[] | null>();
  const conditionsOf = (test: ANode) => propConditions(test, defaults, rebound);

  // A module script can't see instance props: `kind` there is something else.
  const moduleTemplates = new Set<ANode>();
  if (ast.module) {
    walk(ast.module, {
      enter(node) {
        if (
          node.type === "TemplateLiteral" ||
          node.type === "LogicalExpression" ||
          node.type === "ConditionalExpression"
        ) {
          moduleTemplates.add(node);
        }
      },
    });
  }

  walk(ast, {
    enter(node) {
      if (node.type === "TemplateLiteral" && !moduleTemplates.has(node)) {
        const [head, tail] = node.quasis;
        const [expression] = node.expressions;
        if (
          node.quasis.length === 2 &&
          tail.value.raw === "" &&
          expression.type === "Identifier" &&
          CLASS_PREFIX_QUASI.test(head.value.raw)
        ) {
          variantQuasis.set(head, expression.name);
        }
      }

      if (!moduleTemplates.has(node)) {
        if (
          node.type === "LogicalExpression" &&
          node.operator === "&&" &&
          isStringLiteral(node.right)
        ) {
          gatedLiterals.set(node.right, conditionsOf(node.left));
        } else if (
          node.type === "ConditionalExpression" &&
          isStringLiteral(node.consequent)
        ) {
          gatedLiterals.set(node.consequent, conditionsOf(node.test));
        }
      }

      if (node.type === "TemplateElement") {
        for (const cls of extractCarbonClassTokens(node.value.raw)) {
          const prop = variantQuasis.get(node);
          const props = prefixProps.get(cls);
          if (prop === undefined || props === null) {
            prefixProps.set(cls, null);
          } else {
            prefixProps.set(cls, (props ?? new Set()).add(prop));
          }
        }
      } else if (isStringLiteral(node)) {
        markGated(node.value, gatedLiterals.get(node) ?? null);
      }

      if (node.type === "ImportDeclaration" && node.source?.value) {
        const resolved = resolveRelativeImport(
          moduleKey,
          String(node.source.value),
        );
        if (resolved) {
          imports.push(resolved);
        }
      }

      if (node.type === "InlineComponent") {
        if (node.name === "svelte:component") {
          components.add(node.expression.name);
        } else {
          components.add(node.name);
        }
      }

      if (node.type === "Attribute" && node.name === "class" && node.value) {
        for (const value of node.value) {
          if (value.type !== "Text") continue;
          markUngated(value.data);
          for (const selector of value.data
            .split(WHITESPACE_REGEX)
            .filter(Boolean)) {
            selectors.add(selector);
          }
        }
      }

      if (node.type === "Class") {
        // `class:name` alone is shorthand for `class:name={name}`.
        markGated(
          node.name,
          conditionsOf(
            node.expression ?? { type: "Identifier", name: node.name },
          ),
        );
        selectors.add(node.name);
      }

      if (node.type === "PseudoClassSelector" && node.name === "global") {
        const selector = code.slice(node.start, node.end);
        const cleanSelector = selector.replace(GLOBAL_SELECTOR_REGEX, "$1");
        markUngated(cleanSelector);
        selectors.add(cleanSelector);
      }

      // A string may hold several classes (`"bx--a bx--b"`), a selector
      // (`".bx--a .bx--b"`), or markup, so add each class it names.
      for (const cls of literalClasses(node)) {
        selectors.add(cls);
      }

      if (node.type === "Element") {
        const wrapperClasses: string[] = [];

        for (const attribute of node.attributes ?? []) {
          if (attribute.type === "Class" && attribute.name.startsWith("bx--")) {
            wrapperClasses.push(`.${attribute.name}`);
          }
        }

        if (wrapperClasses.length > 0 && nodeContainsDefaultSlot(node)) {
          slotWrappers.push(...wrapperClasses);
        }
      }
    },
  });

  const moduleClasses = new Set<string>();
  const variants: ClassVariant[] = [];

  const gates: ClassGate[] = [];
  for (const [cls, when] of classGates) {
    if (when === null) continue;
    const unique = new Map(when.map((and) => [JSON.stringify(and), and]));
    gates.push({ class: cls, when: [...unique.values()] });
  }

  if (prefixProps.size > 0 && ast.instance) {
    for (const [prefix, props] of prefixProps) {
      if (props === null || props.size !== 1) continue;
      const [prop] = props;
      const value = defaults.get(prop);
      if (typeof value === "string" && !rebound.has(prop)) {
        variants.push({ prefix, prop, default: value });
      }
    }
  }

  if (ast.module) {
    walk(ast.module, {
      enter(node) {
        for (const cls of literalClasses(node, { skipLookups: true })) {
          moduleClasses.add(cls);
        }
      },
    });
  }

  const classes: string[] = [];

  for (const raw of selectors) {
    const value = raw.trim();
    classes.push(value.startsWith(".") ? value : `.${value}`);
  }

  return {
    classes: [...new Set(classes)],
    components: [...new Set(components)],
    slotWrappers: [...new Set(slotWrappers)],
    imports: [...new Set(imports)],
    runtimeClasses: extractRuntimeClassesFromSource(code),
    moduleClasses: [...moduleClasses],
    variants,
    gates,
  };
}

function isStringLiteral(node: ANode): boolean {
  return node?.type === "Literal" && typeof node.value === "string";
}

/**
 * The conditions on props a class test implies, or `null` if none: each
 * `&&` operand that is `prop`, `prop === literal` or `literal === prop` on
 * an exported prop with a literal default the component never rebinds.
 * Other operands (component state, context, `!prop`) are dropped, which is
 * sound for `&&`: the class still needs every kept operand to hold.
 */
function propConditions(
  test: ANode,
  defaults: Map<string, PropDefault>,
  rebound: Set<string>,
): GateCondition[] | null {
  const conditions: GateCondition[] = [];
  const prop = (node: ANode) =>
    node?.type === "Identifier" &&
    defaults.has(node.name) &&
    !rebound.has(node.name)
      ? node.name
      : undefined;
  const literal = (node: ANode) =>
    node?.type === "Literal" &&
    (typeof node.value === "string" || typeof node.value === "boolean")
      ? (node.value as string | boolean)
      : undefined;

  const visit = (node: ANode) => {
    if (node.type === "LogicalExpression" && node.operator === "&&") {
      visit(node.left);
      visit(node.right);
      return;
    }

    const name = prop(node);
    if (name !== undefined) {
      conditions.push({ prop: name, default: defaults.get(name) ?? null });
      return;
    }

    if (
      node.type === "BinaryExpression" &&
      (node.operator === "===" || node.operator === "==")
    ) {
      for (const [side, other] of [
        [node.left, node.right],
        [node.right, node.left],
      ]) {
        const sideProp = prop(side);
        const value = literal(other);
        if (sideProp !== undefined && value !== undefined) {
          conditions.push({
            prop: sideProp,
            default: defaults.get(sideProp) ?? null,
            equals: value,
          });
          return;
        }
      }
    }
  };

  visit(test);
  return conditions.length > 0 ? conditions : null;
}

/**
 * `export let` props in the instance script with a literal default (or
 * none): `"primary"`, `false`, `null`/`undefined`/absent as `null`. Props
 * defaulting to anything else are left out, since a condition on them
 * can't be decided from the source.
 */
function exportedDefaults(instance: ANode): Map<string, PropDefault> {
  const defaults = new Map<string, PropDefault>();

  walk(instance, {
    enter(node) {
      if (
        node.type !== "ExportNamedDeclaration" ||
        node.declaration?.type !== "VariableDeclaration"
      ) {
        return;
      }

      for (const declarator of node.declaration.declarations) {
        if (declarator.id.type !== "Identifier") continue;
        const value = literalDefault(declarator.init);
        if (value !== undefined) defaults.set(declarator.id.name, value);
      }
    },
  });

  return defaults;
}

function literalDefault(init: ANode): PropDefault | undefined {
  if (!init) return null;
  if (init.type === "Identifier" && init.name === "undefined") return null;
  if (init.type !== "Literal") return undefined;
  if (init.value === null) return null;
  if (typeof init.value === "string" || typeof init.value === "boolean") {
    return init.value;
  }
  return undefined;
}

/**
 * Identifiers the component writes to or rebinds besides its own
 * `export let`: assignment and update targets (destructuring included),
 * `bind:` directives, and every other declaration of the name (a local
 * `let`, a function parameter, `{#each … as name}`, `let:name`), since a
 * template could read that binding instead of the prop. Over-collects
 * (object pattern keys), which only drops a variant.
 */
function reboundIdentifiers(ast: ANode): Set<string> {
  const names = new Set<string>();
  const declared = new Set<string>();
  const collect = (target: ANode) => {
    if (!target) return;
    walk(target, {
      enter(node) {
        if (node.type === "Identifier") names.add(node.name);
      },
    });
  };

  walk(ast, {
    enter(node) {
      switch (node.type) {
        case "AssignmentExpression":
          collect(node.left);
          break;
        case "UpdateExpression":
          collect(node.argument);
          break;
        case "Binding":
          collect(node.expression);
          break;
        case "VariableDeclarator":
          // The first declaration of a name may be the prop itself.
          walk(node.id, {
            enter(id) {
              if (id.type !== "Identifier") return;
              if (declared.has(id.name)) names.add(id.name);
              declared.add(id.name);
            },
          });
          break;
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression":
          for (const param of node.params) collect(param);
          break;
        case "CatchClause":
          collect(node.param);
          break;
        case "EachBlock":
          collect(node.context);
          if (node.index) names.add(node.index);
          break;
        case "Let":
          names.add(node.name);
          collect(node.expression);
          break;
      }
    },
  });

  return names;
}
