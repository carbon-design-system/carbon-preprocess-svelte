<script lang="ts">
  import {
    ComboBox,
    MultiSelect,
    Search,
    Slider,
    Toggle,
  } from "carbon-components-svelte";
  import { BRANDS, CATEGORIES, MAX_PRICE } from "./lib/catalog";

  let {
    query = $bindable(""),
    categories = $bindable([]),
    brand = $bindable(),
    maxPrice = $bindable(MAX_PRICE),
    inStockOnly = $bindable(false),
  }: {
    query?: string;
    categories?: string[];
    brand?: string;
    maxPrice?: number;
    inStockOnly?: boolean;
  } = $props();
</script>

<Search
  placeholder="Search products"
  bind:value={query}
/>
<MultiSelect
  labelText="Category"
  label="Any category"
  items={CATEGORIES}
  bind:selectedIds={categories}
/>
<ComboBox
  labelText="Brand"
  placeholder="Any brand"
  items={BRANDS}
  bind:selectedId={brand}
/>
<Slider
  labelText="Maximum price"
  min={0}
  max={MAX_PRICE}
  step={50}
  bind:value={maxPrice}
/>
<Toggle
  labelText="In stock only"
  bind:toggled={inStockOnly}
/>
