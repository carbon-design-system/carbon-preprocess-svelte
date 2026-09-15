import type { ContentScan } from "./scan-content";

/** Prefix for every warning either plugin raises, so users can grep for it. */
export const WARN_PREFIX = "carbon-preprocess-svelte:";

export const NO_CARBON_IMPORTS =
  `${WARN_PREFIX} no carbon-components-svelte component imports were found in this build, so no Carbon CSS was pruned. ` +
  'If you expected pruning, check that components are imported from "carbon-components-svelte" (importing only the stylesheet is not enough) ' +
  "and that the plugin is part of the production build.";

export function contentMatchedNothing(
  content: readonly string[],
  root: string,
): string {
  return `${WARN_PREFIX} \`content\` globs ${JSON.stringify(content)} matched no files (resolved from ${root}). No classes from \`content\` were kept.`;
}

export function contentGlobFailed(
  content: readonly string[],
  root: string,
  error: string,
): string {
  return `${WARN_PREFIX} \`content\` globs ${JSON.stringify(content)} could not be expanded (resolved from ${root}): ${error}. No classes from \`content\` were kept.`;
}

/**
 * Warning for a failed or empty `content` scan. Returns `undefined` when
 * `content` was omitted or the globs matched at least one file.
 */
export function contentScanWarning(
  content: readonly string[] | undefined,
  root: string,
  scan: ContentScan,
): string | undefined {
  if (!content || content.length === 0) return undefined;
  if (scan.error !== undefined) {
    return contentGlobFailed(content, root, scan.error);
  }
  if (scan.matchedFiles === 0) return contentMatchedNothing(content, root);
  return undefined;
}
