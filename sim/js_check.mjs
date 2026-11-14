// Run the JavaScript simulation core (sim/hazard_sim.js) on the three documented
// agreement-check settings and save the false-positive rates to
// outputs/js_check.json. The Python test suite compares its own rates
// against this file (tests/test_js_agreement.py).
//
// Usage: node sim/js_check.mjs [n_exp]
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sim = require("../sim/hazard_sim.js");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nExp = Number(process.argv[2] || 20000);

// The three documented check settings (see PLAN.md). delta = 0 throughout,
// so "rate" is the false-positive rate at alpha = 0.05.
const CHECK_SETTINGS = {
  clean: {},
  pseudo_replication: { naive_se: true, sigma_task: 1.0 },
  compute_bundling_k3: { compute_k: 3 },
};

const results = { n_exp: nExp, alpha: 0.05, settings: {} };
for (const [name, overrides] of Object.entries(CHECK_SETTINGS)) {
  const out = sim.simulateExperiments(overrides, nExp, 20261112);
  results.settings[name] = {
    overrides,
    fpr: out.rate,
    mc_se: out.mc_se,
    mean_estimate: out.mean_estimate,
  };
  console.log(name, "fpr=", out.rate.toFixed(4), "mc_se=", out.mc_se.toFixed(4));
}
writeFileSync(join(root, "outputs", "js_check.json"), JSON.stringify(results, null, 2) + "\n");
console.log("wrote outputs/js_check.json");
