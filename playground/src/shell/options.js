// Every playground option, in one place. The settings panel, the URL, the
// "changed" tags, and the Matrix's axes all read this list: adding an option
// is one entry here, plus whatever applies it (App.svelte).
//
// Each option: `key` (also its URL parameter), `group`, `label`, `values`
// (`[value, label][]`), `default`, and optionally:
// - `control`: "select" (the default), "switch" (a ContentSwitcher, for two
//   or three values), or "toggle" (on/off: values `"1"` and `"0"`);
// - `prose`: only Prose acts on it (off when the CCS in use has no Prose);
// - `axis`: the Matrix can lay it out across columns;
// - `reload`: it applies when the page loads;
// - `help`: a line under the control.

export const GROUPS = [
  {
    id: "prose",
    label: "Prose",
    help: "Prose's props, passed to each page as `proseProps`.",
  },
  { id: "code", label: "Code" },
  { id: "appearance", label: "Appearance" },
  {
    id: "loading",
    label: "Loading",
    help: "Each reloads the page. Off is for comparing.",
  },
];

export const OPTIONS = [
  {
    key: "variant",
    group: "prose",
    label: "Variant",
    prose: true,
    axis: true,
    default: "auto",
    values: [
      ["auto", "Default"],
      ["condensed", "Condensed"],
      ["compact", "Compact"],
      ["spacious", "Spacious"],
      ["expressive", "Expressive"],
    ],
  },
  {
    key: "measure",
    group: "prose",
    label: "Width",
    prose: true,
    default: "auto",
    values: [
      ["auto", "The variant's"],
      ["60ch", "60ch"],
      ["68ch", "68ch"],
      ["80ch", "80ch"],
      ["96ch", "96ch"],
      ["none", "None"],
    ],
  },
  {
    key: "linkTone",
    group: "prose",
    label: "Links",
    control: "switch",
    prose: true,
    axis: true,
    default: "default",
    values: [
      ["default", "Default"],
      ["muted", "Muted"],
    ],
  },
  {
    key: "tableWidth",
    group: "prose",
    label: "Tables",
    control: "switch",
    prose: true,
    axis: true,
    default: "fit",
    values: [
      ["fit", "Fit"],
      ["full", "Full"],
    ],
  },
  {
    key: "kbd",
    group: "prose",
    label: "Keys",
    control: "switch",
    prose: true,
    axis: true,
    default: "keycap",
    values: [
      ["keycap", "Keycap"],
      ["muted", "Muted"],
    ],
  },
  {
    key: "dividers",
    group: "prose",
    label: "Heading dividers",
    control: "toggle",
    prose: true,
    axis: true,
    default: "0",
    values: [
      ["0", "Off"],
      ["1", "On"],
    ],
  },
  {
    key: "scope",
    group: "prose",
    label: "Scope",
    prose: true,
    default: "runs",
    help: "One Prose per run of Markdown between components, or one for the page.",
    values: [
      ["runs", "Per Markdown run"],
      ["page", "One for the page"],
    ],
  },
  {
    key: "scrollMargin",
    group: "prose",
    label: "Scroll margin",
    prose: true,
    default: "header",
    help: "Room above a heading a link jumps to.",
    values: [
      ["0", "None"],
      ["header", "The header's height"],
      ["6rem", "6rem"],
    ],
  },
  {
    key: "code",
    group: "code",
    label: "Example language",
    control: "switch",
    default: "js",
    values: [
      ["js", "JavaScript"],
      ["ts", "TypeScript"],
    ],
  },
  {
    key: "pm",
    group: "code",
    label: "Package manager",
    control: "switch",
    default: "npm",
    values: [
      ["npm", "npm"],
      ["pnpm", "pnpm"],
      ["yarn", "yarn"],
      ["bun", "bun"],
    ],
  },
  {
    key: "syntax",
    group: "code",
    label: "Syntax colors",
    default: "build",
    values: [
      ["build", "Build-time spans"],
      ["runtime", "Runtime (CSS Highlight API)"],
      ["off", "Off"],
    ],
  },
  {
    key: "codeVariant",
    group: "code",
    label: "Code size",
    control: "switch",
    default: "prose",
    values: [
      ["prose", "Prose's"],
      ["compact", "Compact"],
    ],
  },
  {
    key: "terminal",
    group: "code",
    label: "Terminal theme",
    default: "page",
    values: [
      ["page", "The page's"],
      ["g100", "Gray 100"],
      ["g90", "Gray 90"],
      ["white", "White"],
    ],
  },
  {
    key: "theme",
    group: "appearance",
    label: "Theme",
    axis: true,
    default: "system",
    values: [
      ["system", "System"],
      ["white", "White"],
      ["g10", "Gray 10"],
      ["g80", "Gray 80"],
      ["g90", "Gray 90"],
      ["g100", "Gray 100"],
    ],
  },
  {
    key: "lazy",
    group: "loading",
    label: "Mount near the viewport",
    control: "toggle",
    reload: true,
    default: "1",
    values: [
      ["0", "Off"],
      ["1", "On"],
    ],
  },
  {
    key: "cv",
    group: "loading",
    label: "content-visibility",
    control: "toggle",
    reload: true,
    default: "1",
    values: [
      ["0", "Off"],
      ["1", "On"],
    ],
  },
  {
    key: "aot",
    group: "loading",
    label: "Build-time tokens",
    control: "toggle",
    reload: true,
    default: "1",
    values: [
      ["0", "Off"],
      ["1", "On"],
    ],
  },
];

/** `{ key: default }` for every option. */
export const DEFAULTS = Object.fromEntries(
  OPTIONS.map((o) => [o.key, o.default]),
);

/** An option's label for a value: `labelOf("variant", "compact")` is "Compact". */
export function labelOf(key, value) {
  return (
    OPTIONS.find((o) => o.key === key)?.values.find(
      ([v]) => v === value,
    )?.[1] ?? value
  );
}

/** Old URL values that still work. */
const ALIASES = { scrollMargin: { toolbar: "header" } };

/** The options from a URL query, falling back to defaults for unknown values. */
export function fromQuery(params) {
  return Object.fromEntries(
    OPTIONS.map((o) => {
      const raw = params.get(o.key);
      const value = ALIASES[o.key]?.[raw] ?? raw;
      return [o.key, o.values.some(([v]) => v === value) ? value : o.default];
    }),
  );
}
