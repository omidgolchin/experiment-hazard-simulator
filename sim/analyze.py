"""Run the pre-registered sweeps and regenerate every output.

    python -m sim.analyze

Writes:
- outputs/sweep_results.json   full sweep + headline numbers
- results/summary.md           the write-up tables
- results/figures/fpr_sweeps.png / .pdf   FPR vs hazard strength, 8 panels
- results/data/sweep.json      compact copy of the sweeps

All numbers come from sim.model at the settings frozen in PLAN.md /
config.yaml. Everything is simulated; there is no empirical data.
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from .hazards import HAZARDS
from .model import Settings, simulate_experiments

ROOT = Path(__file__).resolve().parent.parent
SEED = 20261112
SWEEP_N = 4000  # experiments per sweep point
HEADLINE_N = 10000  # experiments per headline / realistic-setting number


def _run(overrides: dict, n: int, seed: int, delta: float = 0.0) -> dict:
    out = simulate_experiments(Settings(delta=delta, **overrides), n, seed=seed)
    return {
        "rate": out["rate"],
        "mc_se": out["mc_se"],
        "mean_estimate": out["mean_estimate"],
        "n_exp": n,
    }


def main() -> None:
    results: dict = {"seed": SEED, "sweeps": {}, "realistic": {}, "headline": {}}

    # Headline numbers: clean design (FPR and power), at delta = 0 / 0.3 / 0.6.
    results["headline"]["clean_fpr"] = _run({}, HEADLINE_N, SEED)
    results["headline"]["clean_power_delta_0.3"] = _run({}, HEADLINE_N, SEED + 1, delta=0.3)
    results["headline"]["clean_power_delta_0.6"] = _run({}, HEADLINE_N, SEED + 2, delta=0.6)
    # The honest case: pseudo-replication when tasks are homogeneous.
    results["headline"]["pseudo_sigma0_fpr"] = _run(
        {"naive_se": True, "sigma_task": 0.0}, HEADLINE_N, SEED + 3
    )
    # Two hazards at once, at their realistic settings.
    results["headline"]["two_hazards_fpr"] = _run(
        {"compute_k": 3, "naive_se": True}, HEADLINE_N, SEED + 4
    )

    # Sweeps: one hazard at a time, strength from 0 (off) upward, delta = 0.
    for i, hz in enumerate(HAZARDS):
        points = []
        for j, value in enumerate(hz["sweep"]):
            overrides = dict(hz.get("base_overrides", {}))
            overrides[hz["param"]] = value
            r = _run(overrides, SWEEP_N, SEED + 100 * (i + 1) + j)
            points.append({"x": value, **r})
        results["sweeps"][hz["id"]] = {
            "param": hz["param"],
            "param_label": hz["param_label"],
            "points": points,
        }
        rr = _run(dict(hz["realistic"]), HEADLINE_N, SEED + 500 + i)
        results["realistic"][hz["id"]] = rr
        print(hz["id"], "realistic FPR %.3f bias %+.3f" % (rr["rate"], rr["mean_estimate"]))

    (ROOT / "outputs").mkdir(exist_ok=True)
    (ROOT / "outputs" / "sweep_results.json").write_text(json.dumps(results, indent=2) + "\n")

    _write_summary(results)
    _write_figure(results)
    _write_playground_data(results)
    print("done")


def _write_summary(results: dict) -> None:
    h = results["headline"]
    lines = [
        "# Results — experiment hazard simulator",
        "",
        "All data are simulated. Each number is the share of simulated "
        "experiments (true effect delta = 0 unless stated) that report a "
        "statistically significant effect at alpha = 0.05 — the "
        "false-positive rate (FPR) — plus the mean estimated effect "
        "(success-rate difference, B − A). Defaults: 20 tasks and 5 seeds "
        "per condition, sigma_task = 1, base success rate 0.5. "
        "Sweep points use %d experiments each; headline and realistic-setting "
        "numbers use %d." % (SWEEP_N, HEADLINE_N),
        "",
        "## Headline numbers",
        "",
        "| Setting | FPR / power | Mean estimate |",
        "|---|---|---|",
        "| Clean design, delta = 0 (false-positive rate) | %.3f | %+.3f |"
        % (h["clean_fpr"]["rate"], h["clean_fpr"]["mean_estimate"]),
        "| Clean design, delta = 0.3 (power) | %.3f | %+.3f |"
        % (h["clean_power_delta_0.3"]["rate"], h["clean_power_delta_0.3"]["mean_estimate"]),
        "| Clean design, delta = 0.6 (power) | %.3f | %+.3f |"
        % (h["clean_power_delta_0.6"]["rate"], h["clean_power_delta_0.6"]["mean_estimate"]),
        "| Pseudo-replication with sigma_task = 0 (the honest case) | %.3f | %+.3f |"
        % (h["pseudo_sigma0_fpr"]["rate"], h["pseudo_sigma0_fpr"]["mean_estimate"]),
        "| Two hazards at once (best-of-3 + naive SE) | %.3f | %+.3f |"
        % (h["two_hazards_fpr"]["rate"], h["two_hazards_fpr"]["mean_estimate"]),
        "",
        "## Each hazard at a realistic setting (delta = 0)",
        "",
        "| Hazard | Setting | FPR | Mean estimate | Check that catches it |",
        "|---|---|---|---|---|",
    ]
    for hz in HAZARDS:
        r = results["realistic"][hz["id"]]
        setting = ", ".join("%s = %s" % (k, v) for k, v in hz["realistic"].items())
        lines.append(
            "| %s | %s | %.3f | %+.3f | %s |"
            % (hz["name"], setting, r["rate"], r["mean_estimate"], hz["check_short"])
        )
    lines += [
        "",
        "## Sweeps (delta = 0, %d experiments per point)" % SWEEP_N,
        "",
    ]
    for hz in HAZARDS:
        sw = results["sweeps"][hz["id"]]
        lines.append("### %s — %s" % (hz["name"], hz["param_label"]))
        lines.append("")
        lines.append("| %s | FPR | MC SE | Mean estimate |" % hz["param"])
        lines.append("|---|---|---|---|")
        for p in sw["points"]:
            lines.append(
                "| %s | %.3f | %.3f | %+.3f |" % (p["x"], p["rate"], p["mc_se"], p["mean_estimate"])
            )
        lines.append("")
    lines.append("Figure: `results/figures/fpr_sweeps.png` — one panel per hazard.")
    lines.append("")
    (ROOT / "results" / "summary.md").write_text("\n".join(lines))


def _write_figure(results: dict) -> None:
    fig, axes = plt.subplots(2, 4, figsize=(13, 6.5), sharey=True)
    for ax, hz in zip(axes.flat, HAZARDS):
        pts = results["sweeps"][hz["id"]]["points"]
        xs = [p["x"] for p in pts]
        ys = [p["rate"] for p in pts]
        es = [1.96 * p["mc_se"] for p in pts]
        ax.errorbar(xs, ys, yerr=es, marker="o", ms=4, lw=1.2, capsize=2)
        ax.axhline(0.05, color="grey", ls="--", lw=1)
        ax.set_title(hz["name"], fontsize=10)
        ax.set_xlabel(hz["param"], fontsize=9)
        ax.set_ylim(-0.03, 1.03)
        ax.tick_params(labelsize=8)
    for ax in axes[:, 0]:
        ax.set_ylabel("false-positive rate")
    fig.suptitle(
        "False-positive rate vs hazard strength (true effect = 0; dashed line = nominal 5%)",
        fontsize=11,
    )
    fig.tight_layout(rect=(0, 0, 1, 0.96))
    out = ROOT / "results" / "figures"
    out.mkdir(parents=True, exist_ok=True)
    fig.savefig(out / "fpr_sweeps.png", dpi=150)
    fig.savefig(out / "fpr_sweeps.pdf")
    plt.close(fig)


def _write_playground_data(results: dict) -> None:
    compact = {
        "note": "Precomputed with the Python model (sim/model.py); the playground "
        "also simulates live in JavaScript and the two agree within Monte Carlo error.",
        "headline": results["headline"],
        "realistic": results["realistic"],
        "sweeps": results["sweeps"],
    }
    path = ROOT / "results" / "data" / "sweep.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(compact, indent=1) + "\n")


if __name__ == "__main__":
    main()
