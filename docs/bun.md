# `optimizeCarbonBun`

`optimizeComponents` and `optimizeCss` for `Bun.build`, with the same output as a Vite build with both plugins. Bun runs only the first `onLoad` that matches a file, so this plugin doesn't load `.svelte` files: your Svelte plugin compiles what `load` returns. Bun has no hook after the bundle is written, so the CSS is pruned once `Bun.build` returns, from its `metafile`. For production builds only: the dev server would serve rewritten components stale.

```js
// build.js
import { optimizeCarbonBun, optimizeImports } from "carbon-preprocess-svelte";
import { compile, preprocess } from "svelte/compiler";

const carbon = optimizeCarbonBun();

const svelte = {
  name: "svelte",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
      // The component rewritten for this app's props, or the file as it is.
      const source = carbon.load(path)?.code ?? (await Bun.file(path).text());
      const { code } = await preprocess(source, [optimizeImports()], {
        filename: path,
      });
      const { js } = compile(code, { filename: path, css: "injected" });
      return { contents: js.code, loader: "js" };
    });
  },
};

const result = await Bun.build({
  entrypoints: ["index.html"],
  outdir: "dist",
  conditions: ["svelte"],
  metafile: true,
  plugins: [carbon, svelte],
});

// Prunes the CSS files the build wrote. One whose name holds its hash is
// renamed for its pruned content, and the HTML and JS naming it updated.
await carbon.pruneBuild(result);
```

It takes `createCarbonOptimizer`'s [options](build-scripts.md#createcarbonoptimizer), and prints how many Carbon components it rewrote with the stylesheets it pruned:

```
carbon-preprocess-svelte: rewrote 37 Carbon components and pruned their CSS
  assets/index-x3k9Qa.css  849.8 kB  →  90.1 kB  -89%
```

After the build, it fails if a module renders Carbon components in a way the rewrite didn't read (a file outside `content`, an alias Bun's resolver can't follow), as the Vite plugin does. `hydration: false` warns and does nothing here.

Carbon's stylesheets (`carbon-components-svelte/css/*.css`) stay out of Bun's CSS bundler. Bun lowers the CSS it bundles for older browsers, with targets you can't change, which inflates Carbon's: its 847 kB `all.css` grows to 1.07 MB, with about 15,000 `:lang()` selectors, and the pruned sheet would keep that overhead. So the plugin bundles each import of one as a placeholder rule, and `pruneBuild` replaces it with the file as Carbon ships it before pruning. `stylesheet: "bundled"` leaves them to Bun instead.

To inline the CSS rather than link it, read the build's CSS files and prune them with `pruneCss`, which replaces the placeholders the same way and leaves the files as they are:

```js
const files = result.outputs.filter((output) => output.path.endsWith(".css"));
const css = Object.fromEntries(await Promise.all(files.map(async (file) => [file.path, await file.text()])));
const pruned = await carbon.pruneCss(css, result);
```
