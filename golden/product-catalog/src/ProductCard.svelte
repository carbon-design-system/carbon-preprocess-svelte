<script lang="ts">
  import { Button, NumberInput, Tag, Tile } from "carbon-components-svelte";
  import { formatPrice, type Product } from "./lib/catalog";

  let {
    product,
    compact = false,
    onadd,
  }: {
    product: Product;
    compact?: boolean;
    onadd: (product: Product, quantity: number) => void;
  } = $props();

  let quantity = $state(1);
</script>

<Tile>
  <h3>{product.name}</h3>
  {#if product.onSale}
    <Tag
      type="red"
      size="sm"
      >Sale</Tag
    >
  {/if}
  {#if !product.inStock}
    <Tag
      type="gray"
      size="sm"
      >Out of stock</Tag
    >
  {/if}
  {#if !compact}
    <p>{product.description}</p>
  {/if}
  <p class="price">{formatPrice(product.price)}</p>
  <NumberInput
    labelText="Quantity"
    hideLabel
    size="sm"
    min={1}
    max={10}
    bind:value={quantity}
    disabled={!product.inStock}
  />
  <Button
    size="small"
    disabled={!product.inStock}
    on:click={() => onadd(product, quantity ?? 1)}
  >
    Add to cart
  </Button>
</Tile>

<style>
  .price {
    font-weight: 600;
  }
</style>
