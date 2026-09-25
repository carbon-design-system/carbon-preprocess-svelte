import { mkdirSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { resolveCarbonRoot } from "carbon-preprocess-svelte/indexer/resolve-carbon-root";
import { createFakeProject } from "./helpers/fake-project";
import { resolvePackageRoot } from "./helpers/resolve-package-root";

describe("resolveCarbonRoot", () => {
  const devDependencyRoot = resolvePackageRoot("carbon-components-svelte");
  let project: ReturnType<typeof createFakeProject>;

  beforeEach(() => {
    project = createFakeProject();
  });

  afterEach(() => {
    project.dispose();
  });

  test("defaults to the working directory (this repo's devDependency)", () => {
    expect(resolveCarbonRoot()).toBe(devDependencyRoot);
  });

  test("prefers the project's own install over this package's location", () => {
    const link = project.linkCarbon();
    expect(resolveCarbonRoot(project.root)).toBe(link);
  });

  test("walks up from a nested app directory (hoisted monorepo install)", () => {
    const link = project.linkCarbon();
    const app = path.join(project.root, "packages", "app");
    mkdirSync(app, { recursive: true });
    expect(resolveCarbonRoot(app)).toBe(link);
  });

  test("finds an install local to the app when the package itself is hoisted", () => {
    const app = path.join(project.root, "packages", "app");
    mkdirSync(app, { recursive: true });
    const link = project.linkCarbon(app);
    expect(resolveCarbonRoot(app)).toBe(link);
  });

  test("falls back to this package's own search path when the project has none", () => {
    expect(resolveCarbonRoot(project.root)).toBe(devDependencyRoot);
  });

  describe("under Yarn Plug'n'Play", () => {
    type PnpModule = { findPnpApi?: (lookupSource: string) => unknown };
    const pnpModule = Module as PnpModule;

    afterEach(() => {
      pnpModule.findPnpApi = undefined;
    });

    test("asks PnP's resolver, which has no node_modules to search", () => {
      // PnP answers with a trailing separator.
      const zipped =
        "/home/me/.yarn/berry/cache/carbon-components-svelte-npm-0.112.0.zip/node_modules/carbon-components-svelte/";
      const issuers: string[] = [];
      pnpModule.findPnpApi = () => ({
        resolveToUnqualified(request: string, issuer: string) {
          expect(request).toBe("carbon-components-svelte");
          issuers.push(issuer);
          return zipped;
        },
      });

      expect(resolveCarbonRoot(project.root)).toBe(zipped.slice(0, -1));
      expect(issuers).toEqual([`${project.root}${path.sep}`]);
    });

    test("falls back to the node_modules search when PnP can't resolve it", () => {
      const link = project.linkCarbon();
      pnpModule.findPnpApi = () => ({
        resolveToUnqualified() {
          throw new Error("carbon-components-svelte isn't a dependency");
        },
      });

      expect(resolveCarbonRoot(project.root)).toBe(link);
    });

    test("falls back when no PnP project covers the directory", () => {
      const link = project.linkCarbon();
      pnpModule.findPnpApi = () => null;

      expect(resolveCarbonRoot(project.root)).toBe(link);
    });
  });
});
