<script lang="ts">
  import { Tag, Tile } from "carbon-components-svelte";

  type Trend = "up" | "down" | "flat";

  let {
    label,
    value,
    trend = "flat",
    loading = false,
  }: {
    label: string;
    value: string;
    trend?: Trend;
    loading?: boolean;
  } = $props();

  const tagType = $derived(
    trend === "up" ? "green" : trend === "down" ? "red" : "gray",
  );
</script>

<Tile>
  <p class="label">{label}</p>
  {#if loading}
    <p class="value">…</p>
  {:else}
    <p class="value">{value}</p>
  {/if}
  <Tag
    type={tagType}
    size="sm"
    >{trend}</Tag
  >
</Tile>

<style>
  .label {
    font-size: 0.875rem;
  }

  .value {
    font-size: 2rem;
  }
</style>
