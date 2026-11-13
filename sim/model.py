"""Monte Carlo model of a two-condition agent experiment with design hazards.

Model (identical in the JavaScript mirror, docs/sim.js):

- An experiment compares condition A (control) and B (treatment). Each
  condition is run on its own sample of T tasks with S seeds per task (task
  samples are independent across conditions; see DECISIONS.md for why the
  design is unpaired). Task difficulty d_t ~ Normal(0, sigma_task) on the
  logit scale.
- A run's success probability is sigmoid(base_logit + d_t + delta * B + noise),
  noise ~ Normal(0, sigma_noise); success is Bernoulli with that probability.
- The correct analysis is the difference in success rates with a
  cluster-by-task standard error: per-task arm means, then a two-sample
  (Welch) standard error over the T task means per arm, with a t reference
  distribution. A two-sided test at alpha = 0.05 decides "significant".

Each hazard modifies generation or analysis exactly as documented in
PLAN.md. All parameters live in Settings; hazards are off at their defaults.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import stats

Z95 = float(stats.norm.ppf(0.975))


@dataclass
class Settings:
    # Base design
    n_tasks: int = 20
    n_seeds: int = 5
    base_logit: float = 0.0
    sigma_task: float = 1.0
    sigma_noise: float = 0.5
    delta: float = 0.0  # true treatment effect on the logit scale
    alpha: float = 0.05

    # Hazard 1: compute bundling. B gets best-of-k attempts per run; A gets 1.
    compute_k: int = 1
    # Hazard 2: post-treatment exclusion. Runs error out and are dropped.
    # Both arms lose a flat err_base share of runs at random (harmless).
    # In arm B, hard tasks also break the treated agent: a B task whose
    # failure propensity is q_t errors out entirely (all its runs dropped)
    # with probability err_excess * q_t, so B's surviving task sample is
    # selected toward easy tasks. See DECISIONS.md.
    err_base: float = 0.05
    err_excess: float = 0.0
    # Hazard 3: differential failure handling. A run's output fails to parse
    # with probability parse_fail_rate in both arms; one arm counts parse
    # failures as wrong, the other drops them as missing.
    parse_fail_rate: float = 0.0
    parse_rule: str = "b_wrong_a_missing"  # or "a_wrong_b_missing"
    # Hazard 4: pseudo-replication. Analysis pools all runs and uses a naive
    # two-proportion standard error instead of clustering by task.
    naive_se: bool = False
    # Hazard 5: unblinded LLM judge. The judge sees the label and flips a
    # B failure to a success with probability judge_bias.
    judge_bias: float = 0.0
    # Hazard 6: model drift. Conditions run in sequence (all A, then all B);
    # halfway through the B block the model changes and B's logit shifts.
    drift: float = 0.0
    # Hazard 7: prompt cue. B's prompt adds a demand effect to B's logit.
    prompt_cue: float = 0.0
    # Hazard 8: selective reporting. n_outcomes outcomes are measured; the
    # one with the largest |z| is reported, with no multiplicity correction.
    n_outcomes: int = 1


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _one_outcome(s: Settings, n_exp: int, rng: np.random.Generator) -> dict:
    """Simulate n_exp experiments measuring a single outcome.

    Returns per-experiment arrays: estimate, standard error, p-value,
    rejected (p < alpha).
    """
    T, S = s.n_tasks, s.n_seeds

    arms = {}
    for is_b, arm in ((False, "a"), (True, "b")):
        # Each condition draws its own task sample (unpaired design).
        difficulty = rng.normal(0.0, s.sigma_task, size=(n_exp, T))
        logit = s.base_logit + difficulty[:, :, None]
        if s.sigma_noise > 0:
            logit = logit + rng.normal(0.0, s.sigma_noise, size=(n_exp, T, S))
        if is_b:
            logit = logit + s.delta + s.prompt_cue
            if s.drift != 0.0:
                # Runs are executed task-major; the second half of the B
                # block runs after the model change.
                run_index = np.arange(T * S).reshape(T, S)
                drift_shift = np.where(run_index >= (T * S) / 2, s.drift, 0.0)
                logit = logit + drift_shift[None, :, :]
        p = _sigmoid(logit)

        if is_b and s.compute_k > 1:
            attempts = rng.random((n_exp, T, S, s.compute_k)) < p[:, :, :, None]
            y = attempts.any(axis=-1)
            p_run = 1.0 - (1.0 - p) ** s.compute_k
        else:
            y = rng.random((n_exp, T, S)) < p
            p_run = p

        # Hazard 2: errors drop runs (post-treatment exclusion). Flat
        # run-level dropout in both arms, plus task-level exclusion in B:
        # hard tasks error out entirely with prob. err_excess * q_t.
        kept = rng.random((n_exp, T, S)) >= s.err_base
        if is_b and s.err_excess > 0:
            q_task = 1.0 - _sigmoid(s.base_logit + difficulty)
            task_drop = rng.random((n_exp, T)) < np.clip(s.err_excess * q_task, 0.0, 0.95)
            kept = kept & ~task_drop[:, :, None]

        # Hazard 3: parse failures, handled by different rules per arm.
        if s.parse_fail_rate > 0:
            parse_fail = rng.random((n_exp, T, S)) < s.parse_fail_rate
            counts_wrong = (is_b and s.parse_rule == "b_wrong_a_missing") or (
                not is_b and s.parse_rule == "a_wrong_b_missing"
            )
            if counts_wrong:
                y = y & ~parse_fail
            else:
                kept = kept & ~parse_fail

        # Hazard 5: unblinded judge upgrades B failures.
        if is_b and s.judge_bias > 0:
            flip = (rng.random((n_exp, T, S)) < s.judge_bias) & (~y)
            y = y | flip

        arms[arm] = (y, kept)

    ya, ka = arms["a"]
    yb, kb = arms["b"]

    with np.errstate(invalid="ignore", divide="ignore"):
        if s.naive_se:
            # Hazard 4: pool every run as if independent.
            n_a = ka.sum(axis=(1, 2))
            n_b = kb.sum(axis=(1, 2))
            p_a = np.where(n_a > 0, (ya & ka).sum(axis=(1, 2)) / np.maximum(n_a, 1), np.nan)
            p_b = np.where(n_b > 0, (yb & kb).sum(axis=(1, 2)) / np.maximum(n_b, 1), np.nan)
            est = p_b - p_a
            se = np.sqrt(p_a * (1 - p_a) / np.maximum(n_a, 1) + p_b * (1 - p_b) / np.maximum(n_b, 1))
            stat = np.where(se > 0, est / np.where(se > 0, se, 1.0), np.where(est != 0, np.inf, 0.0))
            p_value = 2.0 * stats.norm.sf(np.abs(stat))
        else:
            # Correct analysis: per-task arm means, two-sample Welch SE
            # over task means (the task is the replication unit).
            cnt_a = ka.sum(axis=2)
            cnt_b = kb.sum(axis=2)
            mean_a = np.where(cnt_a > 0, (ya & ka).sum(axis=2) / np.maximum(cnt_a, 1), np.nan)
            mean_b = np.where(cnt_b > 0, (yb & kb).sum(axis=2) / np.maximum(cnt_b, 1), np.nan)
            n_a = np.sum(~np.isnan(mean_a), axis=1)
            n_b = np.sum(~np.isnan(mean_b), axis=1)
            m_a = np.nanmean(mean_a, axis=1)
            m_b = np.nanmean(mean_b, axis=1)
            est = m_b - m_a
            v_a = np.nanvar(mean_a, axis=1, ddof=1) / np.maximum(n_a, 1)
            v_b = np.nanvar(mean_b, axis=1, ddof=1) / np.maximum(n_b, 1)
            se = np.sqrt(v_a + v_b)
            # Welch-Satterthwaite degrees of freedom.
            denom = v_a**2 / np.maximum(n_a - 1, 1) + v_b**2 / np.maximum(n_b - 1, 1)
            df = np.where(denom > 0, (v_a + v_b) ** 2 / np.where(denom > 0, denom, 1.0), np.nan)
            ok = (n_a > 1) & (n_b > 1) & (se > 0)
            stat = np.where(ok, est / np.where(ok, se, 1.0), np.where(est != 0, np.inf, 0.0))
            p_value = np.where(ok, 2.0 * stats.t.sf(np.abs(stat), np.where(ok, df, 1.0)), 1.0)
            se = np.where((n_a > 1) & (n_b > 1), se, np.nan)

    est = np.where(np.isnan(est), 0.0, est)
    p_value = np.where(np.isnan(p_value), 1.0, p_value)
    rejected = p_value < s.alpha
    return {"estimate": est, "se": se, "p_value": p_value, "rejected": rejected}


def simulate_experiments(s: Settings, n_exp: int, seed: int) -> dict:
    """Simulate n_exp experiments under settings s.

    With selective reporting (n_outcomes > 1) each outcome is an independent
    copy of the experiment and the reported one is the copy with the
    smallest p-value. Returns estimates, rejection flags and summary statistics:
    false-positive rate when delta == 0 (power otherwise), mean estimate
    and the Monte Carlo standard error of the rate.
    """
    rng = np.random.default_rng(seed)
    best = None
    for _ in range(max(1, s.n_outcomes)):
        out = _one_outcome(s, n_exp, rng)
        if best is None:
            best = out
        else:
            # Selective reporting: keep the outcome with the smallest p.
            take = out["p_value"] < best["p_value"]
            for key in best:
                best[key] = np.where(take, out[key], best[key])
    rate = float(np.mean(best["rejected"]))
    mc_se = float(np.sqrt(rate * (1 - rate) / n_exp)) if n_exp else 0.0
    return {
        "estimates": best["estimate"],
        "rejected": best["rejected"],
        "rate": rate,
        "mc_se": mc_se,
        "mean_estimate": float(np.mean(best["estimate"])),
        "n_exp": n_exp,
    }
