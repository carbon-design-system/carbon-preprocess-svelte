declare module "*.md" {
  import type { MarkdownHeading } from "carbon-preprocess-svelte";
  import type { Component } from "svelte";

  export const headings: MarkdownHeading[];
  export const metadata: Record<string, unknown>;
  const component: Component;
  export default component;
}
