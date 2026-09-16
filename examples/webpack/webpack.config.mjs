// @ts-check
import path from "node:path";
import { OptimizeCssPlugin, optimizeImports } from "carbon-preprocess-svelte";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import { sveltePreprocess } from "svelte-preprocess";
import webpack from "webpack";

/** @type {"development" | "production"} */
const NODE_ENV =
  process.env.NODE_ENV === "production" ? "production" : "development";
const PROD = NODE_ENV === "production";

// Minimal stand-in for html-webpack-plugin: writes a static HTML shell,
// injecting the entry's actual (possibly hashed) script/link tags.
const emitHtml = {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("emit-html", (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: "emit-html",
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          const files = compilation.entrypoints.get("build/bundle").getFiles();
          const js = files.find((file) => file.endsWith(".js"));
          const css = files.find((file) => file.endsWith(".css"));
          const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="/${css}" rel="stylesheet" />
  </head>
  <body>
    <script defer src="/${js}"></script>
  </body>
</html>
`;
          compilation.emitAsset(
            "index.html",
            new webpack.sources.RawSource(html),
          );
        },
      );
    });
  },
};

/** @type {import("webpack").Configuration} */
export default {
  entry: { "build/bundle": ["./src/index.ts"] },
  resolve: {
    extensions: [".mjs", ".js", ".svelte"],
    conditionNames: ["svelte", "browser", "import"],
  },
  output: {
    publicPath: "/",
    path: path.resolve("./public"),
    filename: PROD ? "[name].[contenthash].js" : "[name].js",
    chunkFilename: "[name].[id].js",
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.svelte$/,
        use: {
          loader: "svelte-loader",
          options: {
            hotReload: !PROD,
            preprocess: [sveltePreprocess(), optimizeImports()],
            compilerOptions: { dev: !PROD },
          },
        },
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, "css-loader"],
      },
      {
        test: /node_modules\/svelte\/.*\.mjs$/,
        resolve: { fullySpecified: false },
      },
    ],
  },
  mode: NODE_ENV,
  plugins: [
    new OptimizeCssPlugin(),
    new MiniCssExtractPlugin({
      filename: PROD ? "[name].[chunkhash].css" : "[name].css",
    }),
    emitHtml,
  ],
  stats: "errors-only",
  devtool: PROD ? false : "source-map",
  devServer: { hot: true, historyApiFallback: true },
};
