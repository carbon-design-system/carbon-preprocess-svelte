/**
 * The key a bundler-resolved import is recorded under: `import … from
 * source` in file `from`. Its own module, so the plugins can use it without
 * loading the analyzer.
 */
export function importKey(from: string, source: string): string {
  return `${from}\0${source}`;
}
