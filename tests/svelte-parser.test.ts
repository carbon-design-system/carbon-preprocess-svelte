import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadSvelteParser } from "carbon-preprocess-svelte/indexer/svelte-parser";
import { createFakeProject } from "./helpers/fake-project";

describe("loadSvelteParser", () => {
  let project: ReturnType<typeof createFakeProject>;

  beforeEach(() => {
    project = createFakeProject();
  });

  afterEach(() => {
    project.dispose();
  });

  test("prefers the consuming project's svelte over this package's", async () => {
    const svelte = path.join(project.root, "node_modules", "svelte");
    mkdirSync(svelte, { recursive: true });
    writeFileSync(
      path.join(svelte, "package.json"),
      JSON.stringify({
        name: "svelte",
        exports: { "./compiler": { require: "./compiler.cjs" } },
      }),
    );
    writeFileSync(
      path.join(svelte, "compiler.cjs"),
      `exports.parse = () => "project svelte";`,
    );

    const parse = await loadSvelteParser(project.root);

    expect(parse("")).toBe("project svelte" as never);
  });

  test("falls back to this package's own svelte when the project has none", async () => {
    const parse = await loadSvelteParser(project.root);

    expect(parse("<div></div>").html.children?.[0]?.name).toBe("div");
  });
});
