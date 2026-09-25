import { buildComponentIndex } from "carbon-preprocess-svelte/indexer/build-index";

/**
 * Index of the `carbon-components-svelte` devDependency, built the same way
 * the plugins build it for a consuming project.
 */
export const components = await buildComponentIndex();
