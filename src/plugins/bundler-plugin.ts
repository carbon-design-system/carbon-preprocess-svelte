/**
 * What `optimizeCss` and `optimizeComponents` return: a Vite, Rollup and
 * Rolldown plugin. Declared here, not imported from `vite`, so the published
 * types need no bundler installed (a webpack project has none of these).
 */
export type BundlerPlugin = { name: string };
