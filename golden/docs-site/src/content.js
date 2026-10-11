export const NAV = [
  { href: "#start", text: "Get started" },
  { href: "#components", text: "Components" },
  { href: "#guides", text: "Guides" },
];

export const GUIDES = [
  {
    title: "Install",
    href: "#install",
    summary: "Add the package and its styles to your app.",
  },
  {
    title: "Theming",
    href: "#theming",
    summary: "Switch between the four Carbon themes.",
  },
  {
    title: "Accessibility",
    href: "#a11y",
    summary: "Keyboard support and screen reader labels.",
  },
];

export const FAQ = [
  {
    question: "Does it support Svelte 5?",
    answer: "Yes, in both runes and legacy mode.",
  },
  {
    question: "Can I tree-shake unused components?",
    answer: "Import components from their own paths, or use the preprocessor.",
  },
  {
    question: "Is there a dark theme?",
    answer: "Use the g90 or g100 theme.",
  },
];

export const INSTALL = {
  npm: "npm i carbon-components-svelte",
  pnpm: "pnpm add carbon-components-svelte",
  bun: "bun add carbon-components-svelte",
};
