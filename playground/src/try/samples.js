// Starting points for the Try page.
const FENCE = "```";

export const SAMPLES = [
  {
    id: "basics",
    label: "Basics",
    source: `---
title: Getting started
---

# Getting started

Install the package, add the preprocessor, and write pages in **Markdown**.
Text, [links](https://carbondesignsystem.com), \`inline code\`, and ~~struck~~
words all render as Carbon type.

## Install

1. Add the package.
2. Add \`markdown()\` to \`svelte.config.js\`.
3. Write a page.

> [!TIP]
> GitHub's alerts become Carbon notifications, or styled blockquotes.

| Option | Default | What it does |
| --- | --- | --- |
| \`prose\` | \`true\` | Wraps the page in Prose |
| \`anchors\` | \`true\` | Links each heading |

A footnote, for the details.[^1]

[^1]: Footnotes are numbered in the order they're cited.
`,
  },
  {
    id: "code",
    label: "Code blocks",
    source: `# Code blocks

${FENCE}js title="vite.config.js" {4} ins={5}
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { markdown } from "carbon-preprocess-svelte";

export default {
  plugins: [svelte({ preprocess: [markdown()] })],
};
${FENCE}

${FENCE}sh
$ npm install carbon-preprocess-svelte
added 1 package in 2s
${FENCE}

${FENCE}diff-js
- const prose = false;
+ const prose = true;
${FENCE}

${FENCE}ts showLineNumbers collapse={3-6}
export function slug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
${FENCE}
`,
  },
  {
    id: "svelte",
    label: "With components",
    source: `<script>
  import { Button } from "carbon-components-svelte";

  let count = 0;
</script>

# A page with components

Markdown and Svelte mix: the button below is a Carbon component.

<Button on:click={() => count++}>Clicked {count} times</Button>

Expressions work in text when \`expressions\` is on.
`,
  },
];
