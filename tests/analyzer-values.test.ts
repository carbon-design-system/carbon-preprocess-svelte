import {
  BOOLEAN,
  binary,
  formatValue,
  isNeverNullish,
  itemsOf,
  join,
  OBJECT,
  possible,
  readProperty,
  shape,
  stringify,
  truthOf,
  typeOf,
  UNKNOWN,
} from "../src/analyzer/values";

describe("analyzer values", () => {
  test("join widens to UNKNOWN past 32 values or with UNKNOWN", () => {
    expect(join(possible(1), possible(2))).toEqual(new Set([1, 2]));
    expect(join(possible(1), UNKNOWN)).toBe(UNKNOWN);
    let many = possible();
    for (let i = 0; i < 33; i++) many = join(many, possible(i));
    expect(many).toBe(UNKNOWN);
  });

  test("truthOf and isNeverNullish", () => {
    expect(truthOf(possible("a", OBJECT, 1))).toBe("truthy");
    expect(truthOf(possible("", 0, null, undefined, false))).toBe("falsy");
    expect(truthOf(BOOLEAN)).toBe("either");
    expect(truthOf(UNKNOWN)).toBe("either");
    expect(isNeverNullish(possible(0, ""))).toBe(true);
    expect(isNeverNullish(possible(0, null))).toBe(false);
    expect(isNeverNullish(UNKNOWN)).toBe(false);
  });

  test("binary covers every pair of values", () => {
    expect(binary("===", possible("a", "b"), possible("a"))).toEqual(BOOLEAN);
    expect(binary("!==", possible("a"), possible("a"))).toEqual(
      possible(false),
    );
    expect(binary("==", possible(null), possible(undefined))).toEqual(
      possible(true),
    );
    expect(binary("!=", possible(1), possible("1"))).toEqual(possible(false));
    expect(binary("+", possible("bx--btn--"), possible("ghost"))).toEqual(
      possible("bx--btn--ghost"),
    );
    // Comparisons of numbers with numbers, or strings with strings.
    expect(binary("<", possible(1), possible(2))).toEqual(possible(true));
    expect(binary(">", possible(0, 3), possible(0))).toEqual(BOOLEAN);
    expect(binary(">=", possible("b"), possible("a"))).toEqual(possible(true));
    expect(binary("<", possible(1), possible("2"))).toBe(UNKNOWN);
    // Numbers added, and anything else, aren't modeled.
    expect(binary("+", possible(1), possible(2))).toBe(UNKNOWN);
    // An object never equals a primitive; two objects might be the same.
    expect(binary("===", possible(OBJECT), possible("a"))).toEqual(
      possible(false),
    );
    expect(binary("===", possible(OBJECT), possible(OBJECT))).toBe(UNKNOWN);
    expect(binary("+", possible(OBJECT), possible("a"))).toBe(UNKNOWN);
  });

  test("stringify and formatValue", () => {
    expect(stringify(possible(undefined, 1, true))).toEqual(
      possible("undefined", "1", "true"),
    );
    expect(stringify(possible(OBJECT))).toBe(UNKNOWN);
    expect(formatValue(UNKNOWN)).toBe("dynamic");
    expect(formatValue(possible("b", "a", undefined, OBJECT))).toBe(
      '"a", "b", object, undefined',
    );
  });

  test("typeOf reads every possible value's type", () => {
    expect(typeOf(possible(1, "a", undefined))).toEqual(
      possible("number", "string", "undefined"),
    );
    expect(typeOf(possible(null))).toEqual(possible("object"));
    // Some object may be a function: a component, a handler.
    expect(typeOf(possible(OBJECT))).toEqual(possible("object", "function"));
    expect(typeOf(UNKNOWN)).toBe(UNKNOWN);
  });

  test("shapes: equal literals are one value, and their contents read back", () => {
    const button = (kind: string) =>
      shape({ kind: "object", props: new Map([["kind", possible(kind)]]) });
    expect(button("ghost")).toBe(button("ghost"));
    expect(button("ghost")).not.toBe(button("danger"));
    expect(readProperty(button("ghost"), "kind")).toEqual(possible("ghost"));
    expect(readProperty(button("ghost"), "text")).toEqual(possible(undefined));
    // Inherited properties are functions, not `undefined`.
    expect(readProperty(button("ghost"), "toString")).toBe(UNKNOWN);
    const list = shape({
      kind: "array",
      elements: [possible(button("ghost")), possible(button("danger"))],
    });
    expect(readProperty(list, "length")).toEqual(possible(2));
    expect(itemsOf(possible(list))).toEqual(
      possible(button("ghost"), button("danger")),
    );
  });
});
