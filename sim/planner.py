"""Agent Eval Planner: reference implementation of docs/evalsim.js.

Same model, vectorized with NumPy. tests/test_planner.py checks that the
two agree on false-alarm rates and power within Monte Carlo error, and that
the sample-size formula delivers the power it promises.

Model: version A and version B of an agent run on T tasks, S attempts per
task per version. Task difficulty ~ Normal(0, sigma_task) on the logit
scale, attempt noise ~ Normal(0, sigma_noise). Paired design: both versions
see the same tasks and the analysis is a paired t-test on per-task
differences (the task is the unit of analysis). Hazards as in evalsim.js.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np
from scipy import stats


@dataclass
class Design:
    n_tasks: int = 40
    n_attempts: int = 3
    base_logit: float = 0.0
    sigma_task: float = 1.0
    sigma_noise: float = 0.5
    delta: float = 0.0
    paired: bool = True
    alpha: float = 0.05
    compute_k: int = 1
    err_excess: float = 0.0
    parse_fail_rate: float = 0.0
    naive_se: bool = False
    judge_bias: float = 0.0
    drift: float = 0.0
    prompt_cue: float = 0.0
    n_outcomes: int = 1


def _sig(x):
    return 1.0 / (1.0 + np.exp(-x))


def _arm(d: Design, rng, is_b: bool, diff: np.ndarray, n: int):
    T, S = d.n_tasks, d.n_attempts
    logit = d.base_logit + diff[:, :, None] + rng.normal(0, d.sigma_noise, (n, T, S))
    if is_b:
        logit = logit + d.delta + d.prompt_cue
        if d.drift:
            idx = np.arange(T * S).reshape(T, S)
            logit = logit + d.drift * (idx >= T * S / 2)[None]
    p = _sig(logit)
    if is_b and d.compute_k > 1:
        ok = (rng.random((n, T, S, d.compute_k)) < p[..., None]).any(axis=-1)
    else:
        ok = rng.random((n, T, S)) < p
    keep = np.ones((n, T, S), dtype=bool)
    if d.parse_fail_rate > 0:
        fail = rng.random((n, T, S)) < d.parse_fail_rate
        if is_b:
            ok = ok & ~fail
        else:
            keep = keep & ~fail
    if is_b and d.judge_bias > 0:
        ok = ok | (~ok & (rng.random((n, T, S)) < d.judge_bias))
    if is_b and d.err_excess > 0:
        p_drop = np.minimum(0.95, d.err_excess * (1 - _sig(d.base_logit + diff)))
        drop = rng.random((n, T)) < p_drop
        keep = keep & ~drop[:, :, None]
    return ok, keep


def _analyze(d: Design, a, b):
    (ya, ka), (yb, kb) = a, b
    if d.naive_se:
        na, nb = ka.sum(axis=(1, 2)), kb.sum(axis=(1, 2))
        pa = (ya & ka).sum(axis=(1, 2)) / np.maximum(na, 1)
        pb = (yb & kb).sum(axis=(1, 2)) / np.maximum(nb, 1)
        est = pb - pa
        se = np.sqrt(pa * (1 - pa) / np.maximum(na, 1) + pb * (1 - pb) / np.maximum(nb, 1))
        with np.errstate(divide="ignore", invalid="ignore"):
            p = np.where(se > 0, 2 * stats.norm.sf(np.abs(est / se)), np.where(est != 0, 0.0, 1.0))
        return est, p
    with np.errstate(invalid="ignore"):
        ma = (ya & ka).sum(axis=2) / ka.sum(axis=2)
        mb = (yb & kb).sum(axis=2) / kb.sum(axis=2)
    est = np.zeros(len(ma))
    p = np.ones(len(ma))
    for i in range(len(ma)):
        if d.paired:
            diff = (mb[i] - ma[i])[~np.isnan(ma[i]) & ~np.isnan(mb[i])]
            if len(diff) < 2:
                continue
            est[i] = diff.mean()
            se = diff.std(ddof=1) / np.sqrt(len(diff))
            p[i] = 2 * stats.t.sf(abs(est[i] / se), len(diff) - 1) if se > 0 else (0.0 if est[i] else 1.0)
        else:
            xa, xb = ma[i][~np.isnan(ma[i])], mb[i][~np.isnan(mb[i])]
            if len(xa) < 2 or len(xb) < 2:
                continue
            r = stats.ttest_ind(xb, xa, equal_var=False)
            est[i] = xb.mean() - xa.mean()
            p[i] = r.pvalue if np.isfinite(r.pvalue) else (0.0 if est[i] else 1.0)
    return est, p


def rate(d: Design, n_exp: int, seed: int = 1) -> dict:
    """Share of simulated evals with a significant difference (rate_any) and
    with B significantly better (rate)."""
    rng = np.random.default_rng(seed)
    best_p = np.full(n_exp, np.inf)
    best_est = np.zeros(n_exp)
    for _ in range(max(1, d.n_outcomes)):
        diff_a = rng.normal(0, d.sigma_task, (n_exp, d.n_tasks))
        diff_b = diff_a if d.paired else rng.normal(0, d.sigma_task, (n_exp, d.n_tasks))
        est, p = _analyze(d, _arm(d, rng, False, diff_a, n_exp), _arm(d, rng, True, diff_b, n_exp))
        better = p < best_p
        best_p = np.where(better, p, best_p)
        best_est = np.where(better, est, best_est)
    sig = best_p < d.alpha
    return {"rate": float(np.mean(sig & (best_est > 0))), "rate_any": float(np.mean(sig)), "n_exp": n_exp}


def mean_success(base: float, sigma: float) -> float:
    x, w = np.polynomial.hermite.hermgauss(40)
    return float(np.sum(w * _sig(base + np.sqrt(2) * sigma * x)) / np.sqrt(np.pi))


def delta_for(rate_: float, gain: float, sigma: float) -> tuple[float, float]:
    """(base logit, logit effect) giving mean success rate_ and rate_ + gain."""
    from scipy.optimize import brentq
    base = brentq(lambda b: mean_success(b, sigma) - rate_, -15, 15)
    delta = brentq(lambda e: mean_success(base + e, sigma) - (rate_ + gain), -10, 10)
    return base, delta


def tasks_for_80(sd: float, gain: float, alpha: float = 0.05, power: float = 0.8) -> int:
    z = stats.norm.ppf(1 - alpha / 2) + stats.norm.ppf(power)
    return int(np.ceil((z * sd / gain) ** 2)) + 1


def task_diff_sd(d: Design, n_tasks: int = 20000, seed: int = 11) -> float:
    rng = np.random.default_rng(seed)
    dd = replace(d, n_tasks=n_tasks, paired=True)
    diff = rng.normal(0, d.sigma_task, (1, n_tasks))
    (ya, ka), (yb, kb) = _arm(dd, rng, False, diff, 1), _arm(dd, rng, True, diff, 1)
    ma = (ya & ka).sum(axis=2) / ka.sum(axis=2)
    mb = (yb & kb).sum(axis=2) / kb.sum(axis=2)
    return float(np.std(mb - ma, ddof=1))
