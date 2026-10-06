/**
 * Test stand-in for svelte-loader: exports a `.svelte` file's source text
 * and imports the components it does, so webpack bundles what Svelte would
 * have compiled. A barrel import becomes the component's direct path.
 */
const SVELTE_IMPORT = /from\s+["'](\.{1,2}\/[^"']+\.svelte)["']/g;
const BARREL_IMPORT =
  /import\s*\{([^}]*)\}\s*from\s*["']carbon-components-svelte["']/g;

module.exports = function svelteSourceLoader(source) {
  const imports = [...source.matchAll(SVELTE_IMPORT)].map((m) => m[1]);
  for (const match of source.matchAll(BARREL_IMPORT)) {
    for (const name of match[1].split(",").map((n) => n.trim())) {
      if (name)
        imports.push(`carbon-components-svelte/src/${name}/${name}.svelte`);
    }
  }
  // Referenced, so `sideEffects: false` doesn't drop them.
  const names = imports.map((_, i) => `C${i}`);
  return `${imports.map((file, i) => `import ${names[i]} from ${JSON.stringify(file)};`).join("\n")}
export default [${[JSON.stringify(source), ...names].join(", ")}];`;
};
