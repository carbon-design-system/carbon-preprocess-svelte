import prettier from "prettier";

const pkgJson = await Bun.file("./package.json").json();

// Remove unrelated metadata from package.json for publishing.
delete pkgJson.scripts;
delete pkgJson.devDependencies;

await Bun.write(
  "./package.json",
  await prettier.format(JSON.stringify(pkgJson), { parser: "json" }),
);
