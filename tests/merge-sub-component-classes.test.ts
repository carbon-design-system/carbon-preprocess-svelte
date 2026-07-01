import { mergeSubComponentClasses } from "../src/indexer/merge-sub-component-classes";

type Entry = { classes: string[] };

describe("mergeSubComponentClasses", () => {
  test("propagates a 3-level chain regardless of subComponents insertion order", () => {
    // A renders B renders C. B is an internal (non-exported) component that
    // itself must absorb C's classes before A can inherit them.
    const forward = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["C"]],
    ]);
    const backward = new Map<string, string[]>([
      ["B", ["C"]],
      ["A", ["B"]],
    ]);

    const classesForward = new Map<string, Entry>([
      ["A", { classes: [".a"] }],
      ["B", { classes: [".b"] }],
      ["C", { classes: [".c"] }],
    ]);
    const classesBackward = new Map<string, Entry>([
      ["C", { classes: [".c"] }],
      ["A", { classes: [".a"] }],
      ["B", { classes: [".b"] }],
    ]);

    mergeSubComponentClasses(forward, classesForward);
    mergeSubComponentClasses(backward, classesBackward);

    const expectedA = [".a", ".b", ".c"];
    const expectedB = [".b", ".c"];

    expect(new Set(classesForward.get("A")?.classes)).toEqual(
      new Set(expectedA),
    );
    expect(new Set(classesForward.get("B")?.classes)).toEqual(
      new Set(expectedB),
    );
    expect(new Set(classesForward.get("A")?.classes)).toEqual(
      new Set(classesBackward.get("A")?.classes),
    );
    expect(new Set(classesForward.get("B")?.classes)).toEqual(
      new Set(classesBackward.get("B")?.classes),
    );
  });

  test("leaves a component untouched when it is not a merge source for anything", () => {
    const subComponents = new Map<string, string[]>([["A", ["B"]]]);
    const classes = new Map<string, Entry>([
      ["A", { classes: [".a"] }],
      ["B", { classes: [".b"] }],
      ["D", { classes: [".d"] }],
    ]);

    mergeSubComponentClasses(subComponents, classes);

    expect(classes.get("D")?.classes).toEqual([".d"]);
  });

  test("does not warn about the iteration cap on realistic nesting depths", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const subComponents = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["D"]],
    ]);
    const classes = new Map<string, Entry>([
      ["A", { classes: [".a"] }],
      ["B", { classes: [".b"] }],
      ["C", { classes: [".c"] }],
      ["D", { classes: [".d"] }],
    ]);

    mergeSubComponentClasses(subComponents, classes);

    expect(new Set(classes.get("A")?.classes)).toEqual(
      new Set([".a", ".b", ".c", ".d"]),
    );
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test("skips a parent absent from componentClasses without throwing", () => {
    const subComponents = new Map<string, string[]>([["Internal", ["B"]]]);
    const classes = new Map<string, Entry>([["B", { classes: [".b"] }]]);

    expect(() =>
      mergeSubComponentClasses(subComponents, classes),
    ).not.toThrow();
    expect(classes.get("B")?.classes).toEqual([".b"]);
  });
});
