"""The JavaScript and Python simulators must agree on the false-positive
rate within Monte Carlo error on three documented settings (PLAN.md).

The JS side is the saved output of `node sim/js_check.mjs`
(outputs/js_check.json, committed). This test recomputes the Python side
and compares. Regenerate the JS side after any change to docs/sim.js.
"""

import json
import math
from pathlib import Path

from sim.model import Settings, simulate_experiments

ROOT = Path(__file__).resolve().parent.parent
SEED = 20261112  # must match sim/js_check.mjs


def test_js_python_agreement():
    saved = json.loads((ROOT / "outputs" / "js_check.json").read_text())
    n = saved["n_exp"]
    for name, entry in saved["settings"].items():
        py = simulate_experiments(Settings(**entry["overrides"]), n, seed=SEED)
        tol = 4.0 * math.sqrt(py["mc_se"] ** 2 + entry["mc_se"] ** 2)
        diff = abs(py["rate"] - entry["fpr"])
        assert diff <= tol, (
            "%s: python FPR %.4f vs JS %.4f (diff %.4f > tol %.4f)"
            % (name, py["rate"], entry["fpr"], diff, tol)
        )
