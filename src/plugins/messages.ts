import { LOG_PREFIX } from "../constants";
import type { ContentScan } from "./scan-content";
import { V10_TOKENS } from "./v10-tokens";

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

/** `optimizeComponents` is in the build, but its analysis failed. */
export const SHARED_ANALYSIS_FAILED = `${LOG_PREFIX} optimizeComponents could not analyze this build, so Carbon CSS is left unpruned.`;

const TOKEN_MIGRATION =
  "https://github.com/carbon-design-system/carbon-components-svelte/blob/master/docs/migrations/v0.114.x.md#1-color-tokens";

// Each v10 name gets its v11 one beside it, since a rename is the usual
// reason a token goes undeclared.
export function undeclaredTokens(names: readonly string[]): string {
  let renamed = false;
  const lines = names.map((name) => {
    const v11 = V10_TOKENS.get(name.slice("--cds-".length));
    if (!v11) return `  ${name}`;
    renamed = true;
    return `  ${name}: a v10 name, now ${v11.map((n) => `--cds-${n}`).join(" or ")}`;
  });
  return [
    `${LOG_PREFIX} CSS reads Carbon tokens that no stylesheet declares, so they resolve to nothing:`,
    ...lines,
    ...(renamed
      ? [
          `v10 names were renamed in carbon-components-svelte 0.114: ${TOKEN_MIGRATION}`,
        ]
      : []),
  ].join("\n");
}
