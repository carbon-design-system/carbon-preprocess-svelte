// npm commands in pnpm, Yarn, and Bun, for the package-manager switch in
// shell code views. A block converts only when every command in it is
// `npm …` or `npx …` (comments and blank lines aside), so other shell code,
// and sessions with npm-specific output, stay as written.

export const MANAGERS = [
  { value: "npm", label: "npm" },
  { value: "pnpm", label: "pnpm" },
  { value: "yarn", label: "yarn", title: "Yarn" },
  { value: "bun", label: "bun", title: "Bun" },
];

const COMMAND = /^(\s*)(npm|npx)\s+(.+?)\s*$/;
const SKIP = /^\s*(#.*)?$/;

/** Flags that differ between managers; others pass through. */
const FLAGS = {
  "-D": { pnpm: "-D", yarn: "-D", bun: "-d" },
  "--save-dev": { pnpm: "-D", yarn: "-D", bun: "-d" },
  "-E": { pnpm: "-E", yarn: "-E", bun: "--exact" },
  "--save-exact": { pnpm: "-E", yarn: "-E", bun: "--exact" },
  "-S": {},
  "--save": {},
};
const INSTALL = new Set(["i", "install", "add"]);
const REMOVE = new Set(["uninstall", "remove", "rm", "un"]);

/** `npm <args>` or `npx <args>` as `pm` would write it, or undefined. */
function convert(tool, args, pm) {
  const words = args.split(/\s+/);
  if (tool === "npx") {
    const rest = words.filter((w) => w !== "-y" && w !== "--yes").join(" ");
    return {
      pnpm: `pnpm dlx ${rest}`,
      yarn: `yarn dlx ${rest}`,
      bun: `bunx ${rest}`,
    }[pm];
  }
  const [command, ...rest] = words;
  const flags = (list) =>
    list.map((w) => (w in FLAGS ? FLAGS[w][pm] : w)).filter(Boolean);
  if (INSTALL.has(command)) {
    const global = rest.some((w) => w === "-g" || w === "--global");
    const packages = rest.filter((w) => !w.startsWith("-"));
    const options = flags(
      rest.filter((w) => w.startsWith("-") && w !== "-g" && w !== "--global"),
    );
    if (packages.length === 0) return [`${pm} install`, ...options].join(" ");
    if (global && pm === "yarn")
      return ["yarn global add", ...options, ...packages].join(" ");
    return [
      `${pm} add`,
      ...(global ? ["-g"] : []),
      ...options,
      ...packages,
    ].join(" ");
  }
  if (command === "ci") {
    return {
      pnpm: "pnpm install --frozen-lockfile",
      yarn: "yarn install --immutable",
      bun: "bun install --frozen-lockfile",
    }[pm];
  }
  if (REMOVE.has(command)) return [`${pm} remove`, ...flags(rest)].join(" ");
  if (
    command === "run" ||
    command === "run-script" ||
    command === "start" ||
    command === "test"
  ) {
    const [script, ...after] =
      command === "start" || command === "test" ? [command, ...rest] : rest;
    if (!script) return undefined;
    const extra = after.filter((w) => w !== "--");
    // `bun test` is Bun's own test runner, so scripts always go through `bun run`.
    return [pm === "bun" ? "bun run" : pm, script, ...extra].join(" ");
  }
  if (command === "create" || command === "init")
    return [pm, command, ...rest].join(" ");
  if (command === "exec")
    return convert("npx", rest.filter((w) => w !== "--").join(" "), pm);
  return undefined;
}

/**
 * The block in each package manager: `{ npm, pnpm, yarn, bun }`, or
 * undefined when it isn't only npm commands.
 */
export function packageManagerVariants(code) {
  const lines = code.split("\n");
  if (!lines.some((line) => COMMAND.test(line))) return undefined;
  const variants = { npm: code };
  for (const { value: pm } of MANAGERS.slice(1)) {
    const converted = [];
    for (const line of lines) {
      if (SKIP.test(line)) {
        converted.push(line);
        continue;
      }
      const match = COMMAND.exec(line);
      const result = match && convert(match[2], match[3], pm);
      if (!result) return undefined;
      converted.push(match[1] + result);
    }
    variants[pm] = converted.join("\n");
  }
  return variants;
}
