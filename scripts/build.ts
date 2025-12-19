import { $, build } from "bun";
import pkg from "../package.json";

await $`rm -rf dist; mkdir dist`;

const result = await build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  format: "esm",
  target: "node",
  minify: false,
  sourcemap: false,
  external: Object.keys(pkg.dependencies),
});

if (!result.success) {
  console.error("Build failed");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

try {
  const ts = await import("typescript");
  const configPath = ts.findConfigFile(
    ".",
    ts.sys.fileExists,
    "tsconfig.build.json",
  );

  if (!configPath) {
    throw new Error("Could not find tsconfig.build.json");
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `Failed to read tsconfig: ${ts.formatDiagnostic(
        configFile.error,
        ts.createCompilerHost({}),
      )}`,
    );
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    "./",
  );

  const program = ts.createProgram(
    parsedConfig.fileNames,
    parsedConfig.options,
  );
  const emitResult = program.emit();
  const allDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics);

  if (allDiagnostics.length > 0) {
    const host = ts.createCompilerHost(parsedConfig.options);
    for (const diagnostic of allDiagnostics) {
      console.error(ts.formatDiagnostic(diagnostic, host));
    }
  }
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
}
