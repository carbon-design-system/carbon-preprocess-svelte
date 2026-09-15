import { collectCarbonImports } from "carbon-preprocess-svelte/plugins/scan-imports";

describe("collectCarbonImports", () => {
  test("adds nothing when the source lacks the package substring", () => {
    const names = new Set<string>();
    collectCarbonImports('import { Button } from "some-other-package";', names);
    expect(names.size).toBe(0);
  });

  test("collects a barrel import, including an aliased specifier", () => {
    const names = new Set<string>();
    collectCarbonImports(
      'import { Button, Modal as M } from "carbon-components-svelte";',
      names,
    );
    expect([...names].sort()).toEqual(["Button", "Modal"]);
  });

  test("skips a whole `import type { ... }` statement", () => {
    const names = new Set<string>();
    collectCarbonImports(
      'import type { Button } from "carbon-components-svelte";',
      names,
    );
    expect(names.size).toBe(0);
  });

  test("skips an inline `type X` specifier while keeping its siblings", () => {
    const names = new Set<string>();
    collectCarbonImports(
      'import { Button, type ModalProps, Accordion } from "carbon-components-svelte";',
      names,
    );
    expect([...names].sort()).toEqual(["Accordion", "Button"]);
  });

  test("collects a direct-path import produced by optimizeImports", () => {
    const names = new Set<string>();
    collectCarbonImports(
      'import Button from "carbon-components-svelte/src/Button/Button.svelte";',
      names,
    );
    expect([...names]).toEqual(["Button"]);
  });

  test("does not duplicate names across repeated calls into the same set", () => {
    const names = new Set<string>();
    collectCarbonImports(
      'import { Button } from "carbon-components-svelte";',
      names,
    );
    collectCarbonImports(
      'import { Button } from "carbon-components-svelte";',
      names,
    );
    expect([...names]).toEqual(["Button"]);
  });
});
