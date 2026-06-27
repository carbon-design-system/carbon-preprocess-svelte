# Feature & fix prompts

Optimized, self-contained implementation prompts for high-value work on
`carbon-preprocess-svelte`. Each file is grounded in the current codebase and
ends with a `bun lint:fix` → `bun test` → `bun run typecheck` feedback loop.

| #  | Prompt | Priority | Type |
| -- | ------ | -------- | ---- |
| 01 | [Component-index version-drift guard](01-index-version-drift-guard.md) | P1 | feature |
| 02 | [`optimizeCss` safelist / content scan](02-optimize-css-safelist.md) | P1 | feature |
| 03 | [`optimizeImports` parse fast-path](03-optimize-imports-fast-path.md) | P1 | performance |
| 04 | [Type-only barrel import fix](04-type-only-barrel-imports.md) | P2 | fix |
| 05 | [Configurable class prefix](05-configurable-prefix.md) | P2 | feature |
| 06 | [`optimizeCss` debug mode](06-optimize-css-debug-mode.md) | P2 | feature (DX) |
| 07 | [Graduate `experimental.strict`](07-graduate-strict-mode.md) | P2 | feature |
| 08 | [Docs: "which export?" decision guide](08-docs-decision-guide.md) | P3 | docs |
| 09 | [Docs: troubleshooting section](09-docs-troubleshooting.md) | P3 | docs |

## Suggested order

Ship **01, 02, 03** first — they cover correctness (version drift), the most
common consumer breakage (purged styles), and build/dev performance, and none
requires a major version bump.
