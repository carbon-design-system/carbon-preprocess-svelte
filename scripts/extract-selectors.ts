import type { Expression, Identifier, Literal } from "estree";
import { walk } from "estree-walker";
import { parse } from "svelte/compiler";
import { CARBON_PREFIX } from "../src/constants";
import type {
  ComponentConditions,
  PropGate,
} from "../src/plugins/analyze-usage";

const WHITESPACE_REGEX = /\s+/;
const GLOBAL_SELECTOR_REGEX = /^:global\((.*)\)$/;

type ExtractSelectorsProps = {
  code: string;
  filename: string;
};

/** Sentinel returned by `classifyGate` for anything not cleanly single-prop gated. */
const UNCONDITIONAL = "unconditional" as const;
type GateResult = PropGate | typeof UNCONDITIONAL;

/** Normalizes a raw class token (e.g. "bx--btn") to a selector (".bx--btn"). */
function toSelector(raw: string): string {
  const value = raw.trim();
  return value.startsWith(".") ? value : `.${value}`;
}

/**
 * Classifies a gate expression into a single-prop predicate, or `UNCONDITIONAL`
 * when the expression is anything more complex (interpolation, derived
 * variables, multiple props, negation, etc.).
 */
function classifyGate(
  expr: Expression | null | undefined,
  props: Set<string>,
  reassigned: Set<string>,
): GateResult {
  if (!expr) return UNCONDITIONAL;

  // class:foo={true} -> always rendered.
  if (expr.type === "Literal" && expr.value === true) return UNCONDITIONAL;

  // boolProp && "..."
  if (expr.type === "Identifier") {
    if (props.has(expr.name) && !reassigned.has(expr.name)) {
      return { kind: "truthy", prop: expr.name };
    }
    return UNCONDITIONAL;
  }

  // prop === "literal"
  if (
    expr.type === "BinaryExpression" &&
    (expr.operator === "===" || expr.operator === "==")
  ) {
    const { left, right } = expr;
    let ident: Identifier | undefined;
    let literal: Literal | undefined;
    if (left.type === "Identifier" && right.type === "Literal") {
      ident = left;
      literal = right;
    } else if (right.type === "Identifier" && left.type === "Literal") {
      ident = right;
      literal = left;
    }
    if (
      ident &&
      typeof literal?.value === "string" &&
      props.has(ident.name) &&
      !reassigned.has(ident.name)
    ) {
      return { kind: "eq", prop: ident.name, values: [literal.value] };
    }
  }

  return UNCONDITIONAL;
}

export function extractSelectors(props: ExtractSelectorsProps) {
  const { code, filename } = props;
  const ast = parse(code, { filename });
  const selectors: Map<string, { type: string; name?: string }> = new Map();
  const components: Set<string> = new Set();

  // ---- Gate analysis state ----
  const propNames = new Set<string>();
  const propDefaults: Record<string, string | boolean> = {};
  const reassigned = new Set<string>();
  const conditional: Record<string, PropGate> = {};
  const unconditional = new Set<string>();

  // Pass 1: collect `export let` props (+ literal defaults) and any
  // reassignment of those props (which makes their gates untrustworthy).
  walk(ast, {
    enter(node) {
      if (
        node.type === "ExportNamedDeclaration" &&
        node.declaration?.type === "VariableDeclaration" &&
        node.declaration.kind === "let"
      ) {
        for (const decl of node.declaration.declarations) {
          if (decl.id?.type !== "Identifier") continue;
          propNames.add(decl.id.name);
          const init = decl.init;
          if (
            init?.type === "Literal" &&
            (typeof init.value === "string" || typeof init.value === "boolean")
          ) {
            propDefaults[decl.id.name] = init.value;
          }
        }
      }

      if (
        node.type === "AssignmentExpression" &&
        node.left?.type === "Identifier"
      ) {
        reassigned.add(node.left.name);
      }
      if (
        node.type === "UpdateExpression" &&
        node.argument?.type === "Identifier"
      ) {
        reassigned.add(node.argument.name);
      }
      // Binding a prop into a child reassigns it: <Child bind:x={prop} />
      if (node.type === "Binding" && node.expression?.type === "Identifier") {
        reassigned.add(node.expression.name);
      }
    },
  });

  const addGate = (rawClass: string, gate: GateResult) => {
    if (!CARBON_PREFIX.test(rawClass)) return;
    for (const token of rawClass.split(WHITESPACE_REGEX).filter(Boolean)) {
      if (!CARBON_PREFIX.test(token)) continue;
      const cls = toSelector(token);

      if (gate === UNCONDITIONAL) {
        unconditional.add(cls);
        continue;
      }

      const existing = conditional[cls];
      if (!existing) {
        conditional[cls] =
          gate.kind === "eq"
            ? { ...gate, values: [...gate.values] }
            : { ...gate };
      } else if (
        existing.kind === "eq" &&
        gate.kind === "eq" &&
        existing.prop === gate.prop
      ) {
        for (const v of gate.values) {
          if (!existing.values.includes(v)) existing.values.push(v);
        }
      } else {
        // Conflicting gates (different prop/kind) -> unsafe to gate; keep always.
        unconditional.add(cls);
        delete conditional[cls];
      }
    }
  };

  // Pass 2: collect classes (unchanged behavior for `classes`/`components`)
  // and classify each Carbon class for gate analysis.
  walk(ast, {
    enter(node, parent) {
      // A component may compose other components.
      // Record these references for later processing.
      if (node.type === "InlineComponent") {
        if (node.name === "svelte:component") {
          components.add(node.expression.name);
        } else {
          components.add(node.name);
        }
      }

      if (node.type === "Attribute" && node.name === "class") {
        // class="c1"
        // class="c1 c2"
        // class="{c} c1 c2 c3"
        if (node.value) {
          for (const value of node.value) {
            if (value.type === "Text") {
              for (const selector of value.data
                .split(WHITESPACE_REGEX)
                .filter(Boolean)) {
                selectors.set(selector, { type: node.type });
              }
              // Static class attribute -> always rendered.
              addGate(value.data, UNCONDITIONAL);
            }
          }
        }
      }

      // class:directive
      if (node.type === "Class") {
        selectors.set(node.name, { type: node.type });
        addGate(
          node.name,
          classifyGate(node.expression, propNames, reassigned),
        );
      }

      if (node.type === "PseudoClassSelector" && node.name === "global") {
        // global selector
        // :global(div) {}
        const selector = code.slice(node.start, node.end);

        // Remove :global( from start and ) from end
        const cleanSelector = selector.replace(GLOBAL_SELECTOR_REGEX, "$1");
        selectors.set(cleanSelector, { type: node.type, name: node.name });
        addGate(cleanSelector, UNCONDITIONAL);
      }

      if (node.type === "Literal" && CARBON_PREFIX.test(node.value)) {
        selectors.set(node.value, { type: "Class" });
        // Gated when the literal is the right operand of `gate && "bx--..."`.
        const gate =
          parent?.type === "LogicalExpression" &&
          parent.operator === "&&" &&
          parent.right === node
            ? classifyGate(parent.left, propNames, reassigned)
            : UNCONDITIONAL;
        addGate(node.value, gate);
      }

      if (
        node.type === "TemplateElement" &&
        CARBON_PREFIX.test(node.value.raw)
      ) {
        selectors.set(node.value.raw, { type: "Class" });
        // Interpolated families (`bx--btn--${kind}`) are left conservative.
        addGate(node.value.raw, UNCONDITIONAL);
      }
    },
  });

  const classes: string[] = [];

  // Iterate through all class attribute identifiers
  for (const [v = ""] of selectors) {
    if (typeof v === "string") {
      const value = v.trim();

      if (value.startsWith("bx--") && !value.startsWith(".")) {
        classes.push(`.${value}`);
      } else {
        if (value.startsWith(".")) {
          classes.push(value);
        } else {
          classes.push(`.${value}`);
        }
      }
    }
  }

  // Reconcile: a class seen unconditional anywhere wins over any gate.
  for (const cls of unconditional) {
    delete conditional[cls];
  }

  const conditions: ComponentConditions = {
    conditional,
    unconditional: [...unconditional],
    propDefaults,
  };

  return {
    /** Unique classes in the current component. */
    classes: [...new Set(classes)],

    /** Unique components that are referenced by the current component. */
    components: [...new Set(components)],

    /** Single-prop gate analysis for aggressive (experimental) pruning. */
    conditions,
  };
}
