import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Expression } from "sveast/walk";
import { CARBON, PROP_AWARE_FAILURE } from "../src/carbon-library";
import { analyzeFiles } from "../src/specializer/analysis";
import { buildComponentModel } from "../src/specializer/component-model";
import { createScope, evaluate } from "../src/specializer/evaluate";
import { parse } from "../src/specializer/parser";
import {
  dropUnusedDeclarations,
  type SpecializeOptions,
  specializeComponent,
} from "../src/specializer/specialize";
import { addCallSite, newComponentUsage } from "../src/specializer/usage";
import {
  OBJECT,
  possible,
  UNKNOWN,
  type Value,
} from "../src/specializer/values";

/** Specializes `code` as a component whose one call site passes `props` (as values). */
function specializeWith(code: string, props: Map<string, Value>) {
  const model = buildComponentModel(code, "X/X.svelte");
  const usage = newComponentUsage();
  addCallSite(
    usage,
    { component: model.key, open: false, props, slots: new Set() },
    model.props.keys(),
    undefined,
  );
  const result = specializeComponent(
    createScope(model, usage, () => possible(undefined)),
  );
  parse(result.code);
  return result.code;
}

/** Specializes `code` as a component whose one call site passes `props`. */
function specialize(
  code: string,
  props: Record<string, string | number | boolean | undefined> = {},
  slots: string[] = [],
  options?: SpecializeOptions,
) {
  const model = buildComponentModel(code, "X/X.svelte");
  const usage = newComponentUsage();
  addCallSite(
    usage,
    {
      component: model.key,
      open: false,
      props: new Map(Object.entries(props).map(([k, v]) => [k, possible(v)])),
      slots: new Set(slots),
    },
    model.props.keys(),
    undefined,
  );
  const result = specializeComponent(
    createScope(model, usage, () => possible(undefined)),
    options,
  );
  parse(result.code);
  return result.code;
}

describe("specializeComponent", () => {
  test("folds known reads and removes branches that can't run", () => {
    const code = specialize(
      `<script>
  export let kind = "primary";
  export let skeleton = false;
  $: cls = kind === "ghost" ? "a" : "b";
</script>
{#if skeleton}<Skeleton />{:else}<button class={cls}>{kind}</button>{/if}`,
      { kind: "tertiary" },
    );
    expect(code).toContain(`export let kind = "primary";`);
    // The live branch keeps a block around it, so whitespace renders the
    // same in Svelte 3/4.
    expect(code).toContain(
      `{#if true}<button class={"b"}>{"tertiary"}</button>{/if}`,
    );
    expect(code).not.toContain("Skeleton");
  });

  test("`unwrap` replaces a block with its live branch (Svelte 5)", () => {
    const code = specialize(
      `<script>export let a = true;</script>
<p>
  {#if a}
    <!-- svelte-ignore a11y-missing-attribute -->
    <img />
  {:else}
    <b />
  {/if}
</p>`,
      {},
      [],
      { unwrap: true },
    );
    expect(code).toContain(
      "<p>\n  <!-- svelte-ignore a11y-missing-attribute --><img />\n</p>",
    );
  });

  test("keeps props declared and never folds what's written", () => {
    const code = specialize(
      `<script>
  export let open = false;
  let ref;
  function toggle() { open = !open; }
</script>
<div bind:this={ref} class:open={open} on:click={toggle} />`,
    );
    expect(code).toContain("export let open = false;");
    expect(code).toContain("class:open={open}");
    expect(code).toContain("bind:this={ref}");
  });

  test("expands shorthands instead of folding inside them", () => {
    const code = specialize(
      `<script>
  export let title = "Close";
  export let size = "sm";
  const props = { size };
</script>
<Icon {title} {...props} />`,
    );
    expect(code).toContain(`title={"Close"}`);
    expect(code).toContain(`size: "sm"`);
  });

  test("an unfilled slot is undefined, not false", () => {
    const code = specialize(
      `<script>
  export let icon = undefined;
  $: hasIcon = icon || $$slots.icon;
</script>
<div style={hasIcon && "width: 3rem"} />`,
    );
    expect(code).toContain("style={void 0}");
  });

  test("class directives fold to true or disappear", () => {
    const code = specialize(
      `<script>export let disabled = false; export let light = true;</script>
<div class:bx--disabled={disabled} class:bx--light={light} />`,
    );
    expect(code).not.toContain("bx--disabled");
    expect(code).toContain("class:bx--light={true}");
  });

  test("keeps whitespace on both sides of a removed block apart", () => {
    const code = specialize(
      `<script>export let a = false;</script>
<p>
  {#if a}A{/if}
  <slot />
</p>
<p><b />{#if a}A{/if}<i /></p>`,
    );
    // Between whitespace: a placeholder keeps the two from merging.
    expect(code).toContain("{#if false}<!---->{/if}\n  <slot />");
    // Between elements: removed outright.
    expect(code).toContain("<p><b /><i /></p>");
  });

  test("keeps a block around a live branch that declares `{@const}`", () => {
    const code = specialize(
      `<script>export let mode = "a";</script>
{#if mode === "a"}{@const x = 1}<p>{x}</p>{:else}<p>b</p>{/if}`,
    );
    expect(code).toContain("{#if true}{@const x = 1}");
  });

  test("if statements keep only the branch that can run", () => {
    const code = specialize(
      `<script>
  export let a = false;
  function f() {
    if (a) { one(); } else { two(); }
    if (a) three();
  }
</script>
<button on:click={f} />`,
    );
    expect(code).toContain("{ two(); }");
    expect(code).not.toContain("one()");
    expect(code).not.toContain("three()");
  });

  test("a ternary with a side-effecting test keeps the test", () => {
    const code = specialize(
      `<script>
  export let a = true;
  $: x = (log(), a) ? "yes" : expensive();
</script>
<p>{x}</p>`,
    );
    // The test still runs (and the statement stays); the branch that can't
    // run is gone, and `{x}` folds to its one value.
    expect(code).toContain('$: x = (log(), true) ? "yes" : void 0;');
    expect(code).toContain('<p>{"yes"}</p>');
  });

  test("`typeof` picks a branch when the value's type is known", () => {
    const source = `<script>
  export let total = undefined;
  $: hasTotal = typeof total === "number";
</script>
{#if hasTotal}<span class="total">{total}</span>{/if}`;
    expect(specialize(source)).not.toContain('class="total"');
    expect(specialize(source, { total: 5 })).toContain('class="total"');
  });

  test("reads the items of a known array inside `{#each}`", () => {
    const code = specialize(
      `<script>
  const links = [{ href: "/a", kind: "nav" }, { href: "/b", kind: "nav" }];
</script>
{#each links as link}<a href={link.href} class={link.kind}>{link.href}</a>{/each}`,
    );
    // Every item has the same `kind`; `href` differs.
    expect(code).toContain('class={"nav"}');
    expect(code).toContain("href={link.href}");
  });

  test("an object something may change stays unknown", () => {
    for (const change of [
      "links[0].kind = 'x';",
      "links.push({ kind: 'x' });",
      "keep(links);",
      "keep(links[0]);",
    ]) {
      const code = specialize(
        `<script>
  const links = [{ kind: "nav" }];
  function update() { ${change} }
</script>
{#each links as link}<a class={link.kind} on:click={update}>x</a>{/each}`,
      );
      expect(code).toContain("class={link.kind}");
    }
  });

  test("an item a destructured `{#each}` binds or a slot hands on may change", () => {
    const destructured = specialize(
      `<script>
  const items = [{ open: false }];
</script>
{#each items as { open }}<input type="checkbox" bind:checked={open} />{/each}
{#each items as item}{#if item.open}<p>open</p>{/if}{/each}`,
    );
    expect(destructured).toContain("{#if item.open}");

    const slotted = specialize(
      `<script>
  const state = { open: false };
</script>
<slot {state} />
{#if state.open}<p>open</p>{/if}`,
    );
    expect(slotted).toContain("{#if state.open}");
  });

  test("an array that stays empty renders no `{#each}` body", () => {
    const code = specialize(
      `<script>export let items = [];</script>
<div>{#if items.length > 0}{#each items as item}<b>{item}</b>{/each}{/if}</div>
<ul>{#each items as item}<li>{item}</li>{:else}<p>None</p>{/each}</ul>`,
    );
    expect(code).toContain("<div>{#if false}<!---->{/if}</div>");
    expect(code).toContain("<ul>{#if true}<p>None</p>{/if}</ul>");
  });

  test.each([
    ["mutated", "onMount(() => items.push(1));"],
    ["aliased", "const copy = items;"],
    ["handed to a function", "load(items);"],
    ["truncated through `length`", "items.length = 0;"],
    ["reached through `$$props`", "const all = $$props;"],
  ])("an array %s may not stay empty", (_, statement) => {
    const code = specialize(
      `<script>export let items = []; ${statement}</script>
<ul>{#each items as item}<li>{item}</li>{/each}</ul>`,
    );
    expect(code).toContain("{#each items as item}");
  });

  test("an array a parent passes may hold items", () => {
    const code = specializeWith(
      `<script>export let items = []; $: label = $$props["aria-label"];</script>
<ul aria-label={label}>{#each items as item}<li>{item}</li>{/each}</ul>`,
      new Map([["items", possible(OBJECT)]]),
    );
    expect(code).toContain("{#each items as item}");
  });

  test("leaves expression statements' own value alone", () => {
    const code = specialize(`<script>export let a = "x"; $: { a; }</script>`);
    expect(code).toContain("$: { a; }");
  });
});

test("marks props nothing reads anymore so Svelte doesn't warn", () => {
  const code = specialize(
    `<script>
  export let warn = false;
  export let warnText = "";
  let className = undefined;
  export { className as class };
</script>
<div class={className}>{#if warn}<p>{warnText}</p>{/if}</div>`,
  );
  const ignore = "// svelte-ignore unused-export-let export_let_unused";
  expect(code).toContain(`${ignore}\n  export let warn = false;`);
  expect(code).toContain(`${ignore}\n  export let warnText = "";`);
  // Svelte 5 reports a renamed export at the `let`, Svelte 3/4 at `export`.
  expect(code).toContain(`${ignore}\n  let className = undefined;`);
  expect(code).toContain(`${ignore}\n  export { className as class };`);
});

test("a renamed export is a prop: `class` sets `className`", () => {
  const code = specialize(
    `<script>
  let className = undefined;
  export { className as class };
</script>
<div class={className} />`,
    { class: "custom" },
  );
  expect(code).toContain(`<div class={"custom"} />`);
});

describe("dropUnusedDeclarations", () => {
  test("removes unread, side-effect-free declarations until none are left", () => {
    const { code, dropped } = dropUnusedDeclarations(
      `<script>
  export let a = 1;
  $: b = a + 1;
  $: c = b * 2;
  $: d = compute(a);
  const e = 3;
</script>
<p>{a}</p>`,
    );
    expect(dropped).toBe(3);
    expect(code).toContain("export let a = 1;");
    expect(code).toContain("$: d = compute(a);");
    expect(code).not.toContain("$: b");
    expect(code).not.toContain("$: c");
    expect(code).not.toContain("const e");
  });

  test("keeps store writes and prop assignments, which have effects", () => {
    const { code, dropped } = dropUnusedDeclarations(
      `<script>
  import { writable } from "svelte/store";
  export let open = false;
  export let value = "";
  const shared = writable(open);
  $: $shared = open;
  $: value = "x";
</script>
<p>{open}</p>`,
    );
    expect(dropped).toBe(0);
    expect(code).toContain("$: $shared = open;");
    expect(code).toContain('$: value = "x";');
  });

  test("keeps declarations read by markup, stores, or directives", () => {
    const { dropped } = dropUnusedDeclarations(
      `<script>
  const store = 1;
  const flag = true;
  const name = "x";
</script>
<p class:flag>{$store}</p><input bind:value={name} />`,
    );
    expect(dropped).toBe(0);
  });
});

test("Carbon BigNumber without `total` drops the denominator", async () => {
  const dir = mkdtempSync(join(tmpdir(), "specialize-"));
  try {
    const file = join(dir, "App.svelte");
    const code = `<script>import { BigNumber } from "carbon-components-svelte";</script>\n<BigNumber value={42} />`;
    writeFileSync(file, code);
    const result = await analyzeFiles({
      library: CARBON,
      failure: PROP_AWARE_FAILURE,
      projectRoot: process.cwd(),
      files: [{ file, code }],
      components: ["BigNumber"],
      options: {},
    });
    if ("warning" in result) throw new Error(result.warning);
    const scope = result.analysis.scopeFor("BigNumber/BigNumber.svelte");
    if (!scope) throw new Error("BigNumber isn't live");
    expect(result.isPruned(".bx--big-number__denominator")).toBe(true);
    const { code: rewritten } = specializeComponent(scope);
    parse(rewritten);
    expect(rewritten).not.toContain("bx--big-number__denominator");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Carbon Button for kind=tertiary", () => {
  test("drops the skeleton and tooltip and keeps the button", async () => {
    const dir = mkdtempSync(join(tmpdir(), "specialize-"));
    try {
      const file = join(dir, "App.svelte");
      const code = `<script>import { Button } from "carbon-components-svelte";</script>\n<Button kind="tertiary">Hi</Button>`;
      writeFileSync(file, code);
      const result = await analyzeFiles({
        library: CARBON,
        failure: PROP_AWARE_FAILURE,
        projectRoot: process.cwd(),
        files: [{ file, code }],
        components: ["Button"],
        options: {},
      });
      if ("warning" in result) throw new Error(result.warning);
      const scope = result.analysis.scopeFor("Button/Button.svelte");
      if (!scope) throw new Error("Button isn't live");
      const specialized = specializeComponent(scope);
      parse(specialized.code);
      expect(specialized.code).not.toContain("<ButtonSkeleton");
      expect(specialized.code).not.toContain("<PortalTooltip");
      expect(specialized.code).toContain("<button");
      expect(specialized.code).toContain(`"bx--btn--tertiary"`);
      expect(specialized.unrendered()).toContain("./ButtonSkeleton.svelte");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("destructuring and stores", () => {
  const GROUP = `<script>
  import { getContext } from "svelte";
  import { readable } from "svelte/store";
  export let invalid = false;
  const ctx = getContext("carbon:Group");
  const { invalid: groupInvalid, size = "md" } = ctx ?? { invalid: readable(false) };
  $: showInvalid = $groupInvalid || invalid;
</script>
{#if showInvalid}<p class="invalid">!</p>{/if}
<span class={size}>x</span>`;

  test("a destructured name reads its path, defaults included", () => {
    const code = specialize(GROUP);
    expect(code).toContain(`class={"md"}`);
  });

  test("a `readable` store with no group to provide one keeps its value", () => {
    expect(specialize(GROUP)).not.toContain(`class="invalid"`);
    expect(specialize(GROUP, { invalid: true })).toContain(`class="invalid"`);
  });

  test("a rest element, or a store something can set, stays unknown", () => {
    const rest = `<script>
  const { a, ...others } = { a: 1, b: 2 };
</script>
{#if others.b}<p class="b">b</p>{/if}<i>{a}</i>`;
    const code = specialize(rest);
    expect(code).toContain(`class="b"`);
    expect(code).toContain("<i>{1}</i>");

    const writable = `<script>
  import { writable } from "svelte/store";
  const open = writable(false);
</script>
{#if $open}<p class="open">open</p>{/if}`;
    expect(specialize(writable)).toContain(`class="open"`);
  });
});

describe("names a nested scope binds", () => {
  test("a parameter with a prop's name leaves the prop known", () => {
    const source = `<script>
  export let size = "sm";
  function label(size) {
    if (size === "lg") return "large";
    return "small";
  }
</script>
{#if size === "sm"}<p class="sm">{label("lg")}</p>{/if}`;
    const code = specialize(source);
    expect(code).toContain(`<p class="sm">`);
    expect(code).not.toContain("{#if size");
    // Inside the function, `size` is the parameter: left alone.
    expect(code).toContain(`if (size === "lg")`);
  });

  test("an `{#each}` context with a prop's name leaves the prop known", () => {
    const source = `<script>
  export let width = "100%";
  export let widths = ["50%", "75%"];
</script>
{#each widths as width}<span style:width>{width}</span>{/each}
{#if width === "100%"}<p class="full">full</p>{/if}`;
    const code = specialize(source);
    expect(code).not.toContain("{#if width");
    expect(code).toContain("{#each widths as width}");
  });

  test("`let:x={y}` binds `y`, not `x`", () => {
    const source = `<script>
  import Inner from "./Inner.svelte";
  export let direction = "bottom";
</script>
<Inner let:direction={actual}>{actual}</Inner>
{#if direction === "bottom"}<p class="bottom">bottom</p>{/if}`;
    expect(specialize(source)).not.toContain("{#if direction");
  });

  test("the markup's bindings with a prop's name leave the prop known", () => {
    const source = `<script>
  import Inner from "./Inner.svelte";
  export let size = "sm";
  export let promise = undefined;
</script>
{#snippet row(size)}<i>{size}</i>{/snippet}
{#await promise then size}<b>{size}</b>{/await}
<Inner let:size><u>{size}</u></Inner>
<Inner let:direction={size}><s>{size}</s></Inner>
<Inner>{@const size = 1}<em>{size}</em></Inner>
{#if size === "sm"}<p class="sm">sm</p>{/if}`;
    const code = specialize(source);
    expect(code).not.toContain("{#if size");
    // Each nested `size` is its own binding: left alone.
    for (const tag of ["i", "b", "u", "s"]) {
      expect(code).toContain(`<${tag}>{size}</${tag}>`);
    }
  });
});

/** What `name` can hold in `script`, rendered with `props`. */
function possibleValues(
  script: string,
  props: Record<string, unknown> = {},
  name = "a",
) {
  const model = buildComponentModel(
    `<script>\n${script}\n</script>\n{a}`,
    "X/X.svelte",
  );
  const usage = newComponentUsage();
  addCallSite(
    usage,
    {
      component: model.key,
      open: false,
      props: new Map(
        Object.entries(props).map(([k, v]) => [k, possible(v as boolean)]),
      ),
      slots: new Set(),
    },
    model.props.keys(),
    undefined,
  );
  const value = evaluate(
    { type: "Identifier", name } as Expression,
    createScope(model, usage, () => possible(undefined)),
  );
  return value === UNKNOWN ? "unknown" : [...value].sort();
}

describe("writes under `if` in `$:` statements", () => {
  const GATED = `export let a = false;\nexport let gate = false;`;

  test.each([
    [
      "a write whose condition can't hold",
      `$: if (gate) a = true;`,
      {},
      [false],
    ],
    [
      "a write whose condition can hold",
      `$: if (gate) a = true;`,
      { gate: true },
      [false, true],
    ],
    [
      "the `else` side",
      `$: if (gate) {} else { a = "x"; }`,
      { gate: true },
      [false],
    ],
    [
      "the `else` side, live",
      `$: if (gate) {} else { a = "x"; }`,
      {},
      [false, "x"],
    ],
    [
      "nested conditions",
      `$: if (gate) { if (!gate) a = true; }`,
      { gate: true },
      [false],
    ],
    [
      "a condition on the name itself",
      `$: if (!a) a = true;`,
      {},
      [false, true],
    ],
    [
      "a write of something unknown",
      `$: if (!gate) a = Math.random();`,
      {},
      "unknown",
    ],
    ["a write of an object", `$: if (!gate) a = {};`, {}, "unknown"],
    ["a write under `&&`", `$: !gate && (a = true);`, {}, "unknown"],
    [
      "a write in a loop",
      `$: if (!gate) for (const x of [1]) a = x;`,
      {},
      "unknown",
    ],
    [
      "another write in a handler",
      `$: if (gate) a = true;\nfunction f() { a = 1; }`,
      {},
      "unknown",
    ],
    ["`+=`", `$: if (!gate) a += 1;`, {}, "unknown"],
  ])("%s", (_, script, props, expected) => {
    expect(possibleValues(`${GATED}\n${script}`, props)).toEqual(expected);
  });

  test("a store's value stays unknown: other components may share it", () => {
    const script = `import { readable } from "svelte/store";\nconst s = readable(false);\n$: if (gate) $s = true;`;
    expect(possibleValues(`${GATED}\n${script}`, {}, "$s")).toBe("unknown");
  });

  test("a write whose condition can't hold is removed with its branch", () => {
    const code = specialize(
      `<script>
  export let expandable = false;
  export let batchExpansion = false;
  $: if (batchExpansion) {
    expandable = true;
  }
</script>
{#if expandable}<Expand />{/if}`,
    );
    expect(code).not.toContain("<Expand />");
    expect(code).not.toContain("expandable = true");
  });
});

describe("reading objects, keys and stores", () => {
  test.each([
    [
      "a lookup with each of several known keys",
      `export let k = "a";\nconst M = { a: "x", b: "y" };\n$: v = M[k];`,
      { k: "b" },
      ["y"],
    ],
    [
      "a lookup with a key that may be `undefined`",
      `export let k = "a";\nconst M = { a: "x" };\n$: v = k ? M[k] : "z";`,
      // Passing `undefined` falls back to the default: `k` is "a" or
      // `undefined`, and `M[undefined]` reads `M.undefined`.
      { k: undefined },
      ["x", "z", undefined],
    ],
    [
      "a lookup with an unknown key",
      `let k = "a";\nfunction f() { k = "b"; }\nconst M = { a: "x" };\n$: v = M[k];`,
      {},
      "unknown",
    ],
    [
      "an object read by an unknown key, read by a known one",
      `let k = "a";\nfunction f() { k = "b"; }\nconst M = { a: "x" };\n$: other = M[k];\n$: v = M.a;`,
      {},
      ["x"],
    ],
    [
      "a property of something that may be `undefined`",
      `let on = false;\nfunction f() { on = true; }\nconst o = on ? { a: "x" } : undefined;\n$: v = o?.a;`,
      {},
      ["x", undefined],
    ],
    [
      "a store that may be missing",
      `import { readable } from "svelte/store";\nlet on = false;\nfunction f() { on = true; }\nconst s = on ? readable("x") : undefined;\n$: v = $s;`,
      {},
      ["x", undefined],
    ],
    [
      "a store reached through an object",
      `import { readable } from "svelte/store";\nconst o = { s: readable("x") };\nconst s = o.s;\n$: v = $s;`,
      {},
      ["x"],
    ],
  ])("%s", (_, script, props, expected) => {
    expect(possibleValues(script, props, "v")).toEqual(expected);
  });
});

describe("calling functions", () => {
  test.each([
    [
      "an early `return` the argument decides",
      `export let size = undefined;\nfunction f(x) { if (!x) return "a"; return "b"; }\n$: v = f(size);`,
      {},
      ["a"],
    ],
    [
      "the rest of the body when it doesn't",
      `export let size = undefined;\nfunction f(x) { if (!x) return "a"; return "b"; }\n$: v = f(size);`,
      { size: "z" },
      ["b"],
    ],
    [
      "both sides of a test that can go either way",
      `let on = false;\nfunction g() { on = true; }\nfunction f() { if (on) return "a"; return "b"; }\n$: v = f();`,
      {},
      ["a", "b"],
    ],
    [
      "`if`/`else` that both return",
      `export let x = 1;\nfunction f(n) { if (n > 0) { return "pos"; } else { return "neg"; } }\n$: v = f(x);`,
      {},
      ["pos"],
    ],
    [
      "a `const` in the body",
      `export let x = "a";\nconst f = (s) => { const t = s + "!"; return t; };\n$: v = f(x);`,
      {},
      ["a!"],
    ],
    [
      "a destructured parameter with a default",
      `function f({ a, b = false }) { return b; }\n$: v = f({ a: 1 });`,
      {},
      [false],
    ],
    [
      "falling off the end",
      `export let x = false;\nfunction f(n) { if (n) return "a"; }\n$: v = f(x);`,
      {},
      [undefined],
    ],
    [
      "a reactive destructuring of the result",
      `export let invalid = false;\nfunction f({ invalid }) { return { show: invalid, other: 1 }; }\n$: ({ show: v } = f({ invalid }));`,
      {},
      [false],
    ],
    [
      "a statement it doesn't follow",
      `function f(n) { for (const i of [1]) {} return 1; }\n$: v = f(1);`,
      {},
      "unknown",
    ],
    [
      "an object the body changes",
      `function f(o) { const n = o.push(1); return o.length; }\n$: v = f([]);`,
      {},
      "unknown",
    ],
    [
      "recursion",
      `function f(n) { return f(n); }\n$: v = f(1);`,
      {},
      "unknown",
    ],
    [
      "a rest parameter",
      `function f(...all) { return 1; }\n$: v = f(1);`,
      {},
      "unknown",
    ],
    [
      "`arguments`",
      `function f() { return arguments[0]; }\n$: v = f(1);`,
      {},
      "unknown",
    ],
    [
      "a function the component reassigns",
      `let f = function (n) { return 1; };\nfunction g() { f = () => 2; }\n$: v = f(1);`,
      {},
      "unknown",
    ],
  ])("%s", (_, script, props, expected) => {
    expect(possibleValues(script, props, "v")).toEqual(expected);
  });
});
