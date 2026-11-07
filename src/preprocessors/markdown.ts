import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { requirePackageDir } from "severan/internal";
import { CarbonSvelte, LOG_PREFIX } from "../constants";
import { carbonCodeIcon } from "../markdown/code-icons";
import {
  compileMarkdown,
  type ImageOptions,
  type MarkdownOptions,
} from "../markdown/compile";
import { type ImageSize, imageSize } from "../markdown/image-size";

/** Directory of the installed package `name`, or `undefined` when it isn't. */
function resolvePackageDir(name: string): string | undefined {
  try {
    return requirePackageDir(name);
  } catch {
    return undefined;
  }
}

const NODE_MODULES_REGEX = /[\\/]node_modules[\\/]/;
// `https:`, `data:`, `//cdn…`, or a Svelte expression: not a local file.
const NOT_LOCAL = /^(?:[a-z][a-z\d+.-]*:|\/\/|\{)/i;
const QUERY_OR_HASH = /[?#].*$/;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;
const CODE_SPAN = /(`+)[\s\S]*?\1/g;
// An HTML tag in the text with a quoted `on…` attribute: `<button onclick="…">`.
const STRING_HANDLER = /<[A-Za-z][\w:-]*\b[^>]*?\s(on[a-z]+)\s*=\s*["']/;

/**
 * Raw HTML event handlers written as strings, which Svelte rejects
 * ("Event attribute must be a JavaScript expression"): each as a line
 * number and attribute name, skipping fenced code and code spans.
 */
function stringHandlers(content: string): { line: number; name: string }[] {
  const found: { line: number; name: string }[] = [];
  let fence: string | undefined;
  for (const [index, line] of content.split("\n").entries()) {
    const marker = FENCE_LINE.exec(line)?.[1];
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length)
        fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    const name = STRING_HANDLER.exec(line.replace(CODE_SPAN, ""))?.[1];
    if (name) found.push({ line: index + 1, name });
  }
  return found;
}

const sizes = new Map<string, { mtime: number; size: ImageSize | undefined }>();

/** The size of a local image a Markdown file refers to, cached by modification time. */
function localImageSize(
  src: string,
  filename: string,
  root: string | undefined,
): ImageSize | undefined {
  if (NOT_LOCAL.test(src)) return undefined;
  const clean = decodeURI(src.replace(QUERY_OR_HASH, ""));
  const file = clean.startsWith("/")
    ? root && path.resolve(root, `.${clean}`)
    : path.resolve(path.dirname(filename), clean);
  if (!file) return undefined;
  try {
    const mtime = statSync(file).mtimeMs;
    const cached = sizes.get(file);
    if (cached?.mtime === mtime) return cached.size;
    const size = imageSize(readFileSync(file));
    sizes.set(file, { mtime, size });
    return size;
  } catch {
    return undefined;
  }
}

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
/** Whether `carbon-components-svelte` (installed, or at `carbonDir`) ships `Prose`. */
function hasProse(carbonDir?: string): boolean {
  const dir = carbonDir ?? resolvePackageDir(CarbonSvelte.Components);
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
  // Carbon icons in code block headers, when the package is installed.
  const codeIcons =
    options.codeIcons ??
    (resolvePackageDir("carbon-icons-svelte") ? carbonCodeIcon : false);

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
        proseChecked = hasProse(options.carbonDir);
        if (prose === undefined) {
          // Unset: use Prose when the installed Carbon has it, else plain HTML.
          prose = proseChecked;
        } else if (prose !== false && !proseChecked) {
          console.warn(
            options.carbonDir
              ? `${LOG_PREFIX} markdown: the ${CarbonSvelte.Components} at ${options.carbonDir} has no Prose; set \`prose: false\` or point \`carbonDir\` at one that does.`
              : `${LOG_PREFIX} markdown: the installed ${CarbonSvelte.Components} has no Prose; set \`prose: false\` or upgrade it.`,
          );
        }
      }
      const configured = options.images;
      const images: false | ImageOptions =
        configured === false
          ? false
          : {
              ...configured,
              size:
                configured?.size ??
                ((src) => localImageSize(src, filename, configured?.root)),
            };
      // Svelte's own error names the compiled line; this names the source's.
      for (const { line, name } of stringHandlers(content)) {
        console.warn(
          `${LOG_PREFIX} markdown: ${path.relative(process.cwd(), filename)}:${line}: \`${name}="…"\` is a string; Svelte needs an expression, as in \`${name}={() => …}\`.`,
        );
      }
      const { code } = await compileMarkdown(content, {
        ...options,
        images,
        codeIcons,
        svelte,
        prose,
        filename,
      });
      return { code };
    },
  };
}
