"""Tests for the Agent Eval Planner engine (docs/evalsim.js) against the
NumPy reference (sim/planner.py) and against scipy."""

import json
import math
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
from scipy import stats

from sim.planner import Design, delta_for, rate, task_diff_sd, tasks_for_80

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node not available")
SIG = math.sqrt(1.25)


def _js(expr: str):
    proc = subprocess.run([NODE, "-e", "const E=require('./docs/evalsim.js'); console.log(JSON.stringify(%s));" % expr],
                          capture_output=True, text=True, timeout=300, cwd=ROOT)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def test_clean_design_false_alarms_near_alpha():
    r = rate(Design(n_tasks=60), 4000, seed=1)
    assert abs(r["rate_any"] - 0.05) < 0.012


def test_sample_size_formula_delivers_80_percent():
    base, delta = delta_for(0.5, 0.10, SIG)
    d = Design(base_logit=base, delta=delta)
    n = tasks_for_80(task_diff_sd(d), 0.10)
    r = rate(Design(n_tasks=n, base_logit=base, delta=delta), 3000, seed=3)
    assert abs(r["rate"] - 0.80) < 0.03


def test_pooling_attempts_inflates_false_alarms_only_without_pairing():
    unpaired = rate(Design(n_tasks=60, paired=False, naive_se=True, sigma_task=2), 3000, seed=4)
    paired = rate(Design(n_tasks=60, paired=True, naive_se=True, sigma_task=2), 3000, seed=4)
    assert unpaired["rate_any"] > 0.08          # pseudo-replication: too many fake wins
    assert paired["rate_any"] < 0.05            # with shared tasks it is conservative instead


@pytest.mark.parametrize("hazard", [{"compute_k": 3}, {"judge_bias": 0.2}, {"n_outcomes": 5}, {"prompt_cue": 0.4}])
def test_hazards_raise_false_alarms(hazard):
    assert rate(Design(n_tasks=60, **hazard), 1500, seed=5)["rate_any"] > 0.10


@needs_node
@pytest.mark.parametrize("over", [{}, {"naive_se": True, "paired": False, "sigma_task": 2}, {"judge_bias": 0.1}, {"err_excess": 0.4}])
def test_js_matches_python_false_alarms(over):
    n = 3000
    js = _js("E.rate(%s, %d, 9)" % (json.dumps(dict({"n_tasks": 40, "n_attempts": 3}, **over)), n))
    py = rate(Design(n_tasks=40, n_attempts=3, **over), n, seed=9)
    se = math.sqrt(js["rate_any"] * (1 - js["rate_any"]) / n + py["rate_any"] * (1 - py["rate_any"]) / n)
    assert abs(js["rate_any"] - py["rate_any"]) <= 4 * se + 0.003


@needs_node
def test_js_matches_python_power_and_effect_size():
    base, delta = delta_for(0.4, 0.08, SIG)
    js = _js("[E.baseFor(0.4, %r), E.deltaFor(0.4, 0.08, %r)]" % (SIG, SIG))
    assert js[0] == pytest.approx(base, abs=0.01) and js[1] == pytest.approx(delta, abs=0.01)
    n = 2000
    jp = _js("E.rate({n_tasks:80,n_attempts:2,base_logit:%r,delta:%r}, %d, 3)" % (base, delta, n))["rate"]
    pp = rate(Design(n_tasks=80, n_attempts=2, base_logit=base, delta=delta), n, seed=3)["rate"]
    assert abs(jp - pp) <= 4 * math.sqrt(2 * 0.25 / n)


@needs_node
def test_check_mode_matches_scipy_paired_t():
    rng = np.random.default_rng(0)
    rows = []
    for t in range(30):
        d = rng.normal(0, 1.5)
        for v, eff in (("A", 0), ("B", 0.6)):
            for a in range(4):
                rows.append({"task": "t%d" % t, "version": v, "attempt": a,
                             "success": int(rng.random() < 1 / (1 + np.exp(-(d + eff))))})
    r = _js("E.analyzeResults(%s, {a: 'A'})" % json.dumps(rows))
    per = {}
    for row in rows:
        per.setdefault(row["task"], {"A": [], "B": []})[row["version"]].append(row["success"])
    diffs = np.array([np.mean(v["B"]) - np.mean(v["A"]) for v in per.values()])
    res = stats.ttest_1samp(diffs, 0)
    ci = res.confidence_interval(0.95)
    assert r["diff"] == pytest.approx(diffs.mean())
    assert r["p"] == pytest.approx(res.pvalue, rel=1e-4)
    assert r["lo"] == pytest.approx(ci.low, abs=1e-4) and r["hi"] == pytest.approx(ci.high, abs=1e-4)


@needs_node
def test_check_mode_flags_unequal_attempts_and_unmatched_tasks():
    rows = [{"task": "t1", "version": "A", "attempt": 1, "success": 1}, {"task": "t1", "version": "B", "attempt": 1, "success": 1},
            {"task": "t1", "version": "B", "attempt": 2, "success": 0}, {"task": "t2", "version": "A", "attempt": 1, "success": 0},
            {"task": "t2", "version": "B", "attempt": 1, "success": 1}, {"task": "t3", "version": "B", "attempt": 1, "success": 1}]
    r = _js("E.analyzeResults(%s, {a: 'A'})" % json.dumps(rows))
    assert r["attemptsA"] == 2 and r["attemptsB"] == 4
    assert r["onlyOne"] == ["t3"] and r["paired"] == 2
