import path from "node:path";
import { Glob } from "bun";
import { walk } from "estree-walker";
import { parse } from "svelte/compiler";
import { CarbonSvelte } from "../src/constants";
import { isSvelteFile } from "../src/utils";
import { extractSelectors } from "./extract-selectors";

/**
 * Classes the markup-based extractor cannot see: runtime `classList` toggles,
 * or Carbon UIShell CSS that targets SVG descendants without a matching
 * `class:` directive in carbon-components-svelte.
 *
 * `.bx--body--with-modal-open` is toggled by `src/utils/bodyScrollLock.js`,
 * used by Modal (via `modalStore`) and SideNav's overlay.
 *
 * `.bx--side-nav-{collapse,expand}-icon` appear in compiled UIShell CSS on
 * submenu SVGs; carbon-components-svelte uses `submenu-chevron` instead but
 * the compiled theme still ships rules for the collapse/expand pair.
 */
const RUNTIME_CLASSES: Record<string, string[]> = {
  Modal: [".bx--body--with-modal-open"],
  SideNav: [
    ".bx--body--with-modal-open",
    ".bx--side-nav-collapse-icon",
    ".bx--side-nav-expand-icon",
  ],
  // HeaderGlobalAction and siblings render inside HeaderUtilities, but apps
  // often import only the action. Carbon scopes button/link hover styles under
  // `.bx--header__global` (including `color: inherit` so icon fills update).
  HeaderAction: [".bx--header__global"],
  HeaderActionLink: [".bx--header__global"],
  HeaderGlobalAction: [".bx--header__global"],
};

const carbon_path = path.join("node_modules", CarbonSvelte.Components);
const index_js = path.join(carbon_path, "src/index.js");
const index_file = await Bun.file(index_js).text();

/**
 * The exportee from `carbon-components-svelte`.
 * @example Accordion, breakpoints, etc.
 */
type Identifier = string;

type IdentifierValue = { path: string; classes: string[] };

/** Map of components/files exported from the barrel file. */
const exports_map = new Map<Identifier, null | IdentifierValue>();
/** Map of internal components. */
const internal_components = new Map<Identifier, null | IdentifierValue>();
/**
 * A map of components that contain other components.
 * Once all components have been processed, use this map to add
 * the classes of the sub-components to the parent component.
 * @example
 * ```ts
 * ["Accordion", ["AccordionSkeleton"]]
 * ```
 */
const sub_components = new Map<Identifier, Identifier[]>();

walk(parse(`<script>${index_file}</script>`), {
  enter(node) {
    if (node.type === "Identifier") {
      exports_map.set(node.name, null);
    }
  },
});

const files = new Glob("**/*.{js,svelte}").scan(path.join(carbon_path, "src"));

for await (const file of files) {
  // Skip processing icon components, which do not have classes.
  if (file.startsWith("icons/")) {
    continue;
  }

  const moduleName = path.parse(file).name;

  const map: IdentifierValue = {
    path: `${CarbonSvelte.Components}/src/${file}`,
    classes: [],
  };

  if (isSvelteFile(file)) {
    const file_path = path.join(carbon_path, "src/", file);
    const file_text = await Bun.file(file_path).text();
    const selectors = extractSelectors({ code: file_text, filename: file });

    map.classes = selectors.classes;

    if (selectors.components.length > 0) {
      sub_components.set(moduleName, selectors.components);
    }
  }

  if (exports_map.has(moduleName)) {
    exports_map.set(moduleName, map);
  } else if (isSvelteFile(file)) {
    internal_components.set(moduleName, map);
  }
}

for (const [parent, components] of sub_components.entries()) {
  const parent_map = exports_map.get(parent);

  if (parent_map) {
    const sub_classes = components.flatMap((component) => {
      if (exports_map.has(component)) {
        return exports_map.get(component)?.classes ?? [];
      }
      if (internal_components.has(component)) {
        return internal_components.get(component)?.classes ?? [];
      }

      // Components that fall through here are icon components,
      // which do not have classes and can be ignored.
      return [];
    });

    if (sub_classes.length > 0) {
      parent_map.classes = [
        ...new Set([...parent_map.classes, ...sub_classes]),
      ];
    }
  }
}

// Merge in classes applied imperatively at runtime, which the markup-based
// extractor cannot detect.
for (const [identifier, classes] of Object.entries(RUNTIME_CLASSES)) {
  const entry = exports_map.get(identifier);
  if (entry) {
    entry.classes = [...new Set([...entry.classes, ...classes])];
  }
}

for (const entry of exports_map.values()) {
  if (entry) {
    entry.classes.sort((a, b) => a.localeCompare(b));
  }
}

// Sort Map keys alphabetically and convert to object.
const components = Object.fromEntries(
  new Map(
    [...exports_map.entries()]
      .sort((a, b) => a.toLocaleString().localeCompare(b.toLocaleString()))
      .filter(([_, value]) => value !== null),
  ),
);

const isBuild = process.env.BUILD === "true";
const jsonString = isBuild
  ? JSON.stringify(components)
  : JSON.stringify(components, null, 2);

await Bun.write(
  "src/component-index.ts",
  `// @generated
// This file was automatically generated and should not be edited.
// @see scripts/index-components.ts

export const components: Record<string, { path: string; classes: string[]; }> = Object.freeze(${jsonString});\n`,
);
