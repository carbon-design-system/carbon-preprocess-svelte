import { testFiles } from "./utils";
import { elements } from "../../src";

testFiles({
  name: "elements-css-vars",
  preprocessor: [elements({ cssVars: true })],
});
