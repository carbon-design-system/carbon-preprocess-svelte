import path from "node:path";
import carbonPreprocess from "carbon-preprocess-svelte";
// @ts-check
import HtmlWebpackPlugin from "html-webpack-plugin";
import MiniCssExtractPlugin from "mini-css-extract-plugin";

const { optimizeImports, OptimizeCssPlugin } = carbonPreprocess;

/** @type {"development" | "production"} */
const NODE_ENV =
  process.env.NODE_ENV === "production" ? "production" : "development";
const PROD = NODE_ENV === "production";

/** @type {import("webpack").Configuration} */
export default {
  entry: { "build/bundle": ["./src/index.js"] },
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
            preprocess: [optimizeImports()],
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
    PROD && new OptimizeCssPlugin(),
    new MiniCssExtractPlugin({
      filename: PROD ? "[name].[chunkhash].css" : "[name].css",
    }),
    new HtmlWebpackPlugin({
      templateContent: `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        </head>
        <body></body>
      </html>
      `,
    }),
  ],
  stats: "errors-only",
  devtool: PROD ? false : "source-map",
  devServer: { hot: true, historyApiFallback: true },
};
