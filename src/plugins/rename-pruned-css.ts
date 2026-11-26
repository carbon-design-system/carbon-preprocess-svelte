import { createHash } from "node:crypto";
import path from "node:path";
import type { Rollup } from "vite";
import { toCssString } from "../utils";

type Context = Partial<Pick<Rollup.PluginContext, "emitFile">>;

const PLACEHOLDER = /(\[[a-z]+(?::\d+)?\])/;
const HASH = /^\[hash(?::(\d+))?\]$/;
// Only HTML and CSS assets can link a CSS file, so only
// they're rewritten.
const RE_TEXT_ASSET = /\.(?:html?|css)$/;
const RE_REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

// What Rollup and Rolldown use when the pattern doesn't set a `[hash]`
// length, so a name matches as they wrote it.
const DEFAULT_HASH_LENGTH = 8;

function placeholderPattern(part: string): string {
  const hash = HASH.exec(part);
  if (hash) return `([\\w-]{${hash[1] ?? DEFAULT_HASH_LENGTH}})`;
  if (part === "[name]") return ".+";
  if (part === "[extname]") return "\\.[^/.]+";
  if (part === "[ext]") return "[^/.]+";
  return ".*";
}

// `undefined` if `assetFileNames` didn't name it with a hash, since an
// asset a plugin emitted with a fixed `fileName` keeps that name. Only the
// hash changes, since an asset several sources were merged into can have
// several `names`.
function rehashedName(
  asset: Rollup.OutputAsset,
  assetFileNames: Rollup.NormalizedOutputOptions["assetFileNames"],
  css: string,
): string | undefined {
  const pattern =
    typeof assetFileNames === "function"
      ? assetFileNames({
          ...asset,
          originalFileName: asset.originalFileName ?? undefined,
        })
      : assetFileNames;
  if (typeof pattern !== "string") return undefined;
  const parts = pattern.split(PLACEHOLDER);
  if (!parts.some((part) => HASH.test(part))) return undefined;
  const source = parts
    .map((part, i) =>
      i % 2 === 1
        ? placeholderPattern(part)
        : part.replace(RE_REGEXP_SPECIAL, "\\$&"),
    )
    .join("");
  const match = new RegExp(`^${source}$`).exec(asset.fileName);
  if (!match) return undefined;
  const digest = createHash("sha256").update(css).digest("base64url");
  // Only each group, a hash, is replaced; the text between them is kept as
  // it was.
  let renamed = "";
  let at = 0;
  for (let group = 1; group < match.length; group++) {
    const hash = match[group];
    const start = asset.fileName.indexOf(hash, at);
    renamed += asset.fileName.slice(at, start) + digest.slice(0, hash.length);
    at = start + hash.length;
  }
  return renamed + asset.fileName.slice(at);
}

// In chunks, Vite's metadata, and HTML and CSS assets, since each can
// name a CSS file.
function rewriteReferences(
  bundle: Rollup.OutputBundle,
  renames: ReadonlyMap<string, string>,
): void {
  const bases = [...renames].map(
    ([from, to]) =>
      [path.posix.basename(from), path.posix.basename(to)] as const,
  );
  const rewrite = (text: string) => {
    let result = text;
    for (const [from, to] of bases) {
      if (result.includes(from)) result = result.replaceAll(from, to);
    }
    return result;
  };
  const renameIn = (files: Set<string> | undefined) => {
    for (const [from, to] of renames) {
      if (files?.delete(from)) files.add(to);
    }
  };

  for (const file of Object.values(bundle)) {
    if (file.type === "chunk") {
      file.code = rewrite(file.code);
      const meta = file.viteMetadata;
      renameIn(meta?.importedCss);
      renameIn(meta?.importedAssets);
    } else if (RE_TEXT_ASSET.test(file.fileName)) {
      const text = toCssString(file.source);
      const next = rewrite(text);
      if (next !== text) file.source = next;
    }
  }
}

// An asset whose name holds a hash of its content gets a new name hashed
// from the pruned CSS, and every chunk and HTML or CSS asset naming it is
// updated, so a cached file is never reused for different CSS.
export function writePrunedCss(
  context: Context,
  bundle: Rollup.OutputBundle,
  pruned: ReadonlyMap<string, string>,
  assetFileNames: Rollup.NormalizedOutputOptions["assetFileNames"] | undefined,
): void {
  const renames = new Map<string, string>();
  for (const [fileName, css] of pruned) {
    const asset = bundle[fileName];
    if (asset?.type !== "asset") continue;
    const renamed =
      assetFileNames === undefined
        ? undefined
        : rehashedName(asset, assetFileNames, css);
    if (!context.emitFile || renamed === undefined || renamed === fileName) {
      asset.source = css;
      continue;
    }
    delete bundle[fileName];
    // Called as a method: Rolldown's needs its `this`.
    context.emitFile({
      type: "asset",
      fileName: renamed,
      name: asset.names?.[0] ?? asset.name,
      originalFileName:
        asset.originalFileNames?.[0] ?? asset.originalFileName ?? undefined,
      source: css,
    });
    renames.set(fileName, renamed);
  }
  if (renames.size > 0) rewriteReferences(bundle, renames);
}
