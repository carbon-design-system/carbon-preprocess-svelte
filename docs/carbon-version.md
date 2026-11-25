# Your Carbon version

The CSS tools (`optimizeCss`, `OptimizeCssPlugin`, `optimizeCarbonCss`, the CLI) read your installed `carbon-components-svelte` with [svelte-prune](https://github.com/metonym/svelte-prune): which classes each component can render, under which props, and which classes its stylesheet defines. So the pruning matches your version, older or newer than this package.

| | |
| :--- | :--- |
| Parsing | With [svelte-ast](https://github.com/metonym/svelte-ast), bundled in, so your project's `svelte` version doesn't matter |
| On failure | The build warns and leaves Carbon CSS unpruned, instead of failing |

`optimizeImports` reads import paths from Carbon's `src/index.js`.
