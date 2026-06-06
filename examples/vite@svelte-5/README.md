# vite@svelte-5

Used for end-to-end testing and development. Svelte 5 with strict `optimizeCss`.

Each entry is a small app that mirrors an optimize-css fixture scenario. Pick one with `ENTRY` or the matching script.

## Entries

| Entry | Fixture | Components |
| --- | --- | --- |
| datatable-toolbar | datatable-toolbar.strict | TableContainer, Toolbar, ToolbarSearch, DataTable |
| datatable-overflowmenu | datatable-overflowmenu.strict | DataTable, OverflowMenu, Link |
| datepicker | datepicker.strict | DatePicker, DatePickerInput |
| timepicker-bundle | timepicker-bundle.strict | TimePicker, TimePickerSelect |
| modal | modal.strict | Modal |
| composed-modal-bundle | composed-modal-bundle.strict | ComposedModal, ModalHeader, ModalBody, ModalFooter |
| uishell | uishell.strict | Header, SideNav, SideNavItems, Content |
| tabs-bundle | tabs-bundle.strict | Tabs, Tab, TabContent |
| select-pagination | select-pagination.strict | Select (inline), Pagination |
| dropdown | dropdown.strict | Dropdown |
| textinput | textinput.strict | TextInput |
| multiselect | multiselect.strict | MultiSelect |

## Quick start

From the repo root:

```sh
bun run build
bun link
```

In this folder:

```sh
bun i
```

Run one entry in dev (optimizeImports only):

```sh
bun run dev:modal
bun run dev:uishell
```

Build one entry (optimizeImports + optimizeCss):

```sh
bun run build:datatable-toolbar
```

Build all entries (what e2e uses):

```sh
bun run build
# or
bun run build:all
```

Default dev/build target is `datatable-toolbar`.

## Layout

```
entries/<name>/
  index.html
  App.svelte
entries.manifest.json   # list for e2e
vite.config.ts          # root = entries/<ENTRY>
dist/<name>/            # per-entry build output
```
