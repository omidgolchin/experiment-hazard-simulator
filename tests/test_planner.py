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

from dataclasses import replace

from sim.planner import Design, delta_for, rate, task_diff_sd, tasks_for_80, total_sigma

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
    assert paired["rate_any"] < 0.05            # shared tasks, no interaction: conservative instead


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


# ---- task-by-version interaction (sigma_int), added 2026-11-21 ----

def test_no_interaction_is_the_original_model():
    # sigma_int = 0 draws no extra random numbers, so results are identical.
    assert rate(Design(n_tasks=40, sigma_int=0.0), 800, seed=2) == rate(Design(n_tasks=40), 800, seed=2)


@pytest.mark.parametrize("base", [0.0, 1.4])
def test_false_alarms_near_alpha_with_interaction(base):
    # The shift is split +u/2 for B and -u/2 for A, so "no difference" stays an exact null
    # even away from 50%, and fake wins split evenly between the two directions.
    r = rate(Design(n_tasks=60, base_logit=base, sigma_int=3.75), 4000, seed=12)
    assert abs(r["rate_any"] - 0.05) < 0.012
    assert abs(r["rate"] - r["rate_any"] / 2) < 0.012


def test_pooling_with_shared_tasks_fakes_wins_when_versions_favour_different_tasks():
    # The real-run finding: the pooled interval under-covers even with shared tasks.
    r = rate(Design(n_tasks=60, n_attempts=5, sigma_int=3.75, naive_se=True), 3000, seed=13)
    assert r["rate_any"] > 0.08


def test_attempts_cannot_average_away_the_interaction():
    d = Design(sigma_task=1.0, base_logit=0.0)
    floor = lambda si: (task_diff_sd(replace(d, sigma_int=si, n_attempts=40)) / task_diff_sd(replace(d, sigma_int=si, n_attempts=1))) ** 2
    assert floor(0.0) < 0.05      # without it, 40 attempts remove almost all the spread
    assert floor(3.75) > 0.45     # with it, about half the spread stays however many attempts


@pytest.mark.parametrize("si,share", [(0.0, 0.0), (1.1, 0.10), (2.0, 0.25), (3.75, 0.50)])
def test_interaction_settings_give_their_stated_share(si, share):
    d = Design(sigma_task=1.0, base_logit=0.0, sigma_int=si)
    v1 = task_diff_sd(replace(d, n_attempts=1), n_tasks=60000) ** 2
    v40 = task_diff_sd(replace(d, n_attempts=40), n_tasks=60000) ** 2
    within = (v1 - v40) * 40 / 39
    assert abs((v1 - within) / v1 - share) < 0.03


def test_sample_size_formula_delivers_80_percent_with_interaction():
    d = Design(sigma_int=2.0)
    base, delta = delta_for(0.5, 0.10, total_sigma(d))
    d = replace(d, base_logit=base, delta=delta)
    n = tasks_for_80(task_diff_sd(d), 0.10)
    r = rate(replace(d, n_tasks=n), 3000, seed=14)
    assert abs(r["rate"] - 0.80) < 0.03


@needs_node
@pytest.mark.parametrize("over", [{"sigma_int": 2.0}, {"sigma_int": 3.75, "naive_se": True, "n_attempts": 5}])
def test_js_matches_python_with_interaction(over):
    n = 3000
    cfg = dict({"n_tasks": 40, "n_attempts": 3}, **over)
    js = _js("E.rate(%s, %d, 9)" % (json.dumps(cfg), n))
    py = rate(Design(**cfg), n, seed=9)
    se = math.sqrt(js["rate_any"] * (1 - js["rate_any"]) / n + py["rate_any"] * (1 - py["rate_any"]) / n)
    assert abs(js["rate_any"] - py["rate_any"]) <= 4 * se + 0.003
    jsd = _js("E.taskDiffSd(%s)" % json.dumps(dict(cfg, n_attempts=3)))
    assert jsd == pytest.approx(task_diff_sd(Design(**dict(cfg, n_attempts=3))), rel=0.05)


@needs_node
def test_check_mode_measures_the_interaction_share():
    # 400 tasks, 5 attempts per version; per-task success chances for A and B differ by a
    # stable amount. The true share is known from the chances themselves.
    rng = np.random.default_rng(5)
    pa = rng.uniform(0.1, 0.9, 400)
    pb = np.clip(pa + rng.normal(0.05, 0.25, 400), 0.02, 0.98)
    inter = np.var(pb - pa, ddof=1)
    within1 = np.mean(pa * (1 - pa) + pb * (1 - pb))
    rows = [{"task": "t%d" % t, "version": v, "attempt": a, "success": int(rng.random() < p[t])}
            for t in range(400) for v, p in (("A", pa), ("B", pb)) for a in range(5)]
    proc = subprocess.run([NODE, "-e", "const E=require('./docs/evalsim.js'); const rows=JSON.parse(require('fs').readFileSync(0,'utf8'));"
                           " console.log(JSON.stringify(E.analyzeResults(rows, {a: 'A'})));"],
                          input=json.dumps(rows), capture_output=True, text=True, timeout=300, cwd=ROOT)
    assert proc.returncode == 0, proc.stderr
    r = json.loads(proc.stdout)
    assert r["interactionShare"] == pytest.approx(inter / (inter + within1), abs=0.06)


# ---- planning the next eval from a pilot (results checker), added 2026-11-21 ----

@needs_node
@pytest.mark.parametrize("n", [10, 30, 50, 100])
def test_pilot_margin_matches_chi_square_bound(n):
    js = _js("E.pilotMargin(%d, 0.8)" % n)
    assert js == pytest.approx((n - 1) / stats.chi2.ppf(0.2, n - 1), rel=0.01)


@needs_node
def test_plan_from_pilot_matches_the_variance_formula():
    rng = np.random.default_rng(8)
    pa = rng.uniform(0.2, 0.8, 60)
    pb = np.clip(pa + rng.normal(0.08, 0.2, 60), 0.02, 0.98)
    A = (rng.random((60, 3)) < pa[:, None]).astype(float)
    B = (rng.random((60, 3)) < pb[:, None]).astype(float)
    rows = [{"task": "t%d" % t, "version": v, "attempt": a, "success": int(M[t, a])}
            for t in range(60) for v, M in (("A", A), ("B", B)) for a in range(3)]
    proc = subprocess.run([NODE, "-e", "const E=require('./docs/evalsim.js'); const rows=JSON.parse(require('fs').readFileSync(0,'utf8'));"
                           " const r=E.analyzeResults(rows, {a: 'A'}); console.log(JSON.stringify(E.planFromPilot(r, 0.1, [1, 3, 6])));"],
                          input=json.dumps(rows), capture_output=True, text=True, timeout=300, cwd=ROOT)
    plan = json.loads(proc.stdout)
    from validation.check_pilot_margin import margin, pilot_components
    I, W = pilot_components(A, B)
    for row in plan["rows"]:
        v = I + W / row["attempts"]
        assert row["plain"] == tasks_for_80(math.sqrt(v), 0.1)
        assert abs(row["tasks"] - tasks_for_80(math.sqrt(v * margin(60)), 0.1)) <= 1  # Wilson-Hilferty vs exact
