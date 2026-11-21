"""Check the planner's task counts against real repeated runs.

Data: 3 models x 400 GSM8K questions x 5 runs each (6,000 runs) from the
error-bars study, github.com/omidgolchin/llm-eval-error-bars
(outputs/correctness.parquet, copied here as gsm8k_runs.csv.gz).

For each pair of models (A = the weaker one, B = the stronger), the planner
is given what a user would enter: A's success rate, the gain B really shows,
"Very mixed" task difficulty, and each setting of "Do the versions favour
different tasks?". It returns the tasks needed for 80% power at 1, 3 and 5
runs per question. Evals of that size are then drawn again and again from
the 400 real questions, and we count how often a paired t-test on per-question
differences finds B better: the power the plan actually delivers.

Run: python -m validation.check_real_runs  (writes validation/results.json)
"""

from __future__ import annotations

import json
import math
from dataclasses import replace
from pathlib import Path

import csv
import gzip

import numpy as np
from scipy import stats

from sim.planner import Design, delta_for, task_diff_sd, tasks_for_80, total_sigma

HERE = Path(__file__).resolve().parent
PAIRS = [("qwen-2-1.5b-instruct", "Muse-Glimmer-30B"), ("Muse-Glimmer-30B", "Inkling"), ("qwen-2-1.5b-instruct", "Inkling")]
VARY = {"No": 0.0, "A little": 1.1, "Somewhat": 2.0, "A lot, like two different models": 3.75}
SPREAD = 2.0  # "Very mixed"


def load():
    """{model: (questions x 5 runs) array of 0/1}, rows in the same question order."""
    cells = {}
    with gzip.open(HERE / "gsm8k_runs.csv.gz", "rt") as f:
        for r in csv.DictReader(f):
            cells.setdefault(r["model"], {}).setdefault(r["question_id"], {})[int(r["seed"])] = float(r["correct"])
    qs = sorted(set.intersection(*[set(v) for v in cells.values()]))
    return {m: np.array([[v[q][s] for s in sorted(v[q])] for q in qs]) for m, v in cells.items()}


def interaction_share(A, B):
    """As in the results checker: the stable part of the per-question
    difference, over that part plus the single-run noise."""
    K = A.shape[1]
    wA, wB = A.var(axis=1, ddof=1), B.var(axis=1, ddof=1)
    inter = max(0.0, (B.mean(1) - A.mean(1)).var(ddof=1) - np.mean((wA + wB) / K))
    return inter / (inter + float(np.mean(wA + wB)))


def real_power(A, B, n, K, rng, reps=3000):
    """Share of n-question evals, drawn with replacement from the real runs
    (K of the 5 runs per question per model), where a paired t-test finds B
    significantly better at the 5% level."""
    N, R = A.shape
    idx = rng.integers(0, N, (reps, n))
    if K == 1:
        d = B[idx, rng.integers(0, R, (reps, n))] - A[idx, rng.integers(0, R, (reps, n))]
    else:
        runs = np.argsort(rng.random((reps, n, R)), axis=2)[:, :, :K]
        d = np.take_along_axis(B[idx], runs, 2).mean(2) - np.take_along_axis(A[idx], runs, 2).mean(2)
    m, s = d.mean(1), d.std(1, ddof=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        t = m / (s / math.sqrt(n))
    p = 2 * stats.t.sf(np.abs(t), n - 1)
    return float(np.mean((p < 0.05) & (t > 0) & (s > 0)))


def main(reps=3000, seed=7):
    M = load()
    rng = np.random.default_rng(seed)
    rows = []
    for a, b in PAIRS:
        A, B = M[a], M[b]
        rate, gain = float(A.mean()), float(B.mean() - A.mean())
        for label, si in VARY.items():
            d = Design(sigma_task=SPREAD, sigma_int=si)
            base, delta = delta_for(rate, gain, total_sigma(d))
            d = replace(d, base_logit=base, delta=delta)
            for K in (1, 3, 5):
                n = tasks_for_80(task_diff_sd(replace(d, n_attempts=K), n_tasks=40000), gain)
                rows.append({"pair": f"{a} -> {b}", "rate_a": round(rate, 3), "gain": round(gain, 3),
                             "measured_interaction_share": round(float(interaction_share(A, B)), 2),
                             "setting": label, "attempts": K, "planned_tasks": n,
                             "real_power": round(real_power(A, B, n, K, rng, reps), 3)})
    (HERE / "results.json").write_text(json.dumps(rows, indent=1) + "\n")
    return rows


if __name__ == "__main__":
    for r in main():
        print(r)
