import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CarbonSvelte, LOG_PREFIX } from "../constants";
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

/** Whether the installed `carbon-components-svelte` ships `Prose`. */
function hasProse(): boolean {
  const dir = resolvePackageDir(CarbonSvelte.Components);
  return (
    dir !== undefined && existsSync(path.join(dir, "src/Prose/Prose.svelte"))
  );
}

/**
 * Svelte markup preprocessor that converts Markdown files (`.md` by default)
 * to Svelte components at build time: plain HTML inside Carbon's `Prose`
 * (when the installed Carbon has it, unless `prose` says otherwise),
 * heading ids, and a `headings` export for `TableOfContents`. Svelte markup
 * in the Markdown passes through as written.
 *
 * Add the extension to `extensions` in `svelte.config.js`, and list this
 * before `optimizeImports` so the imports it adds are rewritten too.
 */
export function markdown(options: MarkdownOptions = {}) {
  const extensions = options.extensions ?? [".md"];
  let svelte = options.svelte;
  let prose = options.prose;
  let proseChecked: boolean | undefined;

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
      if (proseChecked === undefined) {
        proseChecked = hasProse();
        if (prose === undefined) {
          // Unset: use Prose when the installed Carbon has it, else plain HTML.
          prose = proseChecked;
        } else if (prose !== false && !proseChecked) {
          console.warn(
            `${LOG_PREFIX} markdown: the installed ${CarbonSvelte.Components} has no Prose; set \`prose: false\` or upgrade it.`,
          );
        }
      }
      const { code } = await compileMarkdown(content, {
        ...options,
        svelte,
        prose,
        filename,
      });
      return { code };
    },
  };
}
