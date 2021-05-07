import assert from "assert";
import { testFiles } from "./utils";
import { collectHeadings } from "../../src";

testFiles({
  name: "collect-headings",
  preprocessor: [
    collectHeadings({
      afterCollect: (headings, content) => {
        assert.deepStrictEqual(headings, [
          { id: "h1", text: "Heading 1", level: 1 },
          { id: undefined, text: "Heading 2 with missing id", level: 2 },
          { id: "h2-0", text: "Heading 2", level: 2 },
          { id: "h2-1", text: "Heading 2", level: 2 },
          { id: "h3", text: "Heading 3", level: 3 },
        ]);

        const h2 = headings
          .filter((heading) => heading.level === 2)
          .map((heading) => `<li>${heading.text}</li>`)
          .join("\n");

        return content.replace("<!-- toc -->", h2);
      },
    }),
  ],
});
