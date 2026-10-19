<script>
  /**
   * What `optimizeImports` rewrites in each file: its Carbon imports before
   * and after, as a diff, one row per file.
   */
  import { DataTable } from "carbon-components-svelte";
  import report from "virtual:build-report";
  import CodeView from "../CodeView.svelte";

  const headers = [
    { key: "file", value: "File" },
    { key: "count", value: "Statements rewritten" },
  ];
  // Imports it leaves alone (already a direct path) are context, not a change.
  const rows = report.imports.map((i) => ({
    id: i.file,
    ...i,
    count: i.before.filter((line) => !i.after.includes(line)).length,
  }));
  const diff = (row) =>
    [
      ...row.before.filter((line) => row.after.includes(line)).map((line) => `  ${line}`),
      ...row.before.filter((line) => !row.after.includes(line)).map((line) => `- ${line}`),
      ...row.after.filter((line) => !row.before.includes(line)).map((line) => `+ ${line}`),
    ].join("\n");
</script>

<DataTable size="compact" sortable expandable {headers} {rows}>
  <svelte:fragment slot="expandedRow" let:row>
    <CodeView code={diff(row)} lang="diff-js" maxCollapsedLines={Infinity} />
  </svelte:fragment>
</DataTable>
