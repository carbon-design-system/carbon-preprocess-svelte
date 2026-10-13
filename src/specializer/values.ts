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
 * `ComponentModel.escapes`): an object with no items. Everything
 * but `.length` and `{#each}` treats it as `OBJECT`.
 */
export const EMPTY_ARRAY = Symbol("empty array");

/** A value the analysis can't bound. */
export const UNKNOWN = Symbol("unknown");

/**
 * An object or array literal nothing mutates or lets escape (like
 * `EMPTY_ARRAY`; see `ComponentModel.escapes`): its own properties and
 * elements are known. Only made by `shape`, which interns them, so two
 * equal literals are the same value.
 */
export type Shape =
  | { readonly kind: "object"; readonly props: ReadonlyMap<string, Value> }
  | { readonly kind: "array"; readonly elements: readonly Value[] };

/**
 * A Svelte store and what it can hold: `readable(v)` from `svelte/store`
 * with no start function, which never changes, or a store a context hands
 * on (see `MirroredStore`). Only made by `store`.
 */
export type Store = { readonly kind: "store"; readonly value: Value };

export type Primitive =
  | string
  | number
  | boolean
  | null
  | undefined
  | typeof OBJECT
  | typeof EMPTY_ARRAY
  | Shape
  | Store;

export type Value = ReadonlySet<Primitive> | typeof UNKNOWN;

/** Past this many possible values, a set widens to `UNKNOWN`. */
const MAX_VALUES = 32;

export function possible(...values: Primitive[]): Value {
  return new Set(values);
}

export const UNDEFINED: Value = possible(undefined);
export const BOOLEAN: Value = possible(true, false);
const EMPTY: Value = possible();

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
  if (value.size === 1) {
    const [p] = value;
    return map(p);
  }
  const result = new Set<Primitive>();
  for (const p of value) {
    const mapped = map(p);
    if (mapped === UNKNOWN) return UNKNOWN;
    for (const q of mapped) result.add(q);
    if (result.size > MAX_VALUES) return UNKNOWN;
  }
  return result;
}

export function isShape(p: Primitive): p is Shape {
  return typeof p === "object" && p !== null && p.kind !== "store";
}

export function isStore(p: Primitive): p is Store {
  return typeof p === "object" && p !== null && p.kind === "store";
}

/** `OBJECT`, `EMPTY_ARRAY`, a shape or a store: some object. */
export function isObject(
  p: Primitive,
): p is typeof OBJECT | typeof EMPTY_ARRAY | Shape | Store {
  return p === OBJECT || p === EMPTY_ARRAY || isShape(p) || isStore(p);
}

/** An object whose contents are known: `EMPTY_ARRAY` or a shape. */
export function isStructured(p: Primitive): p is typeof EMPTY_ARRAY | Shape {
  return p === EMPTY_ARRAY || isShape(p);
}

/** Past this many properties or elements, a literal is just some object. */
export const MAX_SHAPE_SIZE = 32;
/** Interned shapes; cleared past this many, so watch rebuilds don't grow it forever. */
const MAX_INTERNED = 10_000;
const interned = new Map<string, Shape>();
const ids = new WeakMap<Shape, number>();
let nextId = 0;

/** A key that's equal for values that hold the same values. */
export function valueKey(value: Value): string {
  if (value === UNKNOWN) return "?";
  return [...value]
    .map((p) => {
      if (isShape(p)) return `#${ids.get(p)}`;
      if (isStore(p)) return `$(${valueKey(p.value)})`;
      if (p === OBJECT) return "o";
      if (p === EMPTY_ARRAY) return "[]";
      return typeof p === "string" ? JSON.stringify(p) : String(p);
    })
    .sort()
    .join("|");
}

/** Whether `a` and `b` hold the same values. */
export function sameValue(a: Value, b: Value): boolean {
  return a === b || valueKey(a) === valueKey(b);
}

/** The interned shape of an object (`props`) or array (`elements`) literal. */
export function shape(
  contents:
    | { kind: "object"; props: ReadonlyMap<string, Value> }
    | { kind: "array"; elements: readonly Value[] },
): Shape {
  const key =
    contents.kind === "object"
      ? `{${[...contents.props]
          .map(([name, value]) => `${JSON.stringify(name)}:${valueKey(value)}`)
          .sort()
          .join(",")}}`
      : `[${contents.elements.map(valueKey).join(",")}]`;
  let existing = interned.get(key);
  if (!existing) {
    if (interned.size >= MAX_INTERNED) interned.clear();
    existing = contents;
    interned.set(key, existing);
    ids.set(existing, nextId++);
  }
  return existing;
}

const stores = new Map<string, Store>();

/** The interned store holding `value`; see `Store`. */
/**
 * A store holding `value`, as a value. One holding an object could have it
 * changed through `$s`, so its contents are unknown.
 */
export function storeOf(value: Value): Value {
  return possible(
    store(value !== UNKNOWN && [...value].some(isObject) ? UNKNOWN : value),
  );
}

export function store(value: Value): Store {
  const key = valueKey(value);
  let existing = stores.get(key);
  if (!existing) {
    if (stores.size >= MAX_INTERNED) stores.clear();
    existing = { kind: "store", value };
    stores.set(key, existing);
  }
  return existing;
}

const INDEX = /^(?:0|[1-9]\d*)$/;
const OBJECT_PROTOTYPE_KEYS = new Set(
  Object.getOwnPropertyNames(Object.prototype),
);

/** `p[key]` when it's known: an own property, an element, `length`. */
export function readProperty(p: Primitive, key: string): Value {
  if (typeof p === "string" && key === "length") return possible(p.length);
  if (p === EMPTY_ARRAY) {
    if (key === "length") return possible(0);
    return INDEX.test(key) ? UNDEFINED : UNKNOWN;
  }
  if (!isShape(p)) return UNKNOWN;
  if (p.kind === "array") {
    if (key === "length") return possible(p.elements.length);
    if (!INDEX.test(key)) return UNKNOWN;
    return p.elements[Number(key)] ?? UNDEFINED;
  }
  const own = p.props.get(key);
  if (own) return own;
  // Inherited (`toString`, `constructor`) is some function, not `undefined`.
  return OBJECT_PROTOTYPE_KEYS.has(key) ? UNKNOWN : UNDEFINED;
}

/** The items `{#each value}` iterates: every element, or none for `[]`. */
export function itemsOf(value: Value): Value {
  return flatMap(value, (p) => {
    if (p === EMPTY_ARRAY) return EMPTY;
    if (isShape(p) && p.kind === "array") {
      return p.elements.reduce<Value>(
        (all, element) => join(all, element),
        EMPTY,
      );
    }
    return UNKNOWN;
  });
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
        // Two objects may or may not be the same one. An object never
        // strictly equals a primitive, nor loosely `null` or `undefined`,
        // but `==` coerces it against anything else (`[] == ""`).
        const other = isObject(x) ? y : x;
        if (
          !EQUALITY.has(operator) ||
          isObject(other) ||
          (operator.length === 2 && !isNullish(other))
        ) {
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

/**
 * `typeof value` for every possible value. Some object may be a function
 * (a component, a handler), so it reads as `"object"` or `"function"`.
 */
export function typeOf(value: Value): Value {
  return flatMap(value, (p) => {
    if (p === OBJECT) return possible("object", "function");
    if (isStructured(p) || isStore(p) || p === null) {
      return possible("object");
    }
    return possible(typeof p);
  });
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
          : isShape(p) || isStore(p)
            ? p.kind
            : p === undefined
              ? "undefined"
              : JSON.stringify(p),
    )
    .sort()
    .join(", ");
}
