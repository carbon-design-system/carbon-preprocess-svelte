/**
 * The abstract values the usage analysis computes with: each expression is
 * either a small set of the primitives it can evaluate to, or `UNKNOWN`.
 * Everything here is conservative: when in doubt, a value widens to
 * `UNKNOWN`, which keeps every branch it guards alive.
 */

/** Some object, array, or function: truthy, never nullish, never `===` a primitive. */
export const OBJECT = Symbol("object");

/**
 * A `[]` the component never mutates or lets escape (see
 * `ComponentModel.escapingNames`): an object with no items. Everything
 * but `.length` and `{#each}` treats it as `OBJECT`.
 */
export const EMPTY_ARRAY = Symbol("empty array");

/** A value the analysis can't bound. */
export const UNKNOWN = Symbol("unknown");

export type Primitive =
  | string
  | number
  | boolean
  | null
  | undefined
  | typeof OBJECT
  | typeof EMPTY_ARRAY;

export type Value = ReadonlySet<Primitive> | typeof UNKNOWN;

/** Past this many possible values, a set widens to `UNKNOWN`. */
const MAX_VALUES = 32;

export function possible(...values: Primitive[]): Value {
  return new Set(values);
}

export const UNDEFINED: Value = possible(undefined);
export const BOOLEAN: Value = possible(true, false);
export const EMPTY: Value = possible();

export function join(a: Value, b: Value): Value {
  if (a === UNKNOWN || b === UNKNOWN) return UNKNOWN;
  if (b.size === 0) return a;
  if (a.size === 0) return b;
  const joined = new Set([...a, ...b]);
  return joined.size > MAX_VALUES ? UNKNOWN : joined;
}

/** Joins `map(p)` over every possible value `p` of `value`. */
export function flatMap(value: Value, map: (p: Primitive) => Value): Value {
  if (value === UNKNOWN) return UNKNOWN;
  let result: Value = EMPTY;
  for (const p of value) {
    result = join(result, map(p));
    if (result === UNKNOWN) return UNKNOWN;
  }
  return result;
}

/** `OBJECT` or `EMPTY_ARRAY`. */
export function isObject(
  p: Primitive,
): p is typeof OBJECT | typeof EMPTY_ARRAY {
  return p === OBJECT || p === EMPTY_ARRAY;
}

/** Whether every possible value is an `EMPTY_ARRAY`. */
export function isEmptyArray(value: Value): boolean {
  if (value === UNKNOWN || value.size === 0) return false;
  for (const p of value) if (p !== EMPTY_ARRAY) return false;
  return true;
}

export function isTruthy(p: Primitive): boolean {
  return isObject(p) || Boolean(p);
}

export function isNullish(p: Primitive): boolean {
  return p === null || p === undefined;
}

export type Truth = "truthy" | "falsy" | "either";

/** Whether every possible value is truthy, every one falsy, or neither. */
export function truthOf(value: Value): Truth {
  if (value === UNKNOWN || value.size === 0) return "either";
  let truthy = 0;
  for (const p of value) if (isTruthy(p)) truthy++;
  if (truthy === value.size) return "truthy";
  return truthy === 0 ? "falsy" : "either";
}

/** Whether no possible value is `null` or `undefined`. */
export function isNeverNullish(value: Value): boolean {
  if (value === UNKNOWN || value.size === 0) return false;
  for (const p of value) if (isNullish(p)) return false;
  return true;
}

const EQUALITY = new Set(["===", "!==", "==", "!="]);
const RELATIONAL = new Set(["<", ">", "<=", ">="]);

/** `a <operator> b` over every pair of possible values. */
export function binary(operator: string, a: Value, b: Value): Value {
  if (a === UNKNOWN || b === UNKNOWN) return UNKNOWN;
  return flatMap(a, (x) =>
    flatMap(b, (y) => {
      if (isObject(x) || isObject(y)) {
        // Two objects may or may not be the same one; an object never
        // equals a primitive (`==` coercion of objects is not modeled).
        if (!EQUALITY.has(operator) || (isObject(x) && isObject(y))) {
          return UNKNOWN;
        }
        return possible(operator.startsWith("!"));
      }
      if (RELATIONAL.has(operator)) {
        // Numbers with numbers and strings with strings; no coercion.
        if (
          !(typeof x === "number" && typeof y === "number") &&
          !(typeof x === "string" && typeof y === "string")
        ) {
          return UNKNOWN;
        }
        const [a, b] = [x, y] as [number, number];
        switch (operator) {
          case "<":
            return possible(a < b);
          case ">":
            return possible(a > b);
          case "<=":
            return possible(a <= b);
          default:
            return possible(a >= b);
        }
      }
      switch (operator) {
        case "===":
          return possible(x === y);
        case "!==":
          return possible(x !== y);
        case "==":
          // biome-ignore lint/suspicious/noDoubleEquals: models `==`
          return possible(x == y);
        case "!=":
          // biome-ignore lint/suspicious/noDoubleEquals: models `!=`
          return possible(x != y);
        case "+":
          return typeof x === "string" || typeof y === "string"
            ? possible(String(x) + String(y))
            : UNKNOWN;
        default:
          return UNKNOWN;
      }
    }),
  );
}

/** `String(value)` for every possible value, as a template literal would. */
export function stringify(value: Value): Value {
  return flatMap(value, (p) => (isObject(p) ? UNKNOWN : possible(String(p))));
}

/** For reports: `"primary", "ghost"`, `true`, or `dynamic`. */
export function formatValue(value: Value): string {
  if (value === UNKNOWN) return "dynamic";
  return [...value]
    .map((p) =>
      p === OBJECT
        ? "object"
        : p === EMPTY_ARRAY
          ? "[]"
          : p === undefined
            ? "undefined"
            : JSON.stringify(p),
    )
    .sort()
    .join(", ");
}
