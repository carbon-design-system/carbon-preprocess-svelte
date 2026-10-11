// The options gallery: one Markdown sample per `markdown()` option, compiled
// under each of the option's values. `vite.config.ts` writes each variant to
// `src/gallery/` as a component (with `compileMarkdown`) and the page that
// lays them out to `src/pages/Options.svx` (both git-ignored).
import {
  carbonCodeIcon,
  highlight,
  type MarkdownOptions,
} from "carbon-preprocess-svelte";

export interface GalleryOption {
  /** The option's name, and the page's heading for it. */
  name: string;
  description: string;
  /** The Markdown each variant compiles. */
  sample: string;
  variants: {
    label: string;
    /** As a reader would write it, for the page's code view. */
    config: string;
    options: MarkdownOptions;
  }[];
}

const FENCE = "```";

export const GALLERY: GalleryOption[] = [
  {
    name: "prose",
    description:
      "Wrap the page in Carbon's `Prose`, which styles the plain HTML Markdown renders.",
    sample:
      "## A heading\n\nA paragraph with a [link](#) and `code`.\n\n- One\n- Two",
    variants: [
      { label: "true (default)", config: "markdown()", options: {} },
      {
        label: "false",
        config: "markdown({ prose: false })",
        options: { prose: false },
      },
    ],
  },
  {
    name: "alerts",
    description:
      "GitHub alerts as a blockquote that Prose styles without JavaScript, or as Carbon's `InlineNotification`.",
    sample:
      "> [!TIP]\n> Run it once, then cache it.\n\n> [!WARNING]\n> This deletes the build.",
    variants: [
      { label: '"blockquote" (default)', config: "markdown()", options: {} },
      {
        label: '"InlineNotification"',
        config: 'markdown({ alerts: "InlineNotification" })',
        options: { alerts: "InlineNotification" },
      },
    ],
  },
  {
    name: "codeSnippet",
    description:
      "Fenced code as a plain `<pre>`, or as Carbon's `CodeSnippet` (copy button, show more).",
    sample: `${FENCE}js\nconst sum = (a, b) => a + b;\nconsole.log(sum(1, 2));\n${FENCE}`,
    variants: [
      { label: "false (default)", config: "markdown()", options: {} },
      {
        label: "true",
        config: "markdown({ codeSnippet: true })",
        options: { codeSnippet: true },
      },
    ],
  },
  {
    name: "codeIcons",
    description:
      "Icons in code block headers, for the file and for a status. `carbonCodeIcon` (Carbon's icons) is the default when `carbon-icons-svelte` is installed.",
    sample: `${FENCE}js title="vite.config.js"\nexport default {};\n${FENCE}\n\n${FENCE}sh kind=deprecated\nnpm run legacy\n${FENCE}`,
    variants: [
      {
        label: "carbonCodeIcon (default)",
        config: "markdown()",
        options: { codeIcons: carbonCodeIcon },
      },
      {
        label: "false",
        config: "markdown({ codeIcons: false })",
        options: { codeIcons: false },
      },
    ],
  },
  {
    name: "anchors",
    description:
      "A `#` link on each heading, for sharing a section. `depths` limits which headings get one.",
    sample: "## Install\n\n### With npm\n\nText.",
    variants: [
      { label: "false (default)", config: "markdown()", options: {} },
      {
        label: "true",
        config: "markdown({ anchors: true })",
        options: { anchors: true },
      },
      {
        label: "{ depths: [2] }",
        config: "markdown({ anchors: { depths: [2] } })",
        options: { anchors: { depths: [2] } },
      },
    ],
  },
  {
    name: "autolinks",
    description:
      "Link bare `https://…` and `www.…` URLs in text, as GitHub does.",
    sample: "Read more at https://carbondesignsystem.com.",
    variants: [
      { label: "true (default)", config: "markdown()", options: {} },
      {
        label: "false",
        config: "markdown({ autolinks: false })",
        options: { autolinks: false },
      },
    ],
  },
  {
    name: "expressions",
    description:
      "Treat `{…}` in text as a Svelte expression. Off by default, so `returns { key, value }` reads as written.",
    sample: "Two and two make {2 + 2}, in {new Date().getFullYear()}.",
    variants: [
      { label: "false (default)", config: "markdown()", options: {} },
      {
        label: "true",
        config: "markdown({ expressions: true })",
        options: { expressions: true },
      },
    ],
  },
  {
    name: "footnoteLabels",
    description:
      "The footnotes section's heading (for screen readers) and each back link's label, for translation.",
    sample: "A claim.[^1]\n\n[^1]: The source.",
    variants: [
      { label: "default", config: "markdown()", options: {} },
      {
        label: "custom",
        config:
          // biome-ignore lint/suspicious/noTemplateCurlyInString: the config as written, shown as code
          'markdown({\n  footnoteLabels: { heading: "Notes", backref: (n) => `Back to note ${n}` },\n})',
        options: {
          footnoteLabels: {
            heading: "Notes",
            backref: (n) => `Back to note ${n}`,
          },
        },
      },
    ],
  },
];

/** What every variant shares: `markdown()`'s defaults, and the highlighter. */
export const GALLERY_BASE: MarkdownOptions = {
  highlight,
  codeIcons: carbonCodeIcon,
};
