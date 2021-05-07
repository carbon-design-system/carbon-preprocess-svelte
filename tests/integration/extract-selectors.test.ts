import { testFiles } from "./utils";
import { extractSelectors } from "../../src";

testFiles({
  name: "extract-selectors",
  outFileFormat: "json",
  onReadFile: (content, filename) => extractSelectors(content, filename),
});
