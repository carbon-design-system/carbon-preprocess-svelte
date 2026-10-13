/**
 * The specializer: reads how an app renders a Svelte component library's
 * components, and rewrites each one (and the app's own components whose
 * every call site it sees) for the props it's given. See `README.md`.
 */
export type {
  Failure,
  SpecializedComponents,
  UsageCollector,
  UsageResult,
} from "./analysis";
export type { UsageAnalysis, UsageOptions } from "./analyze-usage";
export {
  Library,
  type LibraryImport,
  LibraryPaths,
  type LibrarySpec,
  libraryAt,
  loadLibrary,
} from "./library";
export { libraryImports, type ModuleGraph } from "./module-graph";
export type { SpecializerOptions } from "./optimizer";
export { specializerPlugin } from "./vite";
export { SpecializerWebpackPlugin } from "./webpack";
