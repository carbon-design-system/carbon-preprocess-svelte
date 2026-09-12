import { group, task } from "ostia";
import type { Processed } from "svelte/compiler";
import { optimizeImports } from "../src/preprocessors/optimize-imports";

const preprocessor = optimizeImports();

function preprocess(content: string) {
  return preprocessor.script({
    attributes: {},
    filename: "bench.svelte",
    content,
    markup: "",
  }) as Processed | undefined;
}

const NO_CARBON = `import { onMount } from "svelte";
import { writable } from "svelte/store";

let count = 0;
onMount(() => {
  count += 1;
});`;

// Already rewritten (or hand-written) direct imports: the `carbon-` substring
// is present, so the fast path can't skip, but nothing changes.
const ALREADY_DIRECT = `import Button from "carbon-components-svelte/src/Button/Button.svelte";
import TextInput from "carbon-components-svelte/src/TextInput/TextInput.svelte";
import Add from "carbon-icons-svelte/lib/Add.svelte";

let value = "";`;

const SMALL = `import { Button, TextInput } from "carbon-components-svelte";`;

const MEDIUM = `import {
  Button,
  TextInput,
  Modal,
  DataTable,
  Toolbar,
  ToolbarSearch,
  Dropdown,
  Checkbox,
} from "carbon-components-svelte";
import { Add, Close, Edit } from "carbon-icons-svelte";`;

// Aliases, per-specifier `type`, an un-indexed camelCase utility that stays
// on the barrel, and a type-only statement that must be left alone.
const MIXED = `import type { DataTableRow } from "carbon-components-svelte";
import {
  Button as CarbonButton,
  type ButtonProps,
  TextInput,
  truncate,
  DataTable,
} from "carbon-components-svelte";
import { Add as AddIcon, Close } from "carbon-icons-svelte";`;

// Representative of a large dashboard page with many Carbon imports.
const LARGE = `import {
  Header,
  HeaderGlobalAction,
  SideNav,
  SideNavItems,
  SideNavLink,
  Content,
  Grid,
  Row,
  Column,
  Button,
  TextInput,
  PasswordInput,
  NumberInput,
  Select,
  SelectItem,
  Dropdown,
  MultiSelect,
  ComboBox,
  Checkbox,
  RadioButton,
  RadioButtonGroup,
  Toggle,
  Slider,
  DataTable,
  Toolbar,
  ToolbarContent,
  ToolbarSearch,
  Pagination,
  Modal,
  ComposedModal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Tabs,
  Tab,
  TabContent,
  Accordion,
  AccordionItem,
  Tag,
  Tile,
  ClickableTile,
  InlineNotification,
  ToastNotification,
  Loading,
  ProgressBar,
  Breadcrumb,
  BreadcrumbItem,
  OverflowMenu,
  OverflowMenuItem,
  Search,
  Link,
} from "carbon-components-svelte";
import {
  Add,
  Close,
  Edit,
  TrashCan,
  Save,
  Filter,
  Settings,
  Download,
  Upload,
  ChevronDown,
} from "carbon-icons-svelte";
import { Airplane, Analytics } from "carbon-pictograms-svelte";`;

/**
 * A realistic component script: the medium import block followed by ~300
 * lines of ordinary code. The source map has to cover every line after the
 * rewritten imports, so the body length, not the import count, is what
 * dominates for real files.
 */
const BODY_LINES = 300;
const BODY = Array.from({ length: BODY_LINES }, (_, i) => {
  switch (i % 6) {
    case 0:
      return `  let value${i} = $state("");`;
    case 1:
      return `  const rows${i} = data.map((row, index) => ({ ...row, id: \`row-\${index}-${i}\` }));`;
    case 2:
      return `  function onSelect${i}(event) {`;
    case 3:
      return `    selected = event.detail.selectedRowIds.filter((id) => id !== ${i});`;
    case 4:
      return "  }";
    default:
      return `  // ${"comment text ".repeat(4)}${i}`;
  }
}).join("\n");
const MEDIUM_WITH_BODY = `${MEDIUM}\n\n${BODY}\n`;
const LARGE_WITH_BODY = `${LARGE}\n\n${BODY}\n`;

group("optimizeImports script preprocessor", () => {
  task("no carbon- substring (skip fast path)", () => {
    preprocess(NO_CARBON);
  });

  task("carbon- present, already direct (no rewrite)", () => {
    preprocess(ALREADY_DIRECT);
  });

  task("small (2 imports)", () => {
    preprocess(SMALL);
  });

  task("medium (11 imports)", () => {
    preprocess(MEDIUM);
  });

  task("mixed (aliases, type, utility)", () => {
    preprocess(MIXED);
  });

  task("large (60+ imports)", () => {
    preprocess(LARGE);
  });
});

group("optimizeImports with a component body (source map)", () => {
  task(`medium (11 imports) + ${BODY_LINES}-line body`, () => {
    preprocess(MEDIUM_WITH_BODY);
  });

  task(`large (60+ imports) + ${BODY_LINES}-line body`, () => {
    preprocess(LARGE_WITH_BODY);
  });
});
