/**
 * Whether a webpack/Rspack compiler builds for production. Plugins apply
 * before the bundler fills in its defaults, and an unset `mode` defaults
 * to `"production"`.
 */
export function isProduction(compiler: {
  options: { mode?: string };
}): boolean {
  return (compiler.options.mode ?? "production") === "production";
}
