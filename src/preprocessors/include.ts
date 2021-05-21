import { PreprocessorGroup } from "svelte/types/compiler/preprocess";
import { EXT_SVELTE } from "../constants";
import { parse } from "path";

interface PreprocessIncludeOptions {
  script: Array<{
    /**
     * Specify the content the prepend or append
     * @example
     * import { CodeSnippet } from "carbon-components-svelte";
     */
    content: string;

    /**
     * Specify the filename pattern to process
     * Defaults to files ending with ".svelte"
     * @default /\.(svelte)$/
     */
    test?: RegExp;

    /**
     * Specify whether the content should be prepended or appended
     * @default "prepend"
     */
    behavior?: "prepend" | "append";
  }>;
  markup: Array<{
    /**
     * Specify the content the prepend or append
     * @example
     * <ul>Table of Contents</ul>
     */
    content: string;

    /**
     * Specify the filename pattern to process
     * Defaults to files ending with ".svelte"
     * @default /\.(svelte)$/
     */
    test?: RegExp;

    /**
     * Specify whether the content should be prepended or appended
     * @default "prepend"
     */
    behavior?: "prepend" | "append";
  }>;
}

export function include(
  options?: Partial<PreprocessIncludeOptions>
): Pick<PreprocessorGroup, "markup" | "script"> {
  const script = options?.script ?? [];
  const markup = options?.markup ?? [];

  return {
    script({ filename, content }) {
      if (
        script.length > 0 &&
        filename !== undefined &&
        !/node_modules/.test(filename) &&
        EXT_SVELTE.test(filename)
      ) {
        script.forEach((entry) => {
          const behavior = entry.behavior ?? "prepend";

          if (behavior === "prepend") {
            content = entry.content + content;
          } else if (behavior === "append") {
            content += entry.content;
          }
        });

        return { code: content };
      }

      return { code: content };
    },
    markup({ filename, content }) {
      const { name } = parse(filename);

      if (
        markup.length > 0 &&
        !/node_modules/.test(filename) &&
        // ignore SvelteKit layout/error files to prevent duplicate markup
        !/.svelte-kit/.test(filename) &&
        !/^(__layout)/.test(name) &&
        EXT_SVELTE.test(filename)
      ) {
        markup.forEach((entry) => {
          const behavior = entry.behavior ?? "prepend";

          if (behavior === "prepend") {
            content = entry.content + content;
          } else if (behavior === "append") {
            content += entry.content;
          }
        });

        return { code: content };
      }

      return { code: content };
    },
  };
}
