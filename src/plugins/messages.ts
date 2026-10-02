import { LOG_PREFIX } from "../constants";
import type { ContentScan } from "./scan-content";

export const NO_CARBON_IMPORTS =
  `${LOG_PREFIX} no carbon-components-svelte component imports were found in this build, so no Carbon CSS was pruned. ` +
  'If you expected pruning, check that components are imported from "carbon-components-svelte" (importing only the stylesheet is not enough) ' +
  "and that the plugin is part of the production build.";

export function contentMatchedNothing(
  content: readonly string[],
  root: string,
): string {
  return `${LOG_PREFIX} \`content\` globs ${JSON.stringify(content)} matched no files (resolved from ${root}). No classes from \`content\` were kept.`;
}

/** A warning for a failed or empty `content` scan, else `undefined`. */
export function contentScanWarning(
  content: readonly string[] | undefined,
  root: string,
  scan: ContentScan,
): string | undefined {
  if (!content || content.length === 0) return undefined;
  if (scan.error !== undefined) {
    return `${LOG_PREFIX} \`content\` globs ${JSON.stringify(content)} could not be expanded (resolved from ${root}): ${scan.error}. No classes from \`content\` were kept.`;
  }
  if (scan.matchedFiles === 0) return contentMatchedNothing(content, root);
  return undefined;
}
