import assert from "assert";
import * as api from "../../src";

assert.strictEqual(typeof api.collectHeadings, "function");
assert.strictEqual(typeof api.elements, "function");
assert.strictEqual(typeof api.extractSelectors, "function");
assert.strictEqual(typeof api.icons, "function");
// TODO: uncomment
// assert.strictEqual(typeof api.optimizeCss, "function");
assert.strictEqual(typeof api.optimizeImports, "function");
assert.strictEqual(typeof api.optimizeCarbonImports, "function");
assert.strictEqual(typeof api.pictograms, "function");
assert.strictEqual(typeof api.presetCarbon, "function");
