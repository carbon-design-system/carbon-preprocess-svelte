import { testFiles } from "./utils";
import { optimizeImports } from "../../src";

testFiles({
  name: "optimize-imports",
  preprocessor: [optimizeImports()],
});
