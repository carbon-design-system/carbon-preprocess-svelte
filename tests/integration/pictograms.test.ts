import { testFiles } from "./utils";
import { pictograms } from "../../src";

testFiles({
  name: "pictograms",
  preprocessor: [pictograms()],
});
