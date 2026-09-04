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

group("optimizeImports script preprocessor", () => {
  task("no carbon- substring (skip fast path)", () => {
    preprocess(NO_CARBON);
  });

  task("small (2 imports)", () => {
    preprocess(SMALL);
  });

  task("medium (11 imports)", () => {
    preprocess(MEDIUM);
  });

  task("large (60+ imports)", () => {
    preprocess(LARGE);
  });
});
