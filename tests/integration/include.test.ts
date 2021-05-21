import { testFiles } from "./utils";
import { include } from "../../src";

testFiles({
  name: "include",
  preprocessor: [
    include({
      script: [
        {
          content: `
          import { CodeSnippet } from "carbon-components-svelte";
        `,
          behavior: "append",
        },
      ],
      markup: [
        {
          content: "<!-- toc -->",
        },
        {
          content: "<p>Text</p>",
          behavior: "append",
        },
      ],
    }),
  ],
});
