# optimizeCss fixtures

Do not edit by hand. `tests/optimize-css-fixtures.test.ts` writes these.

The test runs `createOptimizedCss` on Carbon's compiled stylesheet (`carbon-components-svelte/css/white.css`) for several import sets and checks the result.

Each scenario `<name>` has two files:

- `<name>.css` - pruned, pretty-printed output. Gitignored (see `.gitignore`). Regenerated on every test run. Open it locally to see what survived pruning.
- `<name>.report.json` - committed baseline. Holds metrics and a leak report:
  - `reduction_percent`, `kept_rules`, `before_bytes`, `after_bytes` track the size cut.
  - `leaked_classes` lists Carbon classes still in the output that the import allowlist cannot explain. They usually show up on compound or descendant selectors that also hit an allowed class. Shorter list, tighter optimizer. Empty is as good as it gets for that scenario.

## Regenerating

`.css` files refresh whenever you run tests. After an optimizer change or a `carbon-components-svelte` bump, update baselines:

```sh
bun run test:fixtures:update
```

Review the `.report.json` diff. Carbon ships minified CSS; the test pretty-prints output (one rule and declaration per line) so you can read it.

## What gets checked

Each scenario also validates against `src/component-index.ts`, the same component-to-class map the plugin uses:

- No over-prune: if every Carbon class in a source selector is allowed, those classes must still appear in the output.
- No foreign survivor (strict only): no kept selector should reference only classes outside the allowlist.

`button.default` vs `button.strict` shows the strict-mode delta. Compare `reduction_percent` and `leaked_count`.
