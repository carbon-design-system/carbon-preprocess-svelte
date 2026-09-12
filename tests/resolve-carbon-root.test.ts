import { mkdirSync } from "node:fs";
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
});
