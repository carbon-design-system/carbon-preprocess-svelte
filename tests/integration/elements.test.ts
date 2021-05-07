import { testFiles } from "./utils";
import { elements } from "../../src";

testFiles({
  name: "elements",
  preprocessor: [elements()],
});
