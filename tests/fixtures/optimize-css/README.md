# Optimize CSS fixtures

Do not edit by hand. tests/optimize-css-fixtures.test.ts writes these.

The test runs createOptimizedCss on Carbon's compiled stylesheet (carbon-components-svelte/css/white.css) for several import sets and checks the result.

Each scenario name has two files:

- name.css: pruned, pretty-printed output. Gitignored (see .gitignore). Regenerated on every test run. Open it locally to see what survived pruning.
- name.report.json: committed baseline. Holds metrics and a leak report:
  - reduction_percent, kept_rules, before_bytes, after_bytes track the size cut.
  - leaked_classes lists Carbon classes still in the output that the import allowlist cannot explain. They usually show up on compound or descendant selectors that also hit an allowed class. Shorter list, tighter optimizer. Empty is as good as it gets for that scenario.

## Regenerating

.css files refresh whenever you run tests. After an optimizer change or a carbon-components-svelte bump, update baselines:

```sh
bun run test:fixtures:update
```

Review the .report.json diff. Carbon ships minified CSS; the test pretty-prints output (one rule and declaration per line) so you can read it.

## What gets checked

Each scenario also validates against src/component-index.ts, the same component-to-class map the plugin uses:

- No over-prune: if every Carbon class in a source selector is allowed, those classes must still appear in the output.
- No foreign survivor (strict only): no kept selector should reference only classes outside the allowlist.

Compare button.default and button.strict for the strict-mode delta. Look at reduction_percent and leaked_count.

## How to read leaked_classes

Non-zero leaked_count is not a test failure. It is a documented regression metric.

Carbon often bundles unrelated classes in one selector (for example .bx--data-table--compact and .bx--data-table--sm in the same rule). Strict mode keeps the rule when any class matches, so foreign co-occurrences show up as leaks.

Importing Tabs alone omits Tab and TabContent. Compare tabs.strict with tabs-bundle.strict.

UIShell rules reference both .bx--header and .bx--side-nav. Importing one component leaks classes from the other.

RUNTIME_CLASSES in scripts/index-components.ts covers body scroll-lock, SideNav submenu SVG icons, and other tokens absent from class: attributes.

datatable-toolbar, tooltip, and bare datatable cannot reach zero leaks without importing every possible child. Compound piggybacking is expected there.

## Scenario catalog

### Existing

| Scenario | ids | Tier | Exercises |
| --- | --- | --- | --- |
| button.strict | Button | gold | BEM prefix (.bx--btn--), single component |
| button.default | Button | default | Non-strict leak delta vs button.strict |
| button-accordion.strict | Button, Accordion | bundle | Multi-import, zero overlap |
| datatable.strict | DataTable | regression | Compound piggybacking (overflow-menu, size variants) |
| datepicker.strict | DatePicker, DatePickerInput | bundle | Flatpickr preservation |
| modal.strict | Modal | gold | Runtime body class, foreign descendant drop |

### Zero-leak scenarios

| Scenario | ids | Exercises |
| --- | --- | --- |
| dropdown.strict | Dropdown | Listbox / form field |
| combobox.strict | ComboBox | Autocomplete listbox |
| overflowmenu.strict | OverflowMenu | Menu trigger and options |
| search.strict | Search | Search input |
| select.strict | Select | Native select styling (inline needs Pagination, see bundle) |
| checkbox.strict | Checkbox | Form control |
| slider.strict | Slider | Range input |
| breadcrumb.strict | Breadcrumb | Navigation trail |
| textinput.strict | TextInput | Text input |
| toggle.strict | Toggle | Toggle switch |
| numberinput.strict | NumberInput | Number input with steppers |

### Multi-import bundles

| Scenario | ids | Exercises |
| --- | --- | --- |
| dropdown-skeleton.strict | Dropdown, DropdownSkeleton | Parent + loading skeleton |
| select-pagination.strict | Select, Pagination | Inline select wrapper (Carbon nests under Pagination) |
| tabs-bundle.strict | Tabs, Tab, TabContent | Typical tabs page (slot children) |
| datatable-overflowmenu.strict | DataTable, OverflowMenu, Link | Table with row actions; fewer leaks than datatable.strict alone |
| accordion-bundle.strict | Accordion, AccordionItem | Typical accordion page (slot children) |
| composed-modal-bundle.strict | ComposedModal, ModalHeader, ModalBody, ModalFooter | Composed modal usage (footer btn classes) |
| timepicker-bundle.strict | TimePicker, TimePickerSelect | Time picker with child select (Stack + Select cross-refs) |

### Leaky regression baselines

| Scenario | ids | Exercises |
| --- | --- | --- |
| tabs.strict | Tabs | Missing slot children (Tab, TabContent) |
| sidenav.strict | SideNav | Runtime body class, UIShell SVG icons + Header cross-refs |
| header.strict | Header | SideNav / content cross-refs |
| uishell.strict | Header, SideNav, SideNavItems | Full shell bundle |
| tooltip.strict | Tooltip | High cross-component noise |
| datatable-toolbar.strict | DataTable, Toolbar, ToolbarSearch | Table toolbar bundle |
| multiselect.strict | MultiSelect | Checkbox + list-box + combo-box + tag piggybacking |
| passwordinput.strict | PasswordInput | Btn / visibility-toggle bleed |
| fileuploader-bundle.strict | FileUploader, FileUploaderButton, FileUploaderItem | File upload btn + state classes |
| inline-notification.strict | InlineNotification | Notification namespace cross-refs |

## When to add a scenario

- New RUNTIME_CLASSES entry in scripts/index-components.ts
- New typical multi-import bundle (like DatePicker + DatePickerInput)
- Optimizer behavior change that should be regression-tested
- Component with suspected over-prune or leak regression

Skip new fixtures when an existing scenario already covers the same import set or leak family. Prefer net-new component namespaces or parent+child bundles not yet represented (for example, do not add another UIShell bundle when header/sidenav/uishell already exist, or OverflowMenuItem when overflowmenu.strict is zero-leak).
