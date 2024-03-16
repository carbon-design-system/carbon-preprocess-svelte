declare module "svelte/compiler" {
  import type { Ast, Element } from "svelte/types/compiler/interfaces";

  type CustomElement<T> = Omit<Element, "type"> & T;

  type Identifier = CustomElement<{
    type: "Identifier";
  }>;

  type ImportDeclaration = CustomElement<{
    type: "ImportDeclaration";
    source: { value: string };
    specifiers: Array<{
      local: { name: string };
      imported: { name: string };
    }>;
  }>;

  type ANode = Element | ImportDeclaration | Identifier;

  export function walk(
    ast: Ast,
    options: {
      enter: (node: ANode, parentNode: ANode) => void;
    }
  ): void;
}
