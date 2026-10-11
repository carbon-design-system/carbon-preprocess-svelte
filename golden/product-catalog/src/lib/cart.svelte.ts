import type { Product } from "./catalog";

export type CartLine = { product: Product; quantity: number };

/** The cart, shared by every component that imports it. */
export const cart = $state<{ lines: CartLine[] }>({ lines: [] });

export function addToCart(product: Product, quantity: number) {
  const line = cart.lines.find((item) => item.product.id === product.id);
  if (line) line.quantity += quantity;
  else cart.lines.push({ product, quantity });
}

export function cartTotal() {
  return cart.lines.reduce(
    (sum, line) => sum + line.product.price * line.quantity,
    0,
  );
}
