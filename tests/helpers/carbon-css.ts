import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Load Carbon's pre-compiled theme CSS from `carbon-components-svelte`.
 * Resolves through `package.json` because the package `exports` map blocks `css/*`.
 * Any theme works for selector coverage; colors differ but selectors do not.
 */
export function resolveCarbonCss(theme = "white"): string {
  const pkg = require.resolve("carbon-components-svelte/package.json");
  const cssPath = join(dirname(pkg), "css", `${theme}.css`);

  if (!existsSync(cssPath)) {
    throw new Error(
      `Carbon CSS not found at ${cssPath}. Run \`bun install\` so ` +
        "`carbon-components-svelte` is available before running these tests.",
    );
  }

  return readFileSync(cssPath, "utf-8");
}
