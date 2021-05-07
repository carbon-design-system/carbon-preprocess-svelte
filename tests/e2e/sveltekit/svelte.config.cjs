const static = require("@sveltejs/adapter-static");
const carbon = require("carbon-preprocess-svelte");

/** @type {import('@sveltejs/kit').Config} */
module.exports = {
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
  ],
  kit: {
    target: "#svelte",
    adapter: static(),
    vite: {
      optimizeDeps: { include: ["carbon-components-svelte", "clipboard-copy"] },
      plugins: [process.env.NODE_ENV === "production" && carbon.optimizeCss()],
    },
  },
};
