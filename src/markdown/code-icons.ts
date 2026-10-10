/**
 * Carbon icons for code block headers (`carbon-icons-svelte`): a file icon
 * from the file name (else the language), and a status icon per kind.
 * Carbon has file-type icons for data and markup formats and logos for some
 * frameworks; other code gets the generic `Script` or `Code`.
 */
import type { CodeIcon, CodeIconTarget } from "./compile";

const BY_NAME: Record<string, string> = {
  "package.json": "LogoNpm",
  dockerfile: "ContainerImage",
  ".env": "DocumentConfiguration",
};

const BY_EXTENSION: Record<string, string> = {
  svelte: "LogoSvelte",
  py: "LogoPython",
  ipynb: "LogoJupyter",
  r: "LogoRScript",
  jsx: "LogoReact",
  tsx: "LogoReact",
  vue: "LogoVue",
  js: "Script",
  mjs: "Script",
  cjs: "Script",
  ts: "Script",
  mts: "Script",
  cts: "Script",
  sh: "Terminal",
  bash: "Terminal",
  zsh: "Terminal",
  json: "Json",
  html: "Html",
  htm: "Html",
  xml: "Xml",
  svg: "Svg",
  csv: "Csv",
  sql: "Sql",
  java: "Java",
  txt: "Txt",
  md: "Document",
  yml: "DocumentConfiguration",
  yaml: "DocumentConfiguration",
  toml: "DocumentConfiguration",
  png: "Png",
  jpg: "Jpg",
  jpeg: "Jpg",
  gif: "Gif",
  pdf: "Pdf",
  zip: "Zip",
};

const BY_LANG: Record<string, string> = {
  svelte: "LogoSvelte",
  python: "LogoPython",
  py: "LogoPython",
  js: "Script",
  javascript: "Script",
  ts: "Script",
  typescript: "Script",
  sh: "Terminal",
  bash: "Terminal",
  shell: "Terminal",
  zsh: "Terminal",
  console: "Terminal",
  ansi: "Terminal",
  json: "Json",
  html: "Html",
  xml: "Xml",
  sql: "Sql",
  java: "Java",
  yaml: "DocumentConfiguration",
};

const PATH_SEPARATOR = /[\\/]/;

const STATUS: Record<string, string> = {
  error: "ErrorFilled",
  warning: "WarningFilled",
  success: "CheckmarkFilled",
  info: "InformationFilled",
};

/** The Carbon icon's name for a header: `LogoSvelte`, `Terminal`, `ErrorFilled`. */
export function carbonCodeIconName(target: CodeIconTarget): string {
  if (target.type === "status") return STATUS[target.status];
  if (target.name) return target.name;
  if (target.terminal) return "Terminal";
  const file = target.title?.toLowerCase() ?? "";
  const base = file.split(PATH_SEPARATOR).pop() ?? "";
  const extension = base.includes(".") ? base.split(".").pop() : undefined;
  return (
    BY_NAME[base] ??
    (extension ? BY_EXTENSION[extension] : undefined) ??
    BY_LANG[target.lang.toLowerCase()] ??
    "Code"
  );
}

/** A Carbon icon component for a code block header, from `carbon-icons-svelte`. */
export function carbonCodeIcon(target: CodeIconTarget): CodeIcon {
  const name = carbonCodeIconName(target);
  return { name, from: `carbon-icons-svelte/lib/${name}.svelte` };
}
