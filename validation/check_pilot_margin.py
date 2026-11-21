"""Planning the next eval from a small pilot: does a safety margin help?

A researcher runs a pilot (n questions, 3 runs per question per model),
pastes it into the results checker, and asks how many questions the real
eval needs for 80% power at 1, 3 or 5 runs per question. The checker splits
the spread of per-question differences into a stable part I (questions that
suit one model better) and single-run noise W, and plans with I + W/K.

Plain plan: the pilot's estimates as they are. Margin plan: the variance
raised to its one-sided 80% upper confidence bound, (n - 1) / chi2_0.20(n - 1),
because a small pilot underestimates the variance about half the time.

For each pair of models in the real GSM8K runs (validation/gsm8k_runs.csv.gz),
we draw many random pilots, plan both ways, and measure the power each plan
really delivers on the other questions (paired t-test, evals drawn with
replacement from the held-out questions). The gain to detect is the gain
those held-out questions really show, so only the variance is being tested.

Run: python -m validation.check_pilot_margin  (writes validation/pilot_margin.json)
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from scipy import stats

from sim.planner import tasks_for_80
from validation.check_real_runs import PAIRS, load, real_power

HERE = Path(__file__).resolve().parent
PILOT_RUNS = 3


def pilot_components(A, B):
    """Stable (I) and single-run (W) variance of per-question differences, as
    in the results checker (docs/evalsim.js, analyzeResults)."""
    K = A.shape[1]
    va, vb = A.var(axis=1, ddof=1), B.var(axis=1, ddof=1)
    d = B.mean(1) - A.mean(1)
    inter = max(0.0, d.var(ddof=1) - float(np.mean((va + vb) / K)))
    return inter, float(np.mean(va + vb))


def margin(n: int, level: float = 0.8) -> float:
    return (n - 1) / stats.chi2.ppf(1 - level, n - 1)


def main(n_pilots=150, reps=600, sizes=(30, 50), seed=11, write=True):
    M = load()
    rng = np.random.default_rng(seed)
    out = []
    for n in sizes:
        for a, b in PAIRS:
            A, B = M[a], M[b]
            cell = {(k, K): [] for k in ("plain", "margin") for K in (1, 3, 5)}
            for _ in range(n_pilots):
                perm = rng.permutation(A.shape[0])
                pil, held = perm[:n], perm[n:]
                I, W = pilot_components(A[pil, :PILOT_RUNS], B[pil, :PILOT_RUNS])
                gain = float(B[held].mean() - A[held].mean())
                for K in (1, 3, 5):
                    v = I + W / K
                    for kind, f in (("plain", 1.0), ("margin", margin(n))):
                        t = tasks_for_80(math.sqrt(v * f), gain)
                        cell[(kind, K)].append(real_power(A[held], B[held], t, K, rng, reps))
            for (kind, K), pw in cell.items():
                pw = np.array(pw)
                out.append({"pilot_questions": n, "pair": f"{a} -> {b}", "plan": kind, "runs_per_question": K,
                            "share_reaching_80": round(float(np.mean(pw >= 0.8)), 3),
                            "share_reaching_75": round(float(np.mean(pw >= 0.75)), 3),
                            "mean_power": round(float(pw.mean()), 3), "p10_power": round(float(np.quantile(pw, 0.1)), 3)})
    if write:
        (HERE / "pilot_margin.json").write_text(json.dumps(out, indent=1) + "\n")
    return out


if __name__ == "__main__":
    for r in main():
        print(r)
