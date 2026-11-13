"""Behavioural tests for the Python simulation model.

Tolerances are Monte Carlo tolerances: at these replication counts the
standard error of a rate near 0.05 is ~0.005, so bands are set at roughly
four or more standard errors.
"""

from sim.model import Settings, simulate_experiments

N = 4000


def rate(**kw):
    return simulate_experiments(Settings(**kw), N, seed=42)


def test_clean_design_fpr_is_nominal():
    r = rate()
    assert 0.03 < r["rate"] < 0.07
    assert abs(r["mean_estimate"]) < 0.01


def test_determinism():
    a = simulate_experiments(Settings(), 500, seed=7)
    b = simulate_experiments(Settings(), 500, seed=7)
    assert a["rate"] == b["rate"]
    assert a["mean_estimate"] == b["mean_estimate"]


def test_pseudo_replication_harmless_when_tasks_homogeneous():
    clean = rate()["rate"]
    pseudo0 = rate(naive_se=True, sigma_task=0.0)["rate"]
    assert abs(pseudo0 - clean) < 0.025


def test_pseudo_replication_inflates_when_tasks_vary():
    clean = rate()["rate"]
    pseudo = rate(naive_se=True, sigma_task=1.0)["rate"]
    assert pseudo > clean + 0.04


def test_compute_bundling_biases_estimate_up():
    r = rate(compute_k=3)
    assert r["mean_estimate"] > 0.15
    assert r["rate"] > 0.5


def test_exclusion_biases_estimate_up():
    r = rate(err_excess=0.8)
    assert r["mean_estimate"] > 0.02


def test_parse_rule_biases_estimate_down_for_b_wrong():
    r = rate(parse_fail_rate=0.15)
    assert r["mean_estimate"] < -0.03


def test_parse_rule_reverse_flips_sign():
    r = rate(parse_fail_rate=0.15, parse_rule="a_wrong_b_missing")
    assert r["mean_estimate"] > 0.03


def test_judge_bias_inflates_fpr():
    assert rate(judge_bias=0.2)["rate"] > rate()["rate"] + 0.05


def test_selective_reporting_inflates_fpr():
    assert rate(n_outcomes=8)["rate"] > rate(n_outcomes=1)["rate"] + 0.08


def test_power_increases_with_delta():
    lo = simulate_experiments(Settings(delta=0.3), N, seed=42)["rate"]
    hi = simulate_experiments(Settings(delta=0.6), N, seed=42)["rate"]
    assert hi > lo > rate()["rate"]
