/**
 * Apps that render Carbon through their own wrapper components, for
 * `eval-specialize.ts`: each wrapper is rendered from a few call sites
 * with random props, so `optimizeComponents` rewrites it for exactly
 * those, along with the Carbon components it renders.
 */

const IMPORT = (names: string) =>
  `import { ${names} } from "carbon-components-svelte";`;

type Prop = { name: string; values: string[] };

type Wrapper = {
  name: string;
  code: string;
  components: string[];
  props: Prop[];
  /** Content to pass between the tags, or `""` for none. */
  children: string[];
  runes?: boolean;
};

const WRAPPERS: Wrapper[] = [
  {
    name: "Card",
    code: `<script>
  ${IMPORT("Button, InlineNotification, Tag")}
  export let tone = "neutral";
  export let label = "Go";
  export let icon = false;
  export let note = "";
  export let items = [];
  $: kind = tone === "danger" ? "danger" : tone === "quiet" ? "ghost" : "primary";
</script>

<div class="card" class:card--icon={icon}>
  {#if icon}<Tag type="blue">icon</Tag>{/if}
  <Button {kind} size={tone === "quiet" ? "small" : undefined}>{label}</Button>
  {#if note}
    <InlineNotification kind={tone === "danger" ? "error" : "info"} title={note} />
  {:else}
    <p>no note</p>
  {/if}
  {#each items as item}<span>{item}</span>{:else}<em>empty</em>{/each}
  <slot />
</div>

<style>
  .card--icon {
    padding: 1rem;
  }
</style>
`,
    components: ["Button", "InlineNotification", "Tag"],
    props: [
      { name: "tone", values: [`"neutral"`, `"danger"`, `"quiet"`] },
      { name: "label", values: [`"Save"`, `{"Delete"}`] },
      { name: "icon", values: ["", "={true}", "={false}"] },
      { name: "note", values: [`""`, `"Saved"`] },
      { name: "items", values: ["{[]}", `{["a", "b"]}`] },
    ],
    children: ["", "Body"],
  },
  {
    name: "Field",
    code: `<script>
  ${IMPORT("TextInput")}
  export let required = false;
  export let hint = undefined;
</script>

<TextInput
  {...$$restProps}
  invalid={required && !$$restProps.value}
  invalidText={required ? "Required" : ""}
/>
{#if hint}<p class="hint">{hint}</p>{/if}
{#if required}<span>*</span>{/if}
`,
    components: ["TextInput"],
    props: [
      { name: "required", values: ["", "={false}"] },
      { name: "hint", values: [`"Your name"`] },
      { name: "labelText", values: [`"Name"`, `"Email"`] },
      { name: "value", values: [`"Ada"`, `""`] },
      { name: "size", values: [`"sm"`, `"xl"`] },
    ],
    children: [""],
  },
  {
    name: "Action",
    runes: true,
    code: `<script>
  ${IMPORT("Button, Tag")}
  let { tone = "neutral", label = "Go", icon = false, children, ...rest } = $props();
  let kind = $derived(tone === "danger" ? "danger" : "ghost");
  let count = $state(0);
</script>

{#if icon}<Tag type="blue">icon</Tag>{/if}
<Button {kind} {...rest} onclick={() => count++}>{label} {count}</Button>
{#if children}{@render children()}{/if}
`,
    components: ["Button", "Tag"],
    props: [
      { name: "tone", values: [`"neutral"`, `"danger"`] },
      { name: "label", values: [`"Save"`] },
      { name: "icon", values: ["", "={false}"] },
      { name: "size", values: [`"small"`, `"field"`] },
      { name: "disabled", values: ["", "={false}"] },
    ],
    children: ["", "Body"],
  },
];

/**
 * Apps whose own components render themselves, each under a guard its call
 * sites decide: a rewrite that loses a call site folds the guard and
 * renders forever, or (with `unwrap`) leaves `<svelte:self>` outside a
 * block. `icon` is never passed, so each rewrite has something to remove.
 */
const RECURSIVE: Array<{
  name: string;
  files: Record<string, string>;
  components: string[];
  runes?: boolean;
}> = [
  {
    name: "<svelte:self> with no imports",
    components: [],
    files: {
      "Tree.svelte": `<script>export let depth = 0; export let icon = false;</script>
{#if icon}<i>icon</i>{/if}
{#if depth === 0}<h1>root</h1>{:else}<h2>{depth}</h2>{/if}
{#if depth < 2}<svelte:self depth={depth + 1} />{/if}`,
    },
  },
  {
    name: "<svelte:self> with a string that grows",
    components: [],
    files: {
      "Tree.svelte": `<script>export let prefix = ""; export let icon = false;</script>
{#if icon}<i>icon</i>{/if}<p>{prefix}</p>
{#if prefix.length < 3}<svelte:self prefix={prefix + "-"} />{/if}`,
    },
  },
  {
    name: "<svelte:self> spreading its props",
    components: ["Tag"],
    files: {
      "Tree.svelte": `<script>${IMPORT("Tag")} export let depth = 0; export let label = "x"; export let icon = false;</script>
{#if icon}<i>icon</i>{/if}
<Tag type={depth === 0 ? "blue" : "red"}>{label}{depth}</Tag>
{#if depth < 2}<svelte:self {...$$props} depth={depth + 1} />{/if}`,
    },
  },
  {
    name: "<svelte:self> over data, in a slot",
    components: ["Tag"],
    files: {
      "Tree.svelte": `<script>${IMPORT("Tag")} import Box from "./Box.svelte"; export let node = { name: "a", children: [{ name: "b", children: [] }] }; export let icon = false;</script>
{#if icon}<i>icon</i>{/if}
<Box><Tag type={node.children.length ? "blue" : "gray"}>{node.name}</Tag>{#each node.children as child}<svelte:self node={child} />{/each}</Box>`,
      "Box.svelte": `<div class="box"><slot /></div>`,
    },
  },
  {
    name: "importing itself",
    components: ["Tag"],
    files: {
      "Tree.svelte": `<script>${IMPORT("Tag")} import Tree from "./Tree.svelte"; export let depth = 0; export let icon = false;</script>
{#if icon}<i>icon</i>{/if}
<Tag type={depth === 0 ? "blue" : "red"}>{depth}</Tag>
{#if depth < 2}<Tree depth={depth + 1} />{/if}`,
    },
  },
  {
    name: "two components rendering each other",
    components: [],
    files: {
      "Tree.svelte": `<script>import Branch from "./Branch.svelte"; export let n = 0; export let icon = false;</script>
{#if icon}<i>icon</i>{/if}
{#if n === 0}<h1>a0</h1>{:else}<h2>a{n}</h2>{/if}
{#if n < 3}<Branch n={n + 1} />{/if}`,
      "Branch.svelte": `<script>import Tree from "./Tree.svelte"; export let n = 0;</script>
{#if n === 1}<h3>b1</h3>{:else}<h4>b{n}</h4>{/if}
{#if n < 3}<Tree n={n + 1} />{/if}`,
    },
  },
  {
    name: "importing itself, with runes",
    components: ["Tag"],
    runes: true,
    files: {
      "Tree.svelte": `<script>${IMPORT("Tag")} import Tree from "./Tree.svelte"; let { depth = 0, icon = false } = $props();</script>
{#if icon}<i>icon</i>{/if}
<Tag type={depth === 0 ? "blue" : "red"}>{depth}</Tag>
{#if depth < 2}<Tree depth={depth + 1} />{/if}`,
    },
  },
];

export type WrapperCase = {
  id: string;
  /** Carbon components the app bundles. */
  components: string[];
  /** `App.svelte`, then the wrapper. */
  files: Record<string, string>;
};

/**
 * `count` apps per wrapper, each with one to three call sites, and one app
 * per `RECURSIVE` shape.
 */
export function wrapperCases(options: {
  count: number;
  seed: number;
  /** Include wrappers written with runes (Svelte 5). */
  runes: boolean;
}): WrapperCase[] {
  let seed = options.seed;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];

  const cases: WrapperCase[] = [];
  for (const wrapper of WRAPPERS) {
    if (wrapper.runes && !options.runes) continue;
    for (let i = 0; i < options.count; i++) {
      const sites = Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
        const attributes = wrapper.props
          .filter(() => random() < 0.5)
          .map((prop) => {
            const value = pick(prop.values);
            return value === "" || value.startsWith("=")
              ? `${prop.name}${value}`
              : `${prop.name}=${value}`;
          })
          .join(" ");
        const children = pick(wrapper.children);
        return children
          ? `<${wrapper.name} ${attributes}>${children}</${wrapper.name}>`
          : `<${wrapper.name} ${attributes} />`;
      });
      cases.push({
        id: `wrapper/${wrapper.name}/${i}: ${sites.join(" ")}`,
        components: wrapper.components,
        files: {
          "App.svelte": `<script>\n  import ${wrapper.name} from "./${wrapper.name}.svelte";\n</script>\n\n${sites.join("\n")}\n`,
          [`${wrapper.name}.svelte`]: wrapper.code,
        },
      });
    }
  }
  for (const recursive of RECURSIVE) {
    if (recursive.runes && !options.runes) continue;
    cases.push({
      id: `recursive: ${recursive.name}`,
      components: recursive.components,
      files: {
        "App.svelte": `<script>\n  import Tree from "./Tree.svelte";\n</script>\n\n<Tree />\n`,
        ...recursive.files,
      },
    });
  }
  return cases;
}
