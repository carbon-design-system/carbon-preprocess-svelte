import { readFileSync } from "node:fs";
import path from "node:path";
import { resolvePackageDir } from "../indexer/resolve-carbon-root";
import { compileMarkdown, type MarkdownOptions } from "../markdown/compile";

const NODE_MODULES_REGEX = /[\\/]node_modules[\\/]/;

/** The installed Svelte's major version, read from its `package.json`. */
function detectSvelteMajor(): 3 | 4 | 5 {
  const dir = resolvePackageDir("svelte");
  if (!dir) return 5;
  try {
    const { version } = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as { version: string };
    const major = Number.parseInt(version, 10);
    return major === 3 || major === 4 ? major : 5;
  } catch {
    return 5;
  }
}

/**
 * Svelte markup preprocessor that converts Markdown files (`.md` by default)
 * to Svelte components at build time: plain HTML inside Carbon's `Prose`,
 * heading ids, and a `headings` export for `TableOfContents`. Svelte markup
 * in the Markdown passes through as written.
 *
 * Add the extension to `extensions` in `svelte.config.js`, and list this
 * before `optimizeImports` so the imports it adds are rewritten too.
 */
export function markdown(options: MarkdownOptions = {}) {
  const extensions = options.extensions ?? [".md"];
  let svelte = options.svelte;

  return {
    name: "carbon:markdown",
    async markup({
      content,
      filename,
    }: {
      content: string;
      filename?: string;
    }) {
      if (!filename || NODE_MODULES_REGEX.test(filename)) return;
      if (!extensions.some((extension) => filename.endsWith(extension))) return;
      svelte ??= detectSvelteMajor();
      const { code } = await compileMarkdown(content, {
        ...options,
        svelte,
        filename,
      });
      return { code };
    },
  };
}
