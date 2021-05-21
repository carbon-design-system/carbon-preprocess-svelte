import adapter from "@sveltejs/adapter-static";
import * as carbon from "carbon-preprocess-svelte";

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: [
    ...carbon.presetCarbon(),
    carbon.pictograms(),
    carbon.icons(),
    carbon.collectHeadings({
      afterCollect: (headings, content) => {
        const h2 = headings
          .filter((heading) => heading.level === 2)
          .map((heading) => `<li>${heading.text}</li>`)
          .join("\n");

        return content.replace("<!-- toc -->", h2);
      },
    }),
    carbon.include({
      script: [
        {
          content: `const data = {};`,
        },
      ],
      markup: [
        {
          content: "<!-- toc -->",
        },
        {
          content: "<p>Summary</p>",
          behavior: "append",
        },
      ],
    }),
  ],
  kit: {
    target: "#svelte",
    adapter: adapter(),
    vite: {
      optimizeDeps: { include: ["clipboard-copy"] },
      plugins: [process.env.NODE_ENV === "production" && carbon.optimizeCss()],
    },
  },
};
