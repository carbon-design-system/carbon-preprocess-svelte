/**
 * The app corpus the prop-aware evaluations share: one tiny app per
 * (Carbon component, prop value), random multi-site mixes of those, or
 * existing app files.
 */
import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CarbonComponents } from "../src/analyzer/call-sites";
import { loadComponentModel } from "../src/analyzer/component-model";
import { collectCarbonImports } from "../src/plugins/scan-imports";

export type Case = {
  id: string;
  components: string[];
  markup: string;
  /** An existing app file, evaluated as is. */
  file?: string;
};

export type CaseOptions = {
  root: string;
  carbon: CarbonComponents;
  carbonSrc: string;
  only?: string;
  apps?: string[];
  combos: number;
  seed: number;
};

/** Props some components need to render at all. */
const FIXTURE_PROPS: Record<string, string> = {
  DataTable: `headers={[{ key: "name", value: "Name" }]} rows={[{ id: "a", name: "A" }]}`,
  Dropdown: `items={[{ id: "0", text: "A" }, { id: "1", text: "B" }]}`,
  ComboBox: `items={[{ id: "0", text: "A" }, { id: "1", text: "B" }]}`,
  MultiSelect: `items={[{ id: "0", text: "A" }, { id: "1", text: "B" }]}`,
  ContextMenu: `target={null}`,
  RecursiveList: `nodes={[{ text: "A" }]}`,
  TreeView: `nodes={[{ id: 0, text: "A" }]}`,
  Pagination: `totalItems={100}`,
  ImageLoader: `src=""`,
};

/** Components that only render inside a parent: wrap them in it. */
const PARENTS: Record<string, string> = {
  Tab: "Tabs",
  TabContent: "Tabs",
  SelectItem: "Select",
  SelectItemGroup: "Select",
  RadioButton: "RadioButtonGroup",
  ProgressStep: "ProgressIndicator",
  Switch: "ContentSwitcher",
  AccordionItem: "Accordion",
  StructuredListRow: "StructuredList",
  StructuredListCell: "StructuredList",
  StructuredListHead: "StructuredList",
  StructuredListBody: "StructuredList",
  StructuredListInput: "StructuredList",
  ListItem: "UnorderedList",
  BreadcrumbItem: "Breadcrumb",
  OverflowMenuItem: "OverflowMenu",
  ContextMenuOption: "ContextMenu",
  ContextMenuGroup: "ContextMenu",
  ContextMenuRadioGroup: "ContextMenu",
  ContextMenuDivider: "ContextMenu",
  SideNavItems: "SideNav",
  SideNavLink: "SideNav",
  SideNavMenu: "SideNav",
  SideNavMenuItem: "SideNav",
  SideNavDivider: "SideNav",
  HeaderNav: "Header",
  HeaderNavItem: "Header",
  HeaderNavMenu: "Header",
  HeaderUtilities: "Header",
  HeaderAction: "Header",
  HeaderGlobalAction: "Header",
  HeaderPanelLinks: "Header",
  HeaderPanelLink: "Header",
  HeaderPanelDivider: "Header",
  HeaderSearch: "Header",
  ToolbarContent: "Toolbar",
  ToolbarSearch: "Toolbar",
  ToolbarMenu: "Toolbar",
  ToolbarBatchActions: "Toolbar",
  TableRow: "Table",
  TableHead: "Table",
  TableBody: "Table",
  TableHeader: "Table",
  TableCell: "Table",
  Row: "Grid",
  Column: "Grid",
  TileGroup: "TileGroup",
  RadioTile: "TileGroup",
  SelectableTile: "SelectableTileGroup",
  ButtonSet: "ButtonSet",
  ComposedModal: "ComposedModal",
  ModalHeader: "ComposedModal",
  ModalBody: "ComposedModal",
  ModalFooter: "ComposedModal",
  UserAvatar: "UserAvatarGroup",
  DatePickerInput: "DatePicker",
  InterstitialScreenBody: "InterstitialScreen",
  InterstitialScreenFooter: "InterstitialScreen",
  InterstitialScreenHeader: "InterstitialScreen",
  MenuItem: "Menu",
  MenuItemDivider: "Menu",
  MenuItemGroup: "Menu",
  MenuItemRadioGroup: "Menu",
  SearchMenuGroup: "SearchMenu",
  SearchMenuItem: "SearchMenu",
  ToolbarMenuItem: "ToolbarMenu",
};

const LITERAL_UNION =
  /^\s*(?:"[^"]*"\s*\|\s*)*"[^"]*"\s*(?:\|\s*(?:undefined|null)\s*)*$/;
const STRING_LITERAL = /"([^"]*)"/g;
const TYPE_TAG = /@type\s*\{([^}]*)\}/;

/** Each prop's string-literal values (from JSDoc) or `boolean` default. */
function propVariants(
  name: string,
  carbon: CarbonComponents,
  carbonSrc: string,
): Array<[string, string[]]> {
  const key = carbon.get(name);
  if (!key) return [];
  const model = loadComponentModel(carbonSrc, key);
  const source = readFileSync(path.join(carbonSrc, key), "utf8");
  const variants: Array<[string, string[]]> = [];
  for (const [prop, fallback] of model.props) {
    if (prop === "ref" || prop === "id") continue;
    if (fallback?.type === "Literal" && typeof fallback.value === "boolean") {
      variants.push([prop, [`{${!fallback.value}}`]]);
      continue;
    }
    const declaration = source.indexOf(`export let ${prop}`);
    const doc = source.slice(Math.max(0, declaration - 600), declaration);
    const comment = doc.slice(doc.lastIndexOf("/**"));
    // JSDoc in the source, or (Carbon 0.113+, which strips it) the
    // generated `.svelte.d.ts`.
    const declarations = path.join(carbonSrc, `${key}.d.ts`);
    const typed = existsSync(declarations)
      ? new RegExp(`\\b${prop}\\?: ([^;\\n]+);`).exec(
          readFileSync(declarations, "utf8"),
        )?.[1]
      : undefined;
    const type = TYPE_TAG.exec(comment)?.[1] ?? typed;
    if (type && LITERAL_UNION.test(type)) {
      const values = [...type.matchAll(STRING_LITERAL)].map((m) => m[1]);
      variants.push([prop, values.map((v) => `"${v}"`)]);
    }
  }
  return variants;
}

function element(name: string, attrs: string, children = "Text"): string {
  const fixture = FIXTURE_PROPS[name] ?? "";
  const tag = `<${name} ${fixture} ${attrs}>${children}</${name}>`;
  const parent = PARENTS[name];
  return parent && parent !== name
    ? `<${parent} ${FIXTURE_PROPS[parent] ?? ""}>${tag}</${parent}>`
    : tag;
}

export function buildCases(options: CaseOptions): Case[] {
  const { carbon, carbonSrc } = options;
  const names = [...carbon.keys()]
    .filter((name) => !options.only || options.only.split(",").includes(name))
    .sort();

  const cases: Case[] = [];
  for (const file of options.apps
    ? globSync(options.apps, { cwd: options.root })
    : []) {
    const components = new Set<string>();
    collectCarbonImports(
      readFileSync(path.join(options.root, file), "utf8"),
      components,
    );
    cases.push({
      id: file,
      components: [...components],
      markup: "",
      file: path.join(options.root, file),
    });
  }
  for (const name of options.apps ? [] : names) {
    const deps =
      PARENTS[name] && PARENTS[name] !== name ? [name, PARENTS[name]] : [name];
    cases.push({
      id: `${name}/defaults`,
      components: deps,
      markup: element(name, "", ""),
    });
    cases.push({
      id: `${name}/children`,
      components: deps,
      markup: element(name, ""),
    });
    for (const [prop, values] of propVariants(name, carbon, carbonSrc)) {
      for (const value of values) {
        cases.push({
          id: `${name}/${prop}=${value}`,
          components: deps,
          markup: element(name, `${prop}=${value}`),
        });
      }
    }
  }

  // Random multi-site apps: several cases of the same and different components.
  let seed = options.seed;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const singles = [...cases];
  for (
    let i = 0;
    !options.apps && i < options.combos && singles.length > 1;
    i++
  ) {
    const picked = Array.from(
      { length: 2 + Math.floor(random() * 4) },
      () => singles[Math.floor(random() * singles.length)],
    );
    cases.push({
      id: `combo/${i}: ${picked.map((c) => c.id).join(" + ")}`,
      components: [...new Set(picked.flatMap((c) => c.components))],
      markup: picked.map((c) => c.markup).join("\n"),
    });
  }
  return cases;
}

/** The app's source: the file as is, or the case's markup with its imports. */
export function caseSource(testCase: Case, carbon: CarbonComponents): string {
  if (testCase.file) return readFileSync(testCase.file, "utf8");
  const imports = testCase.components
    .map((name) => {
      const key = carbon.get(name);
      return key
        ? `import ${name} from "carbon-components-svelte/src/${key}";`
        : "";
    })
    .join("\n");
  return `<script>\n${imports}\n</script>\n\n${testCase.markup}\n`;
}
