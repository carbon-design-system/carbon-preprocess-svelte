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

- No over-prune: if a source selector would survive strict pruning, its Carbon classes must still appear in the output.
- No foreign survivor (strict only): no kept selector should fail strict allowlist matching (subject classes must match; context ancestors may be exempt).
- Multi-class strict pruning: same-element compounds require every class to match. Descendant selectors require every subject class to match; ancestor classes must match unless listed in `CONTEXT_ANCESTORS`. Classes inside `:not(...)` are exclusions and are not required.

Compare button.default and button.strict for the strict-mode delta. Strict scenarios target `leaked_count: 0`.

## How to read leaked_classes

Non-zero `leaked_count` in strict scenarios is not a test failure when it occurs, but all strict fixtures currently target zero. Residual leaks usually come from single-class selectors where BEM prefix matching is broader than carbon-components-svelte markup (for example size tokens the library never renders).

Compare button.default (`leaked_count: 112`) with button.strict (`leaked_count: 0`) for the default-vs-strict gap. Default mode keeps whole comma-list rules when any branch matches.

`src/indexer/build-index.ts` (invoked by `scripts/index-components.ts`) automates most context classes: import-graph `classList` tracing, slot-wrapper detection, gated Carbon CSS cross-reference, and CSS-orphan SVG classes. `MANUAL_OVERRIDES` is the fallback when automation misses on a Carbon bump.

Bundle pairs that stay strict (import both components): Select + Pagination for inline select, TextInput + FluidForm for fluid layout.

## Scenario catalog

### Existing

| Scenario | ids | Tier | Exercises |
| --- | --- | --- | --- |
| button.strict | Button | gold | BEM prefix (.bx--btn--), single component |
| button.default | Button | default | Non-strict leak delta vs button.strict |
| button-accordion.strict | Button, Accordion | bundle | Multi-import, zero overlap |
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
| textinput.strict | TextInput | Text input; drops fluid form ancestors |
| fluid-form.strict | TextInput, FluidForm | Fluid form ancestor rules |
| toggle.strict | Toggle | Toggle switch |
| numberinput.strict | NumberInput | Number input with steppers |
| multiselect.strict | MultiSelect | Checkbox + list-box + combo-box + tag |
| passwordinput.strict | PasswordInput | Password visibility toggle |
| tabs.strict | Tabs | Parent without slot children |
| sidenav.strict | SideNav | Runtime body class, UIShell cross-refs |
| header.strict | Header | SideNav / content cross-refs |
| header-global-action.strict | HeaderGlobalAction | Header global button hover / icon fill |
| uishell.strict | Header, SideNav, SideNavItems | Full shell bundle |
| tooltip.strict | Tooltip | Cross-component descendant rules |
| datatable.strict | DataTable | Compound size/menu variants |
| datatable-toolbar.strict | DataTable, Toolbar, ToolbarSearch | Table toolbar bundle |
| datatable-overflowmenu.strict | DataTable, OverflowMenu, Link | Table row actions |
| fileuploader-bundle.strict | FileUploader, FileUploaderButton, FileUploaderItem | File upload bundle |
| inline-notification.strict | InlineNotification | Notification namespace |

### Default-mode delta

| Scenario | ids | Exercises |
| --- | --- | --- |
| button.default | Button | Non-strict leak delta vs button.strict |

### Multi-import bundles

| Scenario | ids | Exercises |
| --- | --- | --- |
| dropdown-skeleton.strict | Dropdown, DropdownSkeleton | Parent + loading skeleton |
| select-pagination.strict | Select, Pagination | Inline select wrapper (Carbon nests under Pagination) |
| tabs-bundle.strict | Tabs, Tab, TabContent | Typical tabs page (slot children) |
| accordion-bundle.strict | Accordion, AccordionItem | Typical accordion page (slot children) |
| composed-modal-bundle.strict | ComposedModal, ModalHeader, ModalBody, ModalFooter | Composed modal usage (footer btn classes) |
| timepicker-bundle.strict | TimePicker, TimePickerSelect | Time picker with child select (Stack + Select cross-refs) |

## When to add a scenario

- New `MANUAL_OVERRIDES` entry or automation gate change in src/indexer/build-index.ts
- New typical multi-import bundle (like DatePicker + DatePickerInput)
- Optimizer behavior change that should be regression-tested
- Component with suspected over-prune or leak regression

Skip new fixtures when an existing scenario already covers the same import set or leak family. Prefer net-new component namespaces or parent+child bundles not yet represented (for example, do not add another UIShell bundle when header/sidenav/uishell already exist, or OverflowMenuItem when overflowmenu.strict is zero-leak).
