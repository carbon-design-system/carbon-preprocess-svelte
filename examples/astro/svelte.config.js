import { vitePreprocess } from "@astrojs/svelte";
import { optimizeImports } from "carbon-preprocess-svelte";

export default { preprocess: [vitePreprocess(), optimizeImports()] };
