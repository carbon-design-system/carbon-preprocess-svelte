import { testFiles } from "./utils";
import { icons } from "../../src";

testFiles({
  name: "icons",
  preprocessor: [icons()],
});
