<script lang="ts">
  import {
    Button,
    Column,
    ComposedModal,
    Grid,
    ModalBody,
    ModalFooter,
    ModalHeader,
    PaginationNav,
    Row,
    SkeletonText,
    ToastNotification,
  } from "carbon-components-svelte";
  import { onMount } from "svelte";
  import Filters from "./Filters.svelte";
  import { addToCart, cart, cartTotal } from "./lib/cart.svelte";
  import {
    fetchProducts,
    formatPrice,
    MAX_PRICE,
    type Product,
  } from "./lib/catalog";
  import ProductCard from "./ProductCard.svelte";

  const PER_PAGE = 6;

  let products: Product[] = $state([]);
  let loading = $state(true);
  let query = $state("");
  let categories: string[] = $state([]);
  let brand: string | undefined = $state();
  let maxPrice = $state(MAX_PRICE);
  let inStockOnly = $state(false);
  let page = $state(0);
  let cartOpen = $state(false);
  let added: string | undefined = $state();

  onMount(async () => {
    products = await fetchProducts();
    loading = false;
  });

  const filtered = $derived(
    products.filter(
      (product) =>
        product.name.toLowerCase().includes(query.toLowerCase()) &&
        (categories.length === 0 || categories.includes(product.category)) &&
        (!brand || product.brand === brand) &&
        product.price <= maxPrice &&
        (!inStockOnly || product.inStock),
    ),
  );
  const pageCount = $derived(
    Math.max(1, Math.ceil(filtered.length / PER_PAGE)),
  );
  const visible = $derived(
    filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE),
  );

  function add(product: Product, quantity: number) {
    addToCart(product, quantity);
    added = product.name;
  }
</script>

<Grid>
  <Row>
    <Column><h1>Shop</h1></Column>
    <Column>
      <Button
        kind="ghost"
        on:click={() => (cartOpen = true)}
      >
        Cart ({cart.lines.length})
      </Button>
    </Column>
  </Row>
  <Row>
    <Column
      sm={4}
      md={2}
      lg={4}
    >
      <Filters
        bind:query
        bind:categories
        bind:brand
        bind:maxPrice
        bind:inStockOnly
      />
    </Column>
    <Column
      sm={4}
      md={6}
      lg={12}
    >
      {#if loading}
        <SkeletonText
          paragraph
          lines={6}
        />
      {:else if filtered.length === 0}
        <p>No products match these filters.</p>
      {:else}
        <Row>
          {#each visible as product (product.id)}
            <Column
              sm={4}
              md={4}
              lg={4}
            >
              <ProductCard
                {product}
                onadd={add}
              />
            </Column>
          {/each}
        </Row>
        <PaginationNav
          bind:page
          total={pageCount}
        />
      {/if}
    </Column>
  </Row>
</Grid>

<ComposedModal
  bind:open={cartOpen}
  size="sm"
>
  <ModalHeader title="Your cart" />
  <ModalBody>
    {#each cart.lines as line (line.product.id)}
      <p>{line.quantity} × {line.product.name}</p>
    {:else}
      <p>Your cart is empty.</p>
    {/each}
    <p>Total: {formatPrice(cartTotal())}</p>
  </ModalBody>
  <ModalFooter
    primaryButtonText="Check out"
    primaryButtonDisabled={cart.lines.length === 0}
    secondaryButtonText="Keep shopping"
  />
</ComposedModal>

{#if added}
  <ToastNotification
    kind="success"
    title="Added to cart"
    subtitle={added}
    timeout={3000}
    on:close={() => (added = undefined)}
  />
{/if}
