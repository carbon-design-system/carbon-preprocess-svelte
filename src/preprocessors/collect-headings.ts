import { PreprocessorGroup } from "svelte/types/compiler/preprocess";
import { EXT_SVELTE } from "../constants";
import { NodeText, walkAndReplace } from "../walk-and-replace";

/**
 * Corresponds to the semantic heading element number
 * @example
 * <h1 /> --> 1
 * <h2 /> --> 2
 */
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

type Headings = Array<{ id?: string; text: string; level: HeadingLevel }>;

interface CollectHeadingsOptions {
  /**
   * Specify the filename pattern to process
   * Defaults to files ending with ".svelte"
   * @default /\.(svelte)$/
   */
  test: RegExp;

  /**
   * Optional callback to transform the content after extracting all headings
   */
  afterCollect: (headings: Headings, content: string) => string;
}

const ELEMENT_HEADING = /^h(1|2|3|4|5|6)$/;

export function collectHeadings(
  options?: Partial<CollectHeadingsOptions>
): Pick<PreprocessorGroup, "markup"> {
  const test = options?.test ?? EXT_SVELTE;

  return {
    markup({ filename, content }) {
      if (filename && !/node_modules/.test(filename) && test.test(filename)) {
        const headings: Headings = [];

        walkAndReplace({ type: "markup", content, filename }, ({ node }) => {
          if (node.type === "Element" && ELEMENT_HEADING.test(node.name)) {
            const id = node.attributes.find(
              (attribute) => attribute.name === "id"
            );

            headings.push({
              id: Array.isArray(id?.value) ? id!.value[0].raw : undefined,
              text: node.children
                .flatMap((child) => {
                  if (child.type === "Element") return child.children;
                  return child;
                })
                .filter((child) => child.type === "Text")
                .map((child) => (child as NodeText).raw)
                .join(""),
              level: Number(node.name.slice(-1)) as HeadingLevel,
            });
          }
        });

        content =
          options?.afterCollect?.apply(this, [headings, content]) ?? content;

        return { code: content };
      }

      return { code: content };
    },
  };
}
