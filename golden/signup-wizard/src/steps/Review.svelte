<script>
  import {
    InlineNotification,
    StructuredList,
    StructuredListBody,
    StructuredListCell,
    StructuredListRow,
  } from "carbon-components-svelte";
  import { COUNTRIES } from "../config.js";

  export let values;

  $: country = COUNTRIES.find((item) => item.id === values.country)?.text;
  $: rows = [
    ["Email", values.email],
    ["Name", values.name],
    ["Company", values.company || "None"],
    ["Country", country ?? "Not set"],
    ["Plan", values.plan],
  ];
</script>

<InlineNotification
  kind="info"
  lowContrast
  hideCloseButton
  title="Almost done"
  subtitle="Check your details before creating the account."
/>
<StructuredList condensed>
  <StructuredListBody>
    {#each rows as [label, value]}
      <StructuredListRow>
        <StructuredListCell noWrap>{label}</StructuredListCell>
        <StructuredListCell>{value}</StructuredListCell>
      </StructuredListRow>
    {/each}
  </StructuredListBody>
</StructuredList>
