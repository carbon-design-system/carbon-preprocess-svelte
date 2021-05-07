# carbon-preprocess-svelte

> Collection of Svelte preprocessors for the Carbon Design System

## Installation

```bash
yarn add -D carbon-preprocess-svelte
# OR
npm i -D carbon-preprocess-svelte
```

## Usage

This library contains the following preprocessors and plugins:

- **optimizeImports**: rewrites Carbon Svelte imports to their source path in the `script` block
- **optimizeCss**: Rollup plugin that removes unused CSS using PurgeCSS
- **elements**: computes Carbon theme tokens in the `style` block
- **icons**: inlines Carbon icons in the `markup` block
- **pictograms**: inlines Carbon pictograms in the `markup` block
- **collectHeadings**: extract heading elements (e.g., `<h1>`, `<h2>`) from the `markup`

### `optimizeImports`

`optimizeImports` is a Svelte script preprocessor that rewrites base imports from Carbon components/icons/pictograms packages to their source Svelte code paths. This can greatly speed up compile times during development while preserving typeahead and autocomplete hinting offered by integrated development environments (IDE) like VSCode.

**Example**

```diff
- import { Button } from "carbon-components-svelte";
- import { Add16 } from "carbon-icons-svelte";
- import { Airplane } from "carbon-pictograms-svelte";
+ import Button from "carbon-components-svelte/Button/Button.svelte";
+ import Add16 from "carbon-icons-svelte/lib/Add16/Add16.svelte";
+ import Airplane from "carbon-pictograms-svelte/lib/Airplane/Airplane.svelte";
```

#### Usage

```js
// svelte.config.cjs
const { optimizeImports } = require("carbon-preprocess-svelte");

module.exports = {
  preprocess: [optimizeImports()],
};
```

### `optimizeCss`

`optimizeCss` is a Rollup plugin that removes unused Carbon CSS. It extracts selectors based on a Svelte component's markup and style content and uses PurgeCSS to prune any unused styles.

#### Usage

`optimizeCss` should be added to the list of `vite.plugins`. Take care to only run the plugin when building for production.

```js
// svelte.config.cjs
const static = require("@sveltejs/adapter-static");
const { optimizeCss } = require("carbon-preprocess-svelte");

module.exports = {
  kit: {
    target: "#svelte",
    adapter: static(),
    vite: {
      optimizeDeps: {
        include: ["carbon-components-svelte", "clipboard-copy"],
      },
      plugins: [process.env.NODE_ENV === "production" && optimizeCss()],
    },
  },
};
```

### `elements`

`elements` is a Svelte style preprocessor that rewrites Carbon Design System tokens to their computed values.

**Before**

```svelte
<style>
  h1,
  h2 {
    font-weight: "semibold";
    background: "ui-01";
  }

  div {
    font: "expressive-heading-01";
    transition: background "easing.standard.productive";
  }

  @media (between: 321px) and (md) {
    div {
      color: "blue-60";
    }
  }
</style>
```

**After**

```svelte
<style>
  h1,
  h2 {
    font-weight: 600;
    background: #f4f4f4;
  }

  div {
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: 0.16px;
    transition: background cubic-bezier(0.2, 0, 0.38, 0.9);
  }

  @media (between: 321px) and (md) {
    div {
      color: #0f62fe;
    }
  }
</style>
```

#### Usage

```js
// svelte.config.cjs
const { elements } = require("carbon-preprocess-svelte");

module.exports = {
  preprocess: [elements()],
};
```

#### API

```ts
interface ElementsOptions {
  /**
   * Specify the Carbon theme
   * Setting to "all" will also enable `cssVars`
   * @default "white"
   */
  theme: v10_theme | "all";

  /**
   * Set to `true` for tokens to be re-written as CSS variables
   * Automatically set to `true` if theme is "all"
   * @example
   * "spacing-05" --> var(--cds-spacing-05)
   * "ui-01" --> var(--cds-ui-01)
   * @default false
   */
  cssVars: boolean;
}
```

### `icons`

`icons` is Svelte markup preprocessor that inlines [Carbon SVG icons](https://www.carbondesignsystem.com/guidelines/icons/library/).

The only required attribute is `name`, which represents the module name of the icon. Refer to [carbon-icons-svelte/ICON_INDEX.md](https://github.com/IBM/carbon-icons-svelte/blob/master/ICON_INDEX.md) for a list of supported icons.

**Example**

```diff
- <icon name="Add16" />
+ <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="currentColor" focusable="false" preserveAspectRatio="xMidYMid meet" width=16 height=16><path d="M17 15L17 8 15 8 15 15 8 15 8 17 15 17 15 24 17 24 17 17 24 17 24 15z"></path></svg>
```

#### Usage

```js
// svelte.config.cjs
const { icons } = require("carbon-preprocess-svelte");

module.exports = {
  preprocess: [icons()],
};
```

### `pictograms`

`pictograms` is Svelte markup preprocessor that inlines [Carbon SVG pictograms](https://www.carbondesignsystem.com/guidelines/pictograms/library/).

The only required attribute is `name`, which represents the module name of the pictogram. Refer to [carbon-pictograms-svelte/ICON_INDEX.md](https://github.com/IBM/carbon-pictograms-svelte/blob/master/PICTOGRAM_INDEX.md) for a list of supported pictograms.

**Example**

```diff
- <pictogram name="Airplane" />
+ <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="currentColor" focusable="false" preserveAspectRatio="xMidYMid meet" width=64 height=64><path d="M22,31.36c-0.038,0-0.076-0.007-0.114-0.019L16,29.38l-5.886,1.962c-0.11,0.035-0.231,0.018-0.324-0.05	C9.696,31.225,9.64,31.115,9.64,31v-2c0-0.104,0.044-0.202,0.123-0.271l3.877-3.393V5.169c0-1.419,0.594-4.529,2.36-4.529	s2.36,3.11,2.36,4.529v5.166l2.279,1.759V10h0.721v2.65l2.279,1.759V12h0.721v2.965l4.859,3.75c0.089,0.068,0.141,0.174,0.141,0.285	v4.5c0,0.128-0.068,0.246-0.179,0.311c-0.112,0.066-0.247,0.065-0.359,0.003l-10.458-5.916l-0.004,7.439l3.877,3.393	c0.078,0.068,0.123,0.167,0.123,0.271v2c0,0.115-0.056,0.225-0.149,0.292C22.148,31.337,22.074,31.36,22,31.36z M16,28.64	c0.039,0,0.077,0.007,0.114,0.019l5.526,1.843v-1.338l-3.877-3.393c-0.078-0.068-0.123-0.167-0.123-0.271l0.005-8.22	c0-0.128,0.068-0.246,0.179-0.311c0.112-0.064,0.247-0.065,0.359-0.002l10.457,5.916v-3.706l-10.859-8.38	c-0.089-0.068-0.141-0.174-0.141-0.285V5.169c0-1.33-0.562-3.81-1.64-3.81c-1.077,0-1.64,2.48-1.64,3.81V25.5	c0,0.104-0.044,0.202-0.123,0.271l-3.877,3.393v1.338l5.526-1.843C15.923,28.646,15.961,28.64,16,28.64z M3,23.86	c-0.062,0-0.125-0.017-0.18-0.049c-0.111-0.064-0.18-0.183-0.18-0.312V19c0-0.112,0.052-0.218,0.141-0.286l4.859-3.721V12h0.72	v2.441l2.28-1.746V10h0.72v2.873c0,0.112-0.052,0.218-0.141,0.286L3.36,19.178v3.699l8.46-4.884l0.36,0.623l-9,5.195	C3.125,23.844,3.062,23.86,3,23.86z"></path></svg>

```

#### Usage

```js
// svelte.config.cjs
const { pictograms } = require("carbon-preprocess-svelte");

module.exports = {
  preprocess: [pictograms()],
};
```

### `collectHeadings`

`collectHeadings` extracts heading elements from markup with an optional callback to modify the source content. This can be used to create a table of contents.

**Example**

Markup:

```svelte
<main>
  <!-- toc -->
  <h1 id="h1">Heading 1</h1>
  <h2 id="h2"><strong>Heading</strong> 2</h2>
  <h3>Heading 3</h3>
</main>
```

Extracted headings:

```js
const headings = [
  { id: "h1", text: "Heading 1", level: 1 },
  { id: "h2-0", text: "Heading 2", level: 2 },
  { id: "h2-1", text: "Heading 2", level: 2 },
  { id: undefined, text: "Heading 3", level: 3 },
];
```

#### Usage

```js
// svelte.config.cjs
const { collectHeadings } = require("carbon-preprocess-svelte");

module.exports = {
  preprocess: [
    collectHeadings({
      afterCollect: (headings, content) => {
        // generate a table of contents from <h2> elements
        const toc = headings
          .filter((heading) => heading.level === 2)
          .map((item) => `<li><a href="#${item.id}">${item.text}</a></li>`)
          .join("");

        return content.replace("<!-- toc -->", `<ul>${toc}</ul>`);
      },
    }),
  ],
};
```

#### API

```js
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
  afterCollect: (
    headings: Array<{
      id?: string,
      text: string,
      level: 1 | 2 | 3 | 4 | 5 | 6,
    }>,
    content: string
  ) => string;
}
```

## Presets

```js
// svelte.config.cjs
const { presetCarbon } = require("carbon-preprocess-svelte");

module.exports = {
  preprocess: presetCarbon(),

  // if using other preprocessors
  // preprocess: [...presetCarbon()],
};
```

## Contributing

Refer to the [contributing guidelines](CONTRIBUTING.md).

## License

[Apache 2.0](LICENSE)
