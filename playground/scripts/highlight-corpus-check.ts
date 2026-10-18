// Tokenizes every code sample in a CCS checkout's docs and flags lexer
// failures: a corpus test for the highlighter.
//
//   CCS_DIR=../carbon-components-svelte bun scripts/highlight-corpus-check.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { type Block, parseDocument } from "../../src/markdown/blocks";
import { splitFrontmatter } from "../../src/markdown/frontmatter";
import { tokenize } from "../../src/markdown/highlight";

if (!process.env.CCS_DIR) {
  console.error("Set CCS_DIR to a carbon-components-svelte checkout.");
  process.exit(1);
}
const DOCS = path.join(path.resolve(process.env.CCS_DIR), "docs/src");
const samples: { lang: string; code: string; where: string }[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    const p = path.join(d, e);
    statSync(p).isDirectory()
      ? walk(p)
      : p.endsWith(".svelte") &&
        samples.push({
          lang: "svelte",
          code: readFileSync(p, "utf8"),
          where: p.slice(DOCS.length),
        });
  }
};
walk(`${DOCS}/pages/framed`);
for (const f of readdirSync(`${DOCS}/pages/components`).filter((f) =>
  f.endsWith(".svx"),
)) {
  const { blocks } = parseDocument(
    splitFrontmatter(readFileSync(`${DOCS}/pages/components/${f}`, "utf8"))
      .body,
  );
  const walkBlocks = (bs: Block[]) => {
    for (const b of bs) {
      if (b.type === "code")
        samples.push({ lang: b.lang || "text", code: b.value, where: f });
      if (b.type === "svelte" && !/^<script/.test(b.value))
        samples.push({ lang: "svelte", code: b.value, where: f });
      if ("children" in b) walkBlocks(b.children);
      if (b.type === "list")
        for (const item of b.items) walkBlocks(item.children);
    }
  };
  walkBlocks(blocks);
}
const bytes = samples.reduce((n, s) => n + s.code.length, 0);
const t = performance.now();
let unknownLang = 0;
const issues: string[] = [];
const langs: Record<string, number> = {};
for (const s of samples) {
  langs[s.lang] = (langs[s.lang] ?? 0) + 1;
  const tokens = tokenize(s.code, s.lang);
  if (!tokens) {
    unknownLang++;
    continue;
  }
  if (tokens.map((x) => x.text).join("") !== s.code)
    issues.push(`lossy: ${s.where}`);
  for (const k of tokens) {
    if (
      k.type === "string" &&
      k.text.length > 1 &&
      !/^(["'`]).*\1$/s.test(k.text)
    )
      issues.push(
        `unclosed string in ${s.where}: ${JSON.stringify(k.text.slice(0, 50))}`,
      );
    if (
      k.type === "comment" &&
      k.text.startsWith("/*") &&
      !k.text.endsWith("*/")
    )
      issues.push(`unclosed comment in ${s.where}`);
    if (k.type === "regexp")
      issues.push(
        `regexp in ${s.where}: ${JSON.stringify(k.text.slice(0, 40))}`,
      );
    if (k.type === "string" && k.text.split("\n").length > 3)
      issues.push(
        `multi-line string in ${s.where}: ${JSON.stringify(k.text.slice(0, 40))}`,
      );
  }
}
const ms = performance.now() - t;
console.log({
  samples: samples.length,
  langs,
  kb: Math.round(bytes / 1024),
  ms: Math.round(ms),
  unknownLang,
  issues: issues.length,
});
const counts: Record<string, number> = {};
for (const i of issues) {
  const k = i.split(" in ")[0].split(":")[0];
  counts[k] = (counts[k] ?? 0) + 1;
}
console.log(counts);
console.log(issues.slice(0, 25).join("\n"));
