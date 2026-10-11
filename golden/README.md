# Golden apps

Realistic Carbon apps the analyzer is checked against: each is several
files (stores, fetched data, constants modules, i18n helpers, the app's
own wrappers), written the way apps are, not to exercise one feature.

| App | Syntax | What it covers |
| :--- | :--- | :--- |
| `admin-dashboard` | runes, TypeScript | UI shell, `DataTable` over fetched rows, toolbar search, pagination, delete `Modal`, toast store, i18n `t()`, a `StatCard` wrapper |
| `signup-wizard` | legacy, JavaScript | `ProgressIndicator` over a steps array, a `$$restProps` `FormField` wrapper, validation state, `Dropdown`, `RadioButtonGroup` |
| `docs-site` | legacy, JavaScript | header nav, breadcrumbs, `Tabs` of code snippets, `Accordion` FAQ, `ClickableTile` cards, a `Callout` wrapper |
| `product-catalog` | runes, TypeScript | filters (`MultiSelect`, `ComboBox`, `Slider`, `Search`), a rune module (`cart.svelte.ts`), `ComposedModal`, `PaginationNav` |

```sh
# Rewrite each app and compare its SSR HTML with the original
bun scripts/eval-specialize.ts --golden

# Build each app with Vite (unoptimized, `optimizeCss`, prop-aware, and
# with `optimizeComponents`) and click through it in Chromium: every step
# must give the same DOM and pixels as the unoptimized build
bun scripts/eval-interactions.ts --examples golden/admin-dashboard

# What still keeps every variant, ranked across the apps
bun scripts/golden-report.ts [--only admin-dashboard] [--full]
```

Their built CSS and JS sizes, per variant, are snapshotted in
`tests/golden-sizes.test.ts`; update them with
`bun test tests/golden-sizes.test.ts --update-snapshots`.

They compile with this repo's Svelte 5, so they're not built for
Svelte 3 or 4. Add an app as `golden/<name>/` with an `index.html`,
`src/main.ts` mounting `src/App.svelte`, and its steps in
`scripts/golden-steps.ts`.
