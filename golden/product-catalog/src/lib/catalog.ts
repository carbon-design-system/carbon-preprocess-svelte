export type Product = {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  inStock: boolean;
  onSale: boolean;
  description: string;
};

export const CATEGORIES = [
  { id: "audio", text: "Audio" },
  { id: "laptops", text: "Laptops" },
  { id: "phones", text: "Phones" },
];

export const BRANDS = [
  { id: "acme", text: "Acme" },
  { id: "globex", text: "Globex" },
  { id: "initech", text: "Initech" },
];

export const MAX_PRICE = 3000;

const PRODUCTS: Product[] = [
  {
    id: "p1",
    name: "Studio headphones",
    brand: "acme",
    category: "audio",
    price: 249,
    inStock: true,
    onSale: true,
    description: "Closed-back, 40 hours of battery.",
  },
  {
    id: "p2",
    name: "Ultrabook 14",
    brand: "globex",
    category: "laptops",
    price: 1499,
    inStock: false,
    onSale: false,
    description: "14-inch display, 1.1 kg.",
  },
  {
    id: "p3",
    name: "Pocket phone",
    brand: "initech",
    category: "phones",
    price: 699,
    inStock: true,
    onSale: false,
    description: "Small, light, and fast.",
  },
];

/** Stands in for `fetch("/api/products")`. */
export async function fetchProducts(): Promise<Product[]> {
  await new Promise((resolve) => setTimeout(resolve, 10));
  return PRODUCTS;
}

export const formatPrice = (price: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    price,
  );
