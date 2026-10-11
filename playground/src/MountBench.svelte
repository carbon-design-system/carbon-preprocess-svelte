<script>
  // Mount cost per CCS component: 40 instances each, mounted, flushed, and
  // laid out, median of 3 runs. Results show in a table, and land in
  // #bench-results as JSON for scripts/mount-bench.ts.
  import { flushSync, mount, onMount, unmount } from "svelte";
  import {
    Button,
    Checkbox,
    CodeSnippet,
    ComboBox,
    DataTable,
    Dropdown,
    InlineLoading,
    MultiSelect,
    NumberInput,
    OverflowMenu,
    Search,
    Select,
    Tag,
    TextInput,
    Toggle,
  } from "carbon-components-svelte";

  const items = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), text: `Option ${i}` }));
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `Row ${i}`, port: 3000 + i }));
  const cases = [
    ["Button", Button, {}],
    ["Tag", Tag, {}],
    ["Checkbox", Checkbox, { labelText: "Label" }],
    ["Toggle", Toggle, { labelText: "Label" }],
    ["TextInput", TextInput, { labelText: "Label" }],
    ["Search", Search, {}],
    ["NumberInput", NumberInput, { label: "Label" }],
    ["Select (no options)", Select, { labelText: "Label" }],
    ["OverflowMenu", OverflowMenu, {}],
    ["CodeSnippet multi", CodeSnippet, { type: "multi", code: Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") }],
    ["Dropdown (3 items)", Dropdown, { titleText: "Label", items: items(3), selectedId: "0" }],
    ["ComboBox (3 items)", ComboBox, { titleText: "Label", items: items(3) }],
    ["ComboBox (500 items)", ComboBox, { titleText: "Label", items: items(500) }],
    ["MultiSelect (3 items)", MultiSelect, { titleText: "Label", items: items(3) }],
    ["DataTable (10 rows)", DataTable, { headers: [{ key: "name", value: "Name" }, { key: "port", value: "Port" }], rows }],
  ];

  let results = [];

  const pending = (format) => (value) => (value === undefined ? "–" : format(value));
  const resultHeaders = [
    { key: "name", value: "Component" },
    { key: "msPerInstance", value: "ms per instance", display: pending((ms) => ms.toFixed(3)) },
    { key: "nodesPerInstance", value: "Elements per instance", display: pending(String) },
  ];
  // Every row from the start, filled in as each is measured: the table's
  // height never changes, so nothing below it moves.
  $: resultRows = cases.map(([name]) => ({ id: name, name, ...results.find((r) => r.name === name) }));
  $: done = results.length === cases.length;

  function run(Component, props) {
    // Out of the page's flow and out of sight: mounting here lays out the
    // instances without moving anything on the page.
    const target = document.createElement("div");
    target.style.cssText = "position: fixed; top: 0; left: 0; width: 40rem; visibility: hidden; pointer-events: none;";
    document.body.append(target);
    const start = performance.now();
    const instances = [];
    for (let i = 0; i < 40; i++) instances.push(mount(Component, { target, props: { ...props } }));
    flushSync();
    target.offsetHeight; // layout
    const ms = performance.now() - start;
    const nodes = target.getElementsByTagName("*").length / 40;
    for (const instance of instances) unmount(instance);
    target.remove();
    return { ms, nodes };
  }

  onMount(async () => {
    for (const [name, Component, props] of cases) {
      run(Component, props); // warm up
      const runs = [run(Component, props), run(Component, props), run(Component, props)].sort((a, b) => a.ms - b.ms);
      results = [...results, { name, msPerInstance: +(runs[1].ms / 40).toFixed(3), nodesPerInstance: Math.round(runs[1].nodes) }];
      await new Promise((r) => setTimeout(r, 20));
    }
  });
</script>

<InlineLoading
  status={done ? "finished" : "active"}
  description={done ? `Measured ${cases.length} components` : `Measuring ${results.length + 1} of ${cases.length}…`}
/>
<div class="results">
  <DataTable size="compact" sortable headers={resultHeaders} rows={resultRows} />
</div>
<pre id="bench-results" hidden data-done={done || undefined}>{JSON.stringify(results)}</pre>

<style>
  /* Columns sized by the table, not by the numbers as they fill in. */
  .results :global(table) {
    table-layout: fixed;
  }
</style>
