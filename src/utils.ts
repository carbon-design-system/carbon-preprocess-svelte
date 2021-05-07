import fs from "fs";
import path from "path";
import { promisify } from "util";
import { CARBON_SVELTE, LATEST_MAJOR_VERSION } from "./constants";

export const writeFile = promisify(fs.writeFile);
export const readFile = promisify(fs.readFile);

export function getPackageJson(
  subpath: string = ""
): {
  name?: string;
  version?: string;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
} {
  const pkgPath = path.join(process.cwd(), subpath, "package.json");

  if (fs.existsSync(pkgPath)) {
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } else {
    return {};
  }
}

export function getCarbonVersions() {
  const { devDependencies, dependencies } = getPackageJson();
  const devDeps = devDependencies ?? {};
  const deps = dependencies ?? {};

  return [
    CARBON_SVELTE.components,
    CARBON_SVELTE.icons,
    CARBON_SVELTE.pictograms,
  ].reduce((pkgs, pkg) => {
    let version = devDeps[pkg] || deps[pkg];

    if (version !== undefined) {
      const [major, minor, patch] = version.replace(/^(\^|\~)/, "").split(".");

      // check if major version is a number
      if (!isNaN(Number(major))) {
        version = major;
      }
    } else {
      // default to the latest package versions
      version = LATEST_MAJOR_VERSION[pkg];
    }

    return { ...pkgs, [pkg]: version };
  }, {});
}
