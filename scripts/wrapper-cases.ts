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

export type WrapperCase = {
  id: string;
  /** Carbon components the app bundles. */
  components: string[];
  /** `App.svelte`, then the wrapper. */
  files: Record<string, string>;
};

/** `count` apps per wrapper, each with one to three call sites. */
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
  return cases;
}
