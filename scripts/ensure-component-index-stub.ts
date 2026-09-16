import { existsSync } from "node:fs";

/**
 * `src/component-index.ts` is gitignored, so on a fresh checkout it doesn't
 * exist yet. `index-components.ts` regenerates it, but reaches
 * `component-index-registry.ts` (via extract-css-context ->
 * css-splice-optimizer -> strict-css-optimizer) along the way, which
 * statically imports "./component-index". Bun links a module's entire
 * static import graph before evaluating any of it, so that missing file
 * would fail the regeneration script before it ever runs. Write an empty
 * placeholder first so linking succeeds; index-components.ts overwrites it
 * with the real index immediately after.
 */
if (!existsSync("src/component-index.ts")) {
  await Bun.write(
    "src/component-index.ts",
    "export const components: Record<string, { path: string; classes: string[] }> = {};\n",
  );
}
