import { group, task } from "ostia";
import { optimizeCssWithReport } from "../src/plugins/create-optimized-css";
import { resolveCarbonCss } from "../tests/helpers/carbon-css";

// Real Carbon theme CSS (~700kb minified), same source the plugin optimizes
// at build time. Any theme works for selector coverage.
const source = resolveCarbonCss("white");

type Scenario = { name: string; ids: string[] };

const SCENARIOS: Scenario[] = [
  { name: "single component (Button)", ids: ["Button"] },
  {
    name: "small bundle (DataTable+Toolbar+OverflowMenu)",
    ids: ["DataTable", "Toolbar", "ToolbarSearch", "OverflowMenu"],
  },
  {
    name: "large bundle (UIShell)",
    ids: ["Header", "SideNav", "SideNavItems", "HeaderGlobalAction"],
  },
];

for (const scenario of SCENARIOS) {
  group(scenario.name, () => {
    task("optimizeCssWithReport", () => {
      optimizeCssWithReport({
        source,
        ids: scenario.ids,
        silent: true,
      });
    });
  });
}
